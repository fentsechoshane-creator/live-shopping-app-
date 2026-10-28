-- Business rules enforced by the database, so no app or person can skip them.

-- ===== Order status changes =====
create function order_transition_allowed(f order_status, t order_status) returns boolean
language sql immutable as $$
  select case f
    when 'pending_payment' then t in ('paid', 'cancelled')
    when 'paid' then t in ('shipped', 'refunded', 'cancelled')
    when 'shipped' then t in ('delivered', 'refunded')
    when 'delivered' then t in ('return_requested', 'completed', 'refunded')
    when 'return_requested' then t in ('return_in_transit', 'completed', 'refunded')
    when 'return_in_transit' then t in ('refunded', 'completed')
    else false
  end;
$$;

-- Return window after delivery: Buy now 7 days (ECT Act s44), auction 2 days, made to order food 1 day.
create function return_window(m sale_mode) returns interval language sql immutable as $$
  select case m when 'buy_now' then interval '7 days' when 'auction' then interval '2 days' else interval '1 day' end;
$$;

create function orders_before_update() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not order_transition_allowed(old.status, new.status) then
      raise exception 'Order cannot go from % to %', old.status, new.status using errcode = 'check_violation';
    end if;
    case new.status
      when 'paid' then new.paid_at := coalesce(new.paid_at, now()); new.ship_by := new.paid_at + interval '72 hours';
      when 'shipped' then new.shipped_at := coalesce(new.shipped_at, now());
      when 'delivered' then
        new.delivered_at := coalesce(new.delivered_at, now());
        new.releasable_at := new.delivered_at + return_window(new.mode);
      when 'completed' then new.completed_at := now();
      when 'refunded' then new.refunded_at := now();
      when 'cancelled' then new.cancelled_at := now();
      else null;
    end case;
  end if;
  -- Money fields never change after the order is created.
  if (new.item_price_cents, new.delivery_fee_cents, new.protection_fee_cents, new.credit_cents, new.total_cents,
      new.seller_fee_cents, new.seller_payout_cents, new.buyer_id, new.shop_id, new.product_id)
     is distinct from
     (old.item_price_cents, old.delivery_fee_cents, old.protection_fee_cents, old.credit_cents, old.total_cents,
      old.seller_fee_cents, old.seller_payout_cents, old.buyer_id, old.shop_id, old.product_id) then
    raise exception 'Order amounts and parties cannot be changed' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger orders_guard before update on orders for each row execute function orders_before_update();

create function orders_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  seller uuid;
  title text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select s.owner_id into seller from shops s where s.id = new.shop_id;
  select p.title into title from products p where p.id = new.product_id;
  insert into order_events (order_id, from_status, to_status, actor_id) values (new.id, old.status, new.status, auth.uid());

  if new.status = 'paid' then
    update products set stock = greatest(stock - 1, 0),
      status = case when stock - 1 <= 0 and mode <> 'order_now' then 'sold_out'::product_status else status end
      where id = new.product_id;
    if new.credit_cents > 0 then update profiles set welcome_credit_used = true where id = new.buyer_id; end if;
    perform notify(seller, 'order', 'New order: ' || title, 'Ship within 2 days. The money is held safely until the return window closes.', '/sell/orders/' || new.id);
    perform notify(new.buyer_id, 'order', 'Payment received', 'Your money is held safely. We will tell you when ' || title || ' ships.', '/orders/' || new.id);
  elsif new.status = 'shipped' then
    if new.packing_media_id is not null and new.shipped_at - new.paid_at <= interval '48 hours' then
      perform add_trust_event(seller, 'fast_ship_with_video', new.id);
    end if;
    perform notify(new.buyer_id, 'order', 'On the way: ' || title, coalesce('Tracking: ' || new.tracking_ref, 'The seller has sent your order.'), '/orders/' || new.id);
  elsif new.status = 'delivered' then
    perform notify(new.buyer_id, 'order', 'Delivered: ' || title,
      case when new.mode = 'buy_now' then 'You have 7 days to return it if you change your mind.' else 'Tell us within the check period if something is wrong.' end,
      '/orders/' || new.id);
  elsif new.status = 'completed' then
    perform add_trust_event(seller, 'order_kept', new.id);
  elsif new.status = 'refunded' then
    if old.status = 'paid' then
      perform add_trust_event(seller, 'not_shipped', new.id, 'Refunded before shipping');
      update products set stock = stock + 1, status = case when status = 'sold_out' then 'live'::product_status else status end
        where id = new.product_id;
    end if;
    perform notify(new.buyer_id, 'order', 'Refund on the way', 'Your money is going back to your card or account.', '/orders/' || new.id);
  end if;
  return new;
end $$;
create trigger orders_changed after update on orders for each row execute function orders_after_update();

-- Count of delivered orders the seller kept, with no review under 4 stars.
create function good_orders(p_shop uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from orders o
  where o.shop_id = p_shop and o.status = 'completed'
    and not exists (select 1 from reviews r where r.order_id = o.id and r.stars < 4);
$$;

-- ===== Products =====
-- Words that mark a listing as counterfeit. Same list as packages/core/src/listing.ts.
create function looks_counterfeit(t text) returns boolean language sql immutable as $$
  select lower(' ' || t || ' ') ~ '(replica|\mreps?\M|\mfake\M|1:1|aaa grade|mirror quality|inspired by)';
$$;
create function mentions_brand(t text) returns boolean language sql immutable as $$
  select lower(' ' || t || ' ') ~ '\m(nike|adidas|jordan|gucci|louis vuitton|lv|prada|balenciaga|dior|chanel|yeezy|off white|supreme|puma|new balance|zara|versace|fendi|burberry|hermes)\M';
$$;

create function products_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ready record;
  cat shop_category;
  admin boolean := is_admin() or auth.role() = 'service_role';
begin
  if not admin then
    if tg_op = 'INSERT' and new.proof_status not in ('not_started', 'pending') then
      raise exception 'Proof status is set by our team';
    end if;
    if tg_op = 'UPDATE' then
      if new.proof_status is distinct from old.proof_status and new.proof_status not in ('pending') then
        raise exception 'Proof status is set by our team';
      end if;
      if old.status = 'removed' and old.removed_reason is not null then
        raise exception 'This listing was removed by our team';
      end if;
      if new.removed_reason is distinct from old.removed_reason then
        raise exception 'Only our team can set a removal reason';
      end if;
    end if;
  end if;

  -- Content checks run when a listing is created or its words change.
  if (tg_op = 'INSERT' or new.title is distinct from old.title or new.description is distinct from old.description
      or new.label is distinct from old.label) and looks_counterfeit(new.title || ' ' || new.description) then
    raise exception 'Replicas and fakes are not allowed. Selling counterfeit goods is an offence under the Counterfeit Goods Act.'
      using errcode = 'check_violation';
  end if;
  if new.label = 'unbranded_dupe' and mentions_brand(new.title || ' ' || new.description) then
    raise exception 'Unbranded dupes cannot mention a brand name.' using errcode = 'check_violation';
  end if;
  if new.label = 'pre_loved' and new.condition is null then
    raise exception 'Pick a condition for pre loved items.' using errcode = 'check_violation';
  end if;

  -- Going live checks run when a listing goes live or changes how it sells. Stock updates from orders
  -- (run by the server) must never fail, or a payment could not be recorded.
  if new.status = 'live' and not admin
     and (tg_op = 'INSERT' or old.status <> 'live' or new.mode <> old.mode or new.label <> old.label) then
    select * into ready from seller_ready where shop_id = new.shop_id;
    select category into cat from shops where id = new.shop_id;
    if not coalesce(ready.can_sell, false) then
      raise exception 'Your shop goes live once your ID and bank account are checked.' using errcode = 'check_violation';
    end if;
    if new.mode = 'order_now' and (cat <> 'food' or not ready.food_ok) then
      raise exception 'Order now needs an approved Certificate of Acceptability.' using errcode = 'check_violation';
    end if;
    if new.mode = 'auction' and good_orders(new.shop_id) < 5 then
      raise exception 'Auctions unlock after 5 delivered orders with good ratings.' using errcode = 'check_violation';
    end if;
    if new.label = 'authentic_designer' and new.proof_status <> 'approved' then
      raise exception 'Designer items go live once we have checked the proof.' using errcode = 'check_violation';
    end if;
    if (select trust_score from profiles p join shops s on s.owner_id = p.id where s.id = new.shop_id) < 40 then
      raise exception 'Your account is under review.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger products_guard before insert or update on products for each row execute function products_guard();

-- ===== Seller onboarding (called from the app) =====
create function start_shop(p_name text, p_handle text, p_category shop_category)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into shops (owner_id, name, handle, category) values (auth.uid(), p_name, lower(p_handle), p_category)
  on conflict (owner_id) do update set name = excluded.name, handle = excluded.handle, category = excluded.category
    where shops.status = 'onboarding'
  returning id into sid;
  if sid is null then raise exception 'Your shop is already open'; end if;
  insert into seller_checks (shop_id) values (sid) on conflict do nothing;
  return sid;
end $$;

create function my_shop_id() returns uuid language sql stable security definer set search_path = public as $$
  select id from shops where owner_id = auth.uid();
$$;

-- Clients can only move checks to pending. The guard below lets these functions write with a local flag.
create function submit_id(p_phone text, p_id_doc_path text, p_selfie_path text)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := my_shop_id();
begin
  if sid is null then raise exception 'Start your shop first'; end if;
  if p_id_doc_path not like auth.uid()::text || '/%' or p_selfie_path not like auth.uid()::text || '/%' then
    raise exception 'Upload the files to your own folder';
  end if;
  perform set_config('app.trusted_write', 'on', true);
  update seller_checks set phone = p_phone, id_doc_path = p_id_doc_path, selfie_path = p_selfie_path,
    id_status = case when id_status = 'approved' then id_status else 'pending' end
  where shop_id = sid;
end $$;

create function submit_food_cert(p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := my_shop_id();
begin
  if sid is null then raise exception 'Start your shop first'; end if;
  if p_path not like auth.uid()::text || '/%' then raise exception 'Upload the file to your own folder'; end if;
  perform set_config('app.trusted_write', 'on', true);
  update seller_checks set cert_path = p_path, cert_status = 'pending' where shop_id = sid;
end $$;

create function accept_seller_rules()
returns void language plpgsql security definer set search_path = public as $$
begin
  update seller_checks set rules_accepted_at = coalesce(rules_accepted_at, now()) where shop_id = my_shop_id();
end $$;

-- Opens the shop. Listings only go live once ID and bank are approved (see products_guard).
-- The first 50 shops to open are founding sellers: no seller fee for 90 days.
create function open_shop()
returns void language plpgsql security definer set search_path = public as $$
declare
  sid uuid := my_shop_id();
  c record;
begin
  select * into c from seller_checks where shop_id = sid;
  if c is null then raise exception 'Start your shop first'; end if;
  if c.rules_accepted_at is null then raise exception 'Accept the seller rules first'; end if;
  if c.id_status = 'not_started' then raise exception 'Add your ID first'; end if;
  if c.bank_status = 'not_started' then raise exception 'Add your bank account first'; end if;
  update shops set status = 'open', opened_at = coalesce(opened_at, now()),
    founding_until = coalesce(founding_until,
      case when (select count(*) from shops where opened_at is not null) < 50 then now() + interval '90 days' end)
  where id = sid and status = 'onboarding';
end $$;

create function submit_designer_proof(p_product uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_path not like auth.uid()::text || '/%' then raise exception 'Upload the file to your own folder'; end if;
  update products set proof_path = p_path, proof_status = 'pending'
  where id = p_product and shop_id = my_shop_id() and proof_status <> 'approved';
end $$;

-- ===== Seller checks guard: status columns are only set by admins or server functions =====
create function seller_checks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or auth.role() = 'service_role' or current_setting('app.trusted_write', true) = 'on') then
    if (new.id_status, new.bank_status, new.cert_status, new.escrow_token, new.bank_name, new.bank_last4, new.reviewed_by, new.reviewed_at)
       is distinct from (old.id_status, old.bank_status, old.cert_status, old.escrow_token, old.bank_name, old.bank_last4, old.reviewed_by, old.reviewed_at) then
      raise exception 'Checks are updated by our team';
    end if;
  end if;
  -- Clients may only move a status to pending, never to approved.
  if current_setting('app.trusted_write', true) = 'on' and not (is_admin() or auth.role() = 'service_role') then
    if (new.id_status = 'approved' and old.id_status <> 'approved') or (new.cert_status = 'approved' and old.cert_status <> 'approved')
       or new.bank_status is distinct from old.bank_status then
      raise exception 'Checks are updated by our team';
    end if;
  end if;
  if new.id_status = 'approved' and old.id_status <> 'approved' then
    perform add_trust_event((select owner_id from shops where id = new.shop_id), 'verified');
  end if;
  return new;
end $$;
create trigger seller_checks_guard before update on seller_checks for each row execute function seller_checks_guard();

-- ===== Admin =====
create function admin_review(p_shop uuid, p_what text, p_approved boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare st review_status := case when p_approved then 'approved' else 'rejected' end;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_what = 'id' then update seller_checks set id_status = st where shop_id = p_shop;
  elsif p_what = 'bank' then update seller_checks set bank_status = st where shop_id = p_shop;
  elsif p_what = 'cert' then update seller_checks set cert_status = st where shop_id = p_shop;
  else raise exception 'Unknown check %', p_what; end if;
  update seller_checks set reviewed_by = auth.uid(), reviewed_at = now(), notes = coalesce(p_note, notes) where shop_id = p_shop;
  perform notify((select owner_id from shops where id = p_shop), 'shop',
    case when p_approved then 'Check approved' else 'Check needs attention' end,
    coalesce(p_note, case when p_approved then 'Your ' || p_what || ' check is approved.' else 'Please upload your ' || p_what || ' again.' end),
    '/sell');
end $$;

create function admin_review_proof(p_product uuid, p_approved boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update products set proof_status = case when p_approved then 'approved'::review_status else 'rejected'::review_status end where id = p_product;
end $$;

-- Counterfeit goods: listing removed and the shop banned. Other removals just take the listing down.
create function admin_remove_product(p_product uuid, p_reason text, p_counterfeit boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update products set status = 'removed', removed_reason = p_reason where id = p_product returning shop_id into sid;
  if p_counterfeit then
    update shops set status = 'banned' where id = sid;
    update products set status = 'removed', removed_reason = coalesce(removed_reason, 'Shop banned') where shop_id = sid;
  end if;
end $$;

-- ===== Buyer actions that need no money movement =====
-- Buyer confirms they have the order (used until courier tracking is connected).
create function confirm_received(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update orders set status = 'delivered' where id = p_order and buyer_id = auth.uid() and status = 'shipped';
  if not found then raise exception 'Only shipped orders can be marked as received'; end if;
end $$;

create function request_return(p_order uuid, p_reason return_reason, p_details text)
returns void language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order and buyer_id = auth.uid() for update;
  if o is null then raise exception 'Order not found'; end if;
  if o.status <> 'delivered' then raise exception 'Returns open once the order is delivered'; end if;
  if now() > o.releasable_at then raise exception 'The return window has closed'; end if;
  if p_reason = 'changed_mind' and o.mode <> 'buy_now' then
    raise exception 'Auctions and made to order items cannot be returned for a change of mind';
  end if;
  insert into returns (order_id, reason, details, postage_payer)
  values (p_order, p_reason, coalesce(p_details, ''), case when p_reason = 'changed_mind' then 'buyer' else 'seller' end);
  update orders set status = 'return_requested' where id = p_order;
  perform notify((select owner_id from shops where id = o.shop_id), 'return', 'Return requested',
    'The buyer wants to return an order. The payout waits until it is sorted out.', '/sell/orders/' || p_order);
end $$;

create function leave_review(p_order uuid, p_stars int, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order and buyer_id = auth.uid();
  if o is null or o.status not in ('delivered', 'completed') then raise exception 'You can review once the order arrives'; end if;
  insert into reviews (order_id, buyer_id, shop_id, stars, body) values (p_order, auth.uid(), o.shop_id, p_stars, coalesce(p_body, ''));
  if p_stars = 5 then perform add_trust_event((select owner_id from shops where id = o.shop_id), 'five_star_review', p_order); end if;
end $$;

-- ===== Feed =====
-- Ranked by what actually sells, with a boost for trusted sellers. Restricted sellers are hidden.
create function feed(p_limit int default 20, p_offset int default 0)
returns table (
  post_id uuid, caption text, posted_at timestamptz,
  product_id uuid, title text, description text, price_cents int, mode sale_mode, label listing_label,
  condition item_condition, sizes text[], stock int, lead_days int, allergens text,
  shop_id uuid, shop_name text, shop_handle text, category shop_category, trust_score int, tier text,
  playback_id text, storage_path text, rank numeric
) language sql stable security definer set search_path = public as $$
  select po.id, po.caption, po.created_at,
         p.id, p.title, p.description, p.price_cents, p.mode, p.label, p.condition, p.sizes, p.stock, p.lead_days, p.allergens,
         s.id, s.name, s.handle, s.category, pr.trust_score, tier_for(pr.trust_score),
         m.mux_playback_id, m.storage_path,
         (3 * (select count(*) from orders o where o.shop_id = s.id and o.status not in ('pending_payment', 'cancelled', 'refunded')
                and o.created_at > now() - interval '30 days')
          + case tier_for(pr.trust_score) when 'top' then 10 when 'trusted' then 5 else 0 end
          - extract(epoch from now() - po.created_at) / 3600 / 24)::numeric as rank
  from posts po
  join products p on p.id = po.product_id
  join shops s on s.id = po.shop_id
  join profiles pr on pr.id = s.owner_id
  join media m on m.id = po.media_id
  where po.status = 'live' and p.status = 'live' and s.status = 'open' and pr.trust_score >= 40 and m.status = 'ready'
  order by rank desc, po.created_at desc
  limit least(p_limit, 50) offset p_offset;
$$;

-- Public shop page data.
create function shop_public(p_handle text)
returns table (shop_id uuid, name text, handle text, category shop_category, bio text, city text, trust_score int, tier text,
               sales int, followers int, founding boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.handle, s.category, s.bio, s.city, pr.trust_score, tier_for(pr.trust_score),
         (select count(*)::int from orders o where o.shop_id = s.id and o.status in ('delivered', 'completed')),
         (select count(*)::int from follows f where f.shop_id = s.id),
         s.founding_until is not null and s.founding_until > now()
  from shops s join profiles pr on pr.id = s.owner_id
  where s.handle = lower(p_handle) and s.status = 'open';
$$;

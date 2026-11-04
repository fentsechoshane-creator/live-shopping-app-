-- Security hardening round 2 (2026-11-05). Four attacker style reviews (database, server functions, app and
-- hosting, fraud and abuse) tried to break myHaul on local copies; every confirmed hole is closed here.
-- docs/SECURITY.md section 10 lists each one. Tests: supabase/tests/policies.test.sql, "hardening round 2".

-- ===== 1. Packing proof needs a real file, in the seller's own folder, used once =====
drop policy if exists "owner adds media" on media;
create policy "owner adds media" on media for insert to authenticated
  with check (owner_id = auth.uid() and (storage_path is null or storage_path like auth.uid()::text || '/%'));
create unique index orders_packing_video_once on orders (packing_media_id) where packing_media_id is not null;
create unique index orders_packing_photo_once on orders (packing_photo_media_id) where packing_photo_media_id is not null;
-- True when the file is really in the private bucket (skipped on the local test database, whose storage has no objects table).
create function packing_file_exists(p_path text) returns boolean language plpgsql stable security definer set search_path = public, storage as $$
declare ok boolean;
begin
  if to_regclass('storage.objects') is null then return true; end if;
  execute 'select exists (select 1 from storage.objects where bucket_id = ''private'' and name = $1)' into ok using p_path;
  return ok;
end $$;
revoke execute on function packing_file_exists(text) from public, anon, authenticated;
create or replace function packing_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare seller uuid := shop_owner(new.shop_id); v media; ph media;
begin
  if not (new.status = 'shipped' and old.status = 'paid') then return new; end if;
  select * into v from media where id = new.packing_media_id;
  select * into ph from media where id = new.packing_photo_media_id;
  if v.id is null or ph.id is null then
    raise exception 'Add the packing video and the photo of the sealed parcel before shipping.' using errcode = 'check_violation';
  end if;
  if v.owner_id <> seller or ph.owner_id <> seller or v.kind <> 'video' or ph.kind <> 'image' then
    raise exception 'The packing video and photo must be your own, filmed in the app.' using errcode = 'check_violation';
  end if;
  -- A real file in the seller's own folder, uploaded for this order, used for no other order.
  if v.status <> 'ready' or ph.status <> 'ready' or v.storage_path is null or ph.storage_path is null
     or v.storage_path not like seller::text || '/packing-%' or ph.storage_path not like seller::text || '/parcel-%'
     or not packing_file_exists(v.storage_path) or not packing_file_exists(ph.storage_path) then
    raise exception 'Upload the packing video and photo from the app.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from orders o where o.id <> new.id and (o.packing_media_id in (v.id, ph.id) or o.packing_photo_media_id in (v.id, ph.id))) then
    raise exception 'Film new packing proof for each order.' using errcode = 'check_violation';
  end if;
  if v.created_at < new.paid_at or ph.created_at < new.paid_at then
    raise exception 'Film the packing video and photo for this order, after it was paid.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function packing_due_purge() returns table (order_id uuid, paths text[]) language sql stable security definer set search_path = public as $$
  -- Only files in the seller's own folder are ever deleted.
  select o.id, array_remove(array[(select storage_path from media where id = o.packing_media_id and storage_path like shop_owner(o.shop_id)::text || '/%'),
                                  (select storage_path from media where id = o.packing_photo_media_id and storage_path like shop_owner(o.shop_id)::text || '/%')], null)
  from orders o
  where o.packing_purged_at is null and (o.packing_media_id is not null or o.packing_photo_media_id is not null)
    and coalesce(o.delivered_at, o.shipped_at) < now() - interval '6 months'
    and o.status not in ('return_requested', 'return_in_transit')
  limit 200;
$$;

-- ===== 2. Overselling: two people pay for the last one =====
-- Stock was only checked when checkout opened. Now the payment that finds no stock is marked oversold and refunded in
-- full by run-due, with no trust penalty for the seller and no relisting of a sold item.
alter table orders add column oversold boolean not null default false;
create function orders_oversold() returns trigger language plpgsql security definer set search_path = public as $$
declare left_ int;
begin
  if new.status = 'paid' and old.status = 'pending_payment' and new.mode = 'buy_now' then
    select stock into left_ from products where id = new.product_id for update;
    if coalesce(left_, 0) < 1 then new.oversold := true; end if;
  end if;
  return new;
end $$;
create trigger aa_orders_oversold before update on orders for each row execute function orders_oversold();
create or replace function orders_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  seller uuid;
  title text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select s.owner_id into seller from shops s where s.id = new.shop_id;
  select p.title into title from products p where p.id = new.product_id;
  insert into order_events (order_id, from_status, to_status, actor_id) values (new.id, old.status, new.status, auth.uid());

  if new.status = 'paid' and new.oversold then
    -- Sold out before this payment cleared: no stock change, no "ship it" message. run-due refunds it, with no trust penalty.
    perform notify(new.buyer_id, 'order', 'Sorry, ' || title || ' sold out', 'Someone paid a moment before you. Your money is coming back in full.', '/orders/' || new.id);
  elsif new.status = 'paid' then
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
    if old.status = 'paid' and not new.oversold then
      perform add_trust_event(seller, 'not_shipped', new.id, 'Refunded before shipping');
      update products set stock = stock + 1, status = case when status = 'sold_out' then 'live'::product_status else status end
        where id = new.product_id;
    end if;
    perform notify(new.buyer_id, 'order', 'Refund on the way', 'Your money is going back to your card or account.', '/orders/' || new.id);
  end if;
  return new;
end $$;

-- ===== 3. Rewards can't be farmed with fake buyers =====
create or replace function grant_reward(p_user uuid, p_kind text, p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare o orders; budget bigint;
begin
  select * into o from orders where id = p_order;
  if p_user is null or is_suspended(p_user) or feature_state(p_user, 'welcome_credit') = 'off' then return; end if;
  if exists (select 1 from rewards where user_id = p_user and kind = p_kind) then return; end if;
  if o.item_price_cents < 10000 then return; end if;
  -- Only orders a courier carried, with tracking, earn a reward: collections are easy to fake between friends.
  if o.delivery not in ('courier', 'pudo_locker') or o.tracking_ref is null then return; end if;
  -- One shop can't hand out more than 5 buyer rewards in 30 days (stops a seller farming with fake buyers).
  if p_kind <> 'first_sale' and (select count(*) from rewards r join orders x on x.id = r.earned_order_id
      where x.shop_id = o.shop_id and r.kind <> 'first_sale' and r.created_at > now() - interval '30 days')
      >= (select value from app_limits where key = 'welcome_credit_per_seller_30d') then return; end if;
  select value into budget from app_limits where key = 'welcome_credit_budget_cents';
  if (select coalesce(sum(amount_cents), 0) from rewards where status <> 'forfeited') + 5000 > coalesce(budget, 0) then return; end if;
  insert into rewards (user_id, kind, amount_cents, earned_order_id, usable_from)
    values (p_user, p_kind, 5000, p_order, coalesce(o.releasable_at, now() + interval '7 days'))
    on conflict (user_id, kind) do nothing;
  if found then
    perform notify(p_user, 'reward', 'Surprise! You earned R50',
      case p_kind when 'first_buy' then 'A thank you for your first order.' when 'first_auction' then 'A thank you for your first auction win.'
                  else 'A thank you for your first sale.' end
      || ' It''s yours to spend once the return window closes. One reward comes off an order of R200 or more.', '/me');
  end if;
end $$;

create or replace function reward_attach() returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid; amt int;
begin
  if new.credit_cents <= 0 then new.reward_id := null; return new; end if;
  if new.item_price_cents < 20000 then raise exception 'Rewards are for orders of R200 or more.'; end if;
  select id, amount_cents into rid, amt from rewards where user_id = new.buyer_id and status = 'ready' order by created_at limit 1 for update;
  if rid is null then raise exception 'There''s no reward to use on this order.'; end if;
  if new.credit_cents > amt then raise exception 'The reward is at most R%.', amt / 100; end if;
  new.reward_id := rid;
  return new;
end $$;

-- ===== 4. Removed posts stay removed; suspended people can't open a shop or put things live =====
create function posts_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or auth.role() = 'service_role') then
    if old.status = 'removed' and new.status <> 'removed' then raise exception 'This post was removed by our team.'; end if;
    if new.status = 'live' and old.status <> 'live' and is_suspended(shop_owner(new.shop_id)) then
      raise exception 'This account is suspended. Email support if you think this is a mistake.';
    end if;
  end if;
  return new;
end $$;
create trigger posts_guard before update on posts for each row execute function posts_guard();
create function products_not_suspended() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status <> 'live') and not (is_admin() or auth.role() = 'service_role')
     and is_suspended(shop_owner(new.shop_id)) then
    raise exception 'This account is suspended. Email support if you think this is a mistake.';
  end if;
  return new;
end $$;
create trigger aa_products_not_suspended_update before update on products for each row execute function products_not_suspended();
create or replace function open_shop()
returns void language plpgsql security definer set search_path = public as $$
declare
  sid uuid := my_shop_id();
  c record;
begin
  select * into c from seller_checks where shop_id = sid;
  if c is null then raise exception 'Start your shop first'; end if;
  if is_suspended(auth.uid()) then raise exception 'This account is suspended. Email support if you think this is a mistake.'; end if;
  if c.rules_accepted_at is null then raise exception 'Accept the seller rules first'; end if;
  if c.id_status = 'not_started' then raise exception 'Add your ID first'; end if;
  if c.bank_status = 'not_started' then raise exception 'Add your bank account first'; end if;
  update shops set status = 'open', opened_at = coalesce(opened_at, now()),
    founding_until = coalesce(founding_until,
      case when (select count(*) from shops where opened_at is not null) < 50 then now() + interval '90 days' end)
  where id = sid and status = 'onboarding';
end $$;

-- ===== 5. Auctions: no double selling, no changing the item after bids =====
create or replace function auction_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auction_internal() then return new; end if;
  if new.mode <> 'auction' then
    new.auction_state := null; new.auction_ends_at := null; new.reserve_cents := null;
    return new;
  end if;
  -- Once people have bid, the seller can't move the goalposts.
  if tg_op = 'UPDATE' and old.mode = 'auction' and old.auction_state = 'open'
     and exists (select 1 from bids b where b.product_id = old.id and b.round = old.auction_round)
     and (new.price_cents <> old.price_cents or new.reserve_cents is distinct from old.reserve_cents
          or new.auction_ends_at <> old.auction_ends_at or new.status <> old.status
          or new.title <> old.title or new.description <> old.description or new.label <> old.label
          or new.condition is distinct from old.condition or new.sizes <> old.sizes) then
    raise exception 'You can''t change an auction once people have bid.';
  end if;
  -- A won or paid auction can't be put back up: that would sell the item twice.
  if tg_op = 'UPDATE' and old.auction_state in ('won', 'paid') and new.status is distinct from old.status and new.status = 'live' then
    raise exception 'This auction already has a winner.';
  end if;
  -- Starting (or restarting) an auction.
  if new.status = 'live' and (tg_op = 'INSERT' or old.status <> 'live' or old.mode <> 'auction') then
    if new.auction_ends_at is null or new.auction_ends_at < now() + interval '55 minutes' or new.auction_ends_at > now() + interval '7 days 1 hour' then
      raise exception 'Auctions run for 1 to 7 days.' using errcode = 'check_violation';
    end if;
    if new.reserve_cents is not null and (new.reserve_cents < new.price_cents or new.reserve_cents > new.price_cents * 10) then
      raise exception 'The reserve must be between the starting bid and 10 times it.' using errcode = 'check_violation';
    end if;
    new.stock := 1;
    new.auction_state := 'open';
    new.auction_round := coalesce(old.auction_round, 0) + case when tg_op = 'UPDATE' then 1 else 0 end;
    new.auction_winner := null; new.auction_price_cents := null; new.auction_pay_by := null;
  end if;
  return new;
end $$;

-- Checked first, before any other listing rule, so the reason is clear.
create function auction_won_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not auction_internal() and old.auction_state in ('won', 'paid') and new.status is distinct from old.status and new.status = 'live' then
    raise exception 'This auction already has a winner.';
  end if;
  return new;
end $$;
create trigger aa_products_auction_won before update on products for each row execute function auction_won_guard();

-- ===== 6. Payouts held for suspended sellers and unchecked bank changes =====
create or replace function payouts_feature() returns trigger language plpgsql security definer set search_path = public as $$
declare st text := feature_state(shop_owner(new.shop_id), 'payouts');
begin
  -- Suspended sellers, and sellers whose bank account changed and isn't checked yet, are held whatever the switch says.
  if new.status = 'scheduled' and (is_suspended(shop_owner(new.shop_id))
      or exists (select 1 from seller_checks where shop_id = new.shop_id and bank_status <> 'approved')) then
    new.status := 'held'; new.pay_on := null; return new;
  end if;
  if st = 'off' and new.status = 'scheduled' then new.status := 'held'; new.pay_on := null;
  elsif st = 'on' and new.status = 'held' then new.status := 'scheduled'; new.pay_on := greatest(new.releasable_at::date, current_date);
  end if;
  return new;
end $$;
-- Suspending holds everything already scheduled. Lifting it doesn't release them: the team does that on purpose
-- (account page, Features, Payouts).
create function hold_payouts_on_suspend() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update payouts set status = 'held', pay_on = null where status = 'scheduled' and shop_id in (select id from shops where owner_id = new.user_id);
  return new;
end $$;
create trigger hold_payouts_on_suspend after insert on suspensions for each row execute function hold_payouts_on_suspend();
create function hold_payouts_on_bank_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bank_status <> 'approved' and old.bank_status = 'approved' then
    update payouts set status = 'held', pay_on = null where status = 'scheduled' and shop_id = new.shop_id;
  end if;
  return new;
end $$;
create trigger hold_payouts_on_bank_change after update on seller_checks for each row execute function hold_payouts_on_bank_change();
-- No new orders go to a shop whose payout account is waiting for our check (the checkout function says so nicely).
create function orders_bank_ok() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from seller_checks where shop_id = new.shop_id and bank_status = 'approved') then
    raise exception 'This seller cannot take payments right now.';
  end if;
  return new;
end $$;
create trigger ab_orders_bank_ok before insert on orders for each row execute function orders_bank_ok();

-- ===== 7. Rate limits can't be dodged by backdating =====
-- Every limit counts rows by created_at, and people could set created_at themselves. Now the database sets it.
create function force_created_now() returns trigger language plpgsql as $$
begin
  if auth.role() is distinct from 'service_role' then new.created_at := now(); end if;
  return new;
end $$;
create trigger aa_now before insert on messages for each row execute function force_created_now();
create trigger aa_now before insert on comments for each row execute function force_created_now();
create trigger aa_now before insert on conversations for each row execute function force_created_now();
create trigger aa_now before insert on reports for each row execute function force_created_now();
create trigger aa_now before insert on app_errors for each row execute function force_created_now();
create trigger aa_now before insert on bids for each row execute function force_created_now();
create trigger aa_now before insert on offers for each row execute function force_created_now();
create trigger aa_now before insert on media for each row execute function force_created_now();
create trigger aa_now before insert on listing_photos for each row execute function force_created_now();
-- Signed out error reports have no user to count by: at most 300 an hour in total, the rest are dropped quietly.
create function anon_errors_cap() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null and (select count(*) from app_errors where user_id is null and created_at > now() - interval '1 hour') >= 300 then
    return null;
  end if;
  return new;
end $$;
create trigger ac_anon_errors_cap before insert on app_errors for each row execute function anon_errors_cap();
-- At most 10 photos per listing, even in one big insert.
create unique index listing_photos_one_per_position on listing_photos (product_id, position);

-- ===== 8. Hidden product fields stay hidden =====
-- The secret auction reserve, the private proof file path and the winner's id were readable by anyone.
revoke select on products from anon, authenticated;
grant select (id, shop_id, title, description, price_cents, mode, label, condition, sizes, stock, lead_days, allergens,
  proof_status, status, removed_reason, created_at, held_for, held_until, auction_ends_at, auction_state, auction_round,
  auction_price_cents, auction_pay_by) on products to anon, authenticated;

-- ===== 9. Private facts about people =====
revoke execute on function is_suspended(uuid) from public, anon, authenticated;
create or replace function blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  -- Only answers for the person asking (or the server), so nobody can test who blocked whom.
  select (auth.uid() in (a, b) or auth.uid() is null or is_admin())
     and exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;
-- Team only functions: not even callable by signed out visitors (they also check is_admin() inside).
revoke execute on function admin_features(uuid), admin_set_feature(uuid, text, text, text), admin_packing(uuid),
  admin_packing_shared(uuid, text), admin_packing_review(uuid, boolean, text), admin_packing_queue(), admin_rewards(uuid) from public, anon;
revoke execute on function my_rewards() from public, anon;
-- New functions start locked for everyone (the per schema rule in 0018 didn't cover the global default).
alter default privileges revoke execute on functions from public;

-- ===== 10. Names and text sizes =====
alter table profiles add constraint profiles_text_sizes check (length(display_name) <= 40 and length(city) <= 60 and length(coalesce(bio, '')) <= 300) not valid;
alter table shops add constraint shops_text_sizes check (length(bio) <= 300 and length(city) <= 60) not valid;
-- Nobody can pose as us.
create function profiles_name_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.display_name, '')) ~ '(myhaul|my haul|support|official|\madmin\M|\mteam\M|help ?desk)' and not is_admin() then
    if auth.uid() is null then new.display_name := ''; else raise exception 'That name is reserved. Pick another.'; end if;
  end if;
  return new;
end $$;
create trigger profiles_name_guard before insert or update of display_name on profiles for each row execute function profiles_name_guard();

-- ===== 11. Trust can't be farmed with cheap orders from the same friends =====
-- Kept orders, 5 star reviews and fast shipping only count on orders of R100 or more, once per buyer per 90 days.
create or replace function add_trust_event(p_user uuid, p_kind trust_event_kind, p_order uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if p_order is not null and p_kind in ('order_kept', 'five_star_review', 'fast_ship_with_video') then
    select * into o from orders where id = p_order;
    if o.item_price_cents < 10000 then return; end if;
    if exists (select 1 from trust_events te join orders x on x.id = te.order_id
               where te.user_id = p_user and te.kind = p_kind and x.buyer_id = o.buyer_id and x.id <> o.id and te.created_at > now() - interval '90 days') then
      return;
    end if;
  end if;
  insert into trust_events (user_id, kind, points, order_id, note)
  select p_user, p_kind, points, p_order, p_note from trust_rules where kind = p_kind;
end $$;
-- Auctions unlock on 5 good orders from 5 different buyers, each R100 or more.
create or replace function good_orders(p_shop uuid) returns int language sql stable security definer set search_path = public as $$
  select count(distinct o.buyer_id)::int from orders o
  where o.shop_id = p_shop and o.status = 'completed' and o.item_price_cents >= 10000
    and not exists (select 1 from reviews r where r.order_id = o.id and r.stars < 4);
$$;

-- ===== 12. Disputes can be sent once =====
alter table returns add column disputed_at timestamptz;

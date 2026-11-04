-- Per account feature switches. The team sets each feature to auto (the normal rules and milestones), on or off
-- for one account on the dashboard (/team/accounts/<id>, Features). The list and wording live in
-- packages/core/src/accountFeatures.ts. Everything is enforced here, so a changed app can't get around it.
--
-- "On" only skips a milestone (5 good orders for auctions, Live early access, low trust for the feed, Restricted payouts).
-- It never skips a legal or safety check: ID and bank checks, the food certificate, designer proof, adult
-- confirmation and suspensions always apply. Features that are only about those checks can only be turned off.

create table account_features (
  user_id uuid not null references profiles (id) on delete cascade,
  feature text not null check (feature in ('buy', 'bid', 'comment', 'message', 'welcome_credit',
                                           'sell', 'auctions', 'live', 'offers', 'in_feed', 'payouts')),
  state text not null check (state in ('on', 'off')),
  -- Only these features may be forced on. The rest can only be turned off.
  check (state = 'off' or feature in ('auctions', 'live', 'in_feed', 'payouts')),
  reason text not null check (length(reason) between 1 and 300),
  by_admin uuid references profiles (id) on delete set null,
  at timestamptz not null default now(),
  primary key (user_id, feature)
);
alter table account_features enable row level security;
-- People see which of their own switches are set, not the team's private reason. The team sees everything.
grant select (user_id, feature, state, at) on account_features to authenticated;
create policy "you see your own switches, the team sees all" on account_features for select to authenticated
  using (user_id = auth.uid() or is_admin());
-- The reason column needs its own read path for the team (column grants above leave it out).
grant select on account_features to service_role;

-- 'auto' when nothing is set.
create function feature_state(p_user uuid, p_feature text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select state from account_features where user_id = p_user and feature = p_feature), 'auto');
$$;
revoke execute on function feature_state(uuid, text) from public, anon, authenticated;

-- ===== Turning things off: a hard block on the action itself =====
create function block_feature_off() returns trigger language plpgsql security definer set search_path = public as $$
declare who uuid; f text := tg_argv[1]; label text;
begin
  if is_admin() or auth.role() = 'service_role' then return new; end if;
  if tg_argv[0] = 'shop_id' then who := shop_owner((to_jsonb(new) ->> 'shop_id')::uuid);
  else who := (to_jsonb(new) ->> tg_argv[0])::uuid; end if;
  -- Listings only count when they go live (drafts are fine). Nested so other tables never read these columns.
  if tg_table_name = 'products' then
    if tg_op = 'UPDATE' then
      if not (new.status = 'live' and (old.status <> 'live' or new.mode <> old.mode)) then return new; end if;
    elsif new.status <> 'live' then return new;
    end if;
    if f = 'auctions' and new.mode <> 'auction' then return new; end if;
  end if;
  if feature_state(who, f) = 'off' then
    label := case f when 'buy' then 'Buying' when 'bid' then 'Bidding' when 'comment' then 'Comments' when 'message' then 'Messages'
                    when 'sell' then 'Listing items' when 'auctions' then 'Auctions' when 'offers' then 'Special prices in chat' else f end;
    raise exception '% is turned off for your account. Email help@myhaul.co.za if you think this is a mistake.', label
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger ab_orders_feature before insert on orders for each row execute function block_feature_off('buyer_id', 'buy');
create trigger ab_bids_feature before insert on bids for each row execute function block_feature_off('bidder_id', 'bid');
create trigger ab_comments_feature before insert on comments for each row execute function block_feature_off('user_id', 'comment');
create trigger ab_messages_feature before insert on messages for each row execute function block_feature_off('sender_id', 'message');
create trigger ab_conversations_feature before insert on conversations for each row execute function block_feature_off('buyer_id', 'message');
create trigger ab_offers_feature before insert on offers for each row execute function block_feature_off('shop_id', 'offers');
create trigger ab_posts_feature before insert on posts for each row execute function block_feature_off('shop_id', 'sell');
create trigger ab_products_sell_feature before insert or update on products for each row execute function block_feature_off('shop_id', 'sell');
create trigger ab_products_auction_feature before insert or update on products for each row execute function block_feature_off('shop_id', 'auctions');

-- ===== Payouts: held when off, paid on time when on =====
create function payouts_feature() returns trigger language plpgsql security definer set search_path = public as $$
declare st text := feature_state(shop_owner(new.shop_id), 'payouts');
begin
  if st = 'off' and new.status = 'scheduled' then new.status := 'held'; new.pay_on := null;
  elsif st = 'on' and new.status = 'held' then new.status := 'scheduled'; new.pay_on := greatest(new.releasable_at::date, current_date);
  end if;
  return new;
end $$;
create trigger ab_payouts_feature before insert on payouts for each row execute function payouts_feature();

-- ===== Turning things on: the milestone rules read the switch =====
-- Auctions: "on" skips the 5 good orders rule. Everything else in the guard is unchanged.
create or replace function products_guard() returns trigger
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
    if new.mode = 'auction' and feature_state(shop_owner(new.shop_id), 'auctions') <> 'on' and good_orders(new.shop_id) < 5 then
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

-- Feed: "off" hides the shop, "on" shows it even under a trust score of 40.
create or replace function feed(p_limit int default 20, p_offset int default 0)
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
  left join account_features f on f.user_id = pr.id and f.feature = 'in_feed'
  where po.status = 'live' and p.status = 'live' and s.status = 'open' and m.status = 'ready'
    and (pr.trust_score >= 40 or f.state = 'on') and f.state is distinct from 'off'
  order by rank desc, po.created_at desc
  limit least(p_limit, 50) offset p_offset;
$$;

-- Welcome credit: "off" means never.
create or replace function welcome_credit_ok(p_buyer uuid, p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not p.welcome_credit_used
     and p.handle is not null and p.adult_confirmed_at is not null
     and not is_suspended(p.id)
     and feature_state(p.id, 'welcome_credit') <> 'off'
     and not exists (select 1 from orders o where o.buyer_id = p.id and (o.credit_cents > 0 and o.status <> 'cancelled'
                     or o.status not in ('pending_payment', 'cancelled')))
     and (select coalesce(sum(credit_cents), 0) from orders where credit_cents > 0 and status not in ('cancelled'))
         + 5000 <= (select value from app_limits where key = 'welcome_credit_budget_cents')
     and (select count(*) from orders where shop_id = p_shop and credit_cents > 0 and status <> 'cancelled' and created_at > now() - interval '30 days')
         < (select value from app_limits where key = 'welcome_credit_per_seller_30d')
  from profiles p where p.id = p_buyer;
$$;

-- ===== Fix: sellers could not create auctions =====
-- The app sends the end time and reserve when it creates an auction, but sellers were only allowed to change them later,
-- so every new auction was refused with "permission denied". auction_guard checks both values.
grant insert (auction_ends_at, reserve_cents) on products to authenticated;

-- ===== The dashboard =====
-- Every switch for one account, with what the normal rule says right now.
create function admin_features(p_user uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sid uuid; good int := 0; trust int; ready boolean := false; out jsonb;
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  select trust_score into trust from profiles where id = p_user;
  if trust is null then raise exception 'Account not found.'; end if;
  select id into sid from shops where owner_id = p_user;
  if sid is not null then
    good := good_orders(sid);
    select coalesce(can_sell, false) into ready from seller_ready where shop_id = sid;
  end if;
  select jsonb_object_agg(k, jsonb_build_object(
      'state', coalesce(f.state, 'auto'), 'reason', f.reason, 'at', f.at,
      'by', (select coalesce(handle, display_name) from profiles where id = f.by_admin),
      'autoOk', case k
        when 'sell' then ready
        when 'auctions' then good >= 5
        when 'live' then good >= 5
        when 'in_feed' then trust >= 40
        when 'payouts' then trust >= 40
        when 'welcome_credit' then welcome_credit_ok(p_user, sid)
        else true end,
      'autoNote', case k
        when 'sell' then case when sid is null then 'No shop yet' when ready then 'Checks done' else 'Waiting for ID and bank checks' end
        when 'auctions' then good || ' of 5 good orders'
        when 'live' then good || ' of 5 good orders'
        when 'in_feed' then 'Trust ' || trust
        when 'payouts' then case when trust >= 40 then 'Paid by trust tier' else 'Held: Restricted' end
        when 'welcome_credit' then case when welcome_credit_ok(p_user, sid) then 'Can still use it' else 'Used or not available' end
        else 'Allowed' end))
  into out
  from unnest(array['buy', 'bid', 'comment', 'message', 'welcome_credit', 'sell', 'auctions', 'live', 'offers', 'in_feed', 'payouts']) k
  left join account_features f on f.user_id = p_user and f.feature = k;
  return out;
end $$;

-- Set one switch. 'auto' removes it. A reason is needed for on and off; it shows in the activity log, not to the person.
create function admin_set_feature(p_user uuid, p_feature text, p_state text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare label text;
begin
  if not is_admin() then raise exception 'Only our team can do this.'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'Account not found.'; end if;
  if p_state not in ('auto', 'on', 'off') then raise exception 'Pick auto, on or off.'; end if;
  if p_state = 'on' and p_feature not in ('auctions', 'live', 'in_feed', 'payouts') then
    raise exception 'This one can only be turned off. Its checks protect buyers and are required by law.';
  end if;
  label := case p_feature when 'buy' then 'Buying' when 'bid' then 'Bidding' when 'comment' then 'Comments' when 'message' then 'Messages'
    when 'welcome_credit' then 'Welcome credit' when 'sell' then 'Listing items' when 'auctions' then 'Auctions' when 'live' then 'Live selling'
    when 'offers' then 'Special prices in chat' when 'in_feed' then 'Shown in the feed' when 'payouts' then 'Payouts' end;
  if label is null then raise exception 'Unknown feature.'; end if;
  if p_state = 'auto' then
    delete from account_features where user_id = p_user and feature = p_feature;
    if not found then return; end if;
  else
    if coalesce(trim(p_reason), '') = '' then raise exception 'Add a reason so the team knows why.'; end if;
    insert into account_features (user_id, feature, state, reason, by_admin) values (p_user, p_feature, p_state, left(trim(p_reason), 300), auth.uid())
    on conflict (user_id, feature) do update set state = excluded.state, reason = excluded.reason, by_admin = excluded.by_admin, at = now();
  end if;
  -- Payouts already waiting follow the new switch straight away.
  if p_feature = 'payouts' then
    if p_state = 'off' then
      update payouts set status = 'held', pay_on = null where status = 'scheduled' and shop_id in (select id from shops where owner_id = p_user);
    elsif p_state = 'on' or (select trust_score from profiles where id = p_user) >= 40 then
      -- Back to normal: pay what is due from today. (Normal timing by tier applies to new payouts.)
      update payouts set status = 'scheduled', pay_on = greatest(releasable_at::date, current_date)
      where status = 'held' and shop_id in (select id from shops where owner_id = p_user);
    end if;
  end if;
  perform log_admin(label || ': ' || case p_state when 'auto' then 'back to normal rules' when 'on' then 'turned on' else 'turned off' end,
    'user', p_user, nullif(trim(coalesce(p_reason, '')), ''));
  if p_state = 'off' then
    perform notify(p_user, 'account', label || ' is turned off for your account', 'Email help@myhaul.co.za if you think this is a mistake.', null);
  elsif p_state = 'on' and p_feature in ('auctions', 'live') then
    perform notify(p_user, 'account', label || ' unlocked for your shop', 'Our team turned it on early for you.', null);
  end if;
end $$;

grant execute on function admin_features(uuid), admin_set_feature(uuid, text, text, text) to authenticated;

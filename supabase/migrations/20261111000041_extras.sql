-- Extras (2026-11-11, asked by Ofentse): live updates for chats and auctions, posts by id, shop reviews,
-- search with filters, seller stats and invite a friend.

-- ===== 1. Chats and auctions update straight away (Supabase Realtime) =====
-- Realtime checks each person's read rules, so people only hear about messages in their own chats.
-- Bids are private, so a bid bumps a small public row instead (product and time, nothing else).
create table auction_ticks (
  product_id uuid primary key references products (id) on delete cascade,
  at timestamptz not null default now()
);
alter table auction_ticks enable row level security;
grant select on auction_ticks to anon, authenticated;
create policy "anyone sees that an auction moved" on auction_ticks for select using (true);

create function bump_auction_tick() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into auction_ticks (product_id, at) values (new.product_id, clock_timestamp())
    on conflict (product_id) do update set at = excluded.at;
  return new;
end $$;
revoke execute on function bump_auction_tick() from public, anon, authenticated;
create trigger zz_bids_tick after insert on bids for each row execute function bump_auction_tick();

-- Settling an auction (won, unsold, paid) changes the product, so that bumps the tick too.
create function bump_auction_tick_product() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.mode = 'auction' and (new.auction_state is distinct from old.auction_state or new.auction_ends_at is distinct from old.auction_ends_at) then
    insert into auction_ticks (product_id, at) values (new.id, clock_timestamp())
      on conflict (product_id) do update set at = excluded.at;
  end if;
  return new;
end $$;
revoke execute on function bump_auction_tick_product() from public, anon, authenticated;
create trigger zz_products_tick after update on products for each row execute function bump_auction_tick_product();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table messages, friend_messages, auction_ticks;
  end if;
end $$;

-- ===== 2. Every post the public can see, in one place =====
-- The feed, posts by id, and search all read from this, so the "who shows" rule lives once.
create function public_posts()
returns table (
  post_id uuid, caption text, posted_at timestamptz,
  product_id uuid, title text, description text, price_cents int, mode sale_mode, label listing_label,
  condition item_condition, sizes text[], stock int, lead_days int, allergens text,
  shop_id uuid, shop_name text, shop_handle text, category shop_category, trust_score int, tier text,
  playback_id text, storage_path text, edit jsonb, clips jsonb, province text, sales_30d bigint
) language sql stable security definer set search_path = public as $$
  select po.id, po.caption, po.created_at,
         p.id, p.title, p.description, p.price_cents, p.mode, p.label, p.condition, p.sizes, p.stock, p.lead_days, p.allergens,
         s.id, s.name, s.handle, s.category, pr.trust_score, tier_for(pr.trust_score),
         m.mux_playback_id, m.storage_path,
         po.edit, case when po.edit is not null then post_clips(po.edit) end,
         sp.province,
         (select count(*) from orders o where o.shop_id = s.id and o.status not in ('pending_payment', 'cancelled', 'refunded')
            and o.created_at > now() - interval '30 days')
  from posts po
  join products p on p.id = po.product_id
  join shops s on s.id = po.shop_id
  join profiles pr on pr.id = s.owner_id
  join media m on m.id = po.media_id
  left join shop_pickup sp on sp.shop_id = s.id
  left join account_features f on f.user_id = pr.id and f.feature = 'in_feed'
  where po.status = 'live' and p.status = 'live' and s.status = 'open' and m.status = 'ready'
    and (pr.trust_score >= 40 or f.state = 'on') and f.state is distinct from 'off';
$$;
revoke execute on function public_posts() from public, anon, authenticated;

-- Posts by id, for Liked, Reposted, Following reposts and shared cards (no longer limited to the first 50 of the feed).
create function feed_posts(p_ids uuid[])
returns table (
  post_id uuid, caption text, posted_at timestamptz,
  product_id uuid, title text, description text, price_cents int, mode sale_mode, label listing_label,
  condition item_condition, sizes text[], stock int, lead_days int, allergens text,
  shop_id uuid, shop_name text, shop_handle text, category shop_category, trust_score int, tier text,
  playback_id text, storage_path text, edit jsonb, clips jsonb, province text
) language sql stable security definer set search_path = public as $$
  select post_id, caption, posted_at, product_id, title, description, price_cents, mode, label, condition, sizes, stock, lead_days, allergens,
         shop_id, shop_name, shop_handle, category, trust_score, tier, playback_id, storage_path, edit, clips, province
  from public_posts() where post_id = any (p_ids[1:200]);
$$;
grant execute on function feed_posts(uuid[]) to anon, authenticated;

-- ===== 3. Search with filters =====
-- Every word has to match the title, description, caption, shop or sizes. Filters: category, size, price, province.
-- Sort: best (same as the feed), new, low (price low to high), high.
create function search_items(p_q text default '', p_category text default null, p_size text default null,
  p_min int default null, p_max int default null, p_province text default null, p_sort text default 'best',
  p_limit int default 20, p_offset int default 0)
returns table (
  post_id uuid, caption text, posted_at timestamptz,
  product_id uuid, title text, description text, price_cents int, mode sale_mode, label listing_label,
  condition item_condition, sizes text[], stock int, lead_days int, allergens text,
  shop_id uuid, shop_name text, shop_handle text, category shop_category, trust_score int, tier text,
  playback_id text, storage_path text, edit jsonb, clips jsonb, province text
) language sql stable security definer set search_path = public as $$
  with words as (
    select replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') as w
    from unnest(string_to_array(lower(left(coalesce(p_q, ''), 100)), ' ')) w where w <> ''
  )
  select x.post_id, x.caption, x.posted_at, x.product_id, x.title, x.description, x.price_cents, x.mode, x.label, x.condition, x.sizes, x.stock,
         x.lead_days, x.allergens, x.shop_id, x.shop_name, x.shop_handle, x.category, x.trust_score, x.tier, x.playback_id, x.storage_path,
         x.edit, x.clips, x.province
  from public_posts() x
  where (p_category is null or x.category::text = p_category)
    and (p_size is null or exists (select 1 from unnest(x.sizes) z where lower(z) = lower(p_size)))
    and (p_min is null or x.price_cents >= p_min)
    and (p_max is null or x.price_cents <= p_max)
    and (p_province is null or x.province = p_province)
    and not exists (
      select 1 from words
      where lower(x.title || ' ' || coalesce(x.description, '') || ' ' || coalesce(x.caption, '') || ' ' || x.shop_name || ' ' || x.shop_handle
                  || ' ' || array_to_string(x.sizes, ' ')) not like '%' || words.w || '%')
  order by
    case when p_sort = 'low' then x.price_cents end asc nulls last,
    case when p_sort = 'high' then x.price_cents end desc nulls last,
    case when p_sort = 'new' then x.posted_at end desc nulls last,
    (3 * x.sales_30d + case x.tier when 'top' then 10 when 'trusted' then 5 else 0 end
      - extract(epoch from now() - x.posted_at) / 3600 / 24) desc,
    x.posted_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;
grant execute on function search_items(text, text, text, int, int, text, text, int, int) to anon, authenticated;

-- The sizes people can pick from: every size on a live listing, most common first.
create function search_sizes() returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(z order by n desc, z), '{}') from (
    select upper(z) as z, count(*) as n from public_posts() x, unnest(x.sizes) z group by upper(z) order by count(*) desc limit 30) t;
$$;
grant execute on function search_sizes() to anon, authenticated;

-- ===== 4. Shop reviews on shop pages =====
-- Stars and words only. Who wrote it stays hidden (the 2026-11-05 privacy fix): "A buyer", the item, the month.
create function shop_reviews(p_shop uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'count', count(*),
    'average', round(avg(r.stars)::numeric, 1),
    'stars', jsonb_build_object('5', count(*) filter (where r.stars = 5), '4', count(*) filter (where r.stars = 4),
      '3', count(*) filter (where r.stars = 3), '2', count(*) filter (where r.stars = 2), '1', count(*) filter (where r.stars = 1)),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('stars', q.stars, 'body', q.body, 'item', q.item, 'month', to_char(q.created_at, 'YYYY-MM')) order by q.created_at desc)
      from (select r2.stars, r2.body, r2.created_at, p.title as item
            from reviews r2 join orders o on o.id = r2.order_id join products p on p.id = o.product_id
            where r2.shop_id = p_shop and not is_suspended(r2.buyer_id) and length(trim(r2.body)) > 0
            order by r2.created_at desc limit 20) q), '[]'::jsonb))
  from reviews r where r.shop_id = p_shop and not is_suspended(r.buyer_id);
$$;
grant execute on function shop_reviews(uuid) to anon, authenticated;

-- ===== 5. Seller stats =====
-- A view counts once per signed in person per post per day (so refreshing doesn't pad it). Owners don't count.
create table post_seen (
  post_id uuid not null references posts (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  day date not null default current_date,
  primary key (post_id, user_id, day)
);
create index post_seen_day on post_seen (day);
alter table post_seen enable row level security; -- no app access: written and read only through the functions below

create function record_views(p_posts uuid[]) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or coalesce(array_length(p_posts, 1), 0) = 0 then return; end if;
  insert into post_seen (post_id, user_id)
    select po.id, auth.uid() from posts po join shops s on s.id = po.shop_id
    where po.id = any (p_posts[1:30]) and s.owner_id <> auth.uid()
    on conflict do nothing;
end $$;
revoke execute on function record_views(uuid[]) from public, anon;
grant execute on function record_views(uuid[]) to authenticated;

-- My shop's numbers for the last 7, 30 or 90 days, with the day by day views and sales and the top items.
create function seller_stats(p_days int default 30) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare sid uuid; d int := case when p_days in (7, 30, 90) then p_days else 30 end; since timestamptz; result jsonb;
begin
  select id into sid from shops where owner_id = auth.uid();
  if sid is null then raise exception 'You don''t have a shop yet.'; end if;
  since := date_trunc('day', now()) - make_interval(days => d - 1);
  with sold as (
    select o.*, coalesce(p.from_product_id, p.id) as item_id from orders o join products p on p.id = o.product_id
    where o.shop_id = sid and o.created_at >= since and o.status not in ('pending_payment', 'cancelled', 'refunded')),
  seen as (select ps.* from post_seen ps join posts po on po.id = ps.post_id where po.shop_id = sid and ps.day >= since::date),
  days as (select generate_series(since::date, current_date, interval '1 day')::date as day)
  select jsonb_build_object(
    'days', d,
    'views', (select count(*) from seen),
    'viewers', (select count(distinct user_id) from seen),
    'likes', (select count(*) from post_reactions r join posts po on po.id = r.post_id where po.shop_id = sid and r.kind = 'like' and r.created_at >= since),
    'reposts', (select count(*) from post_reactions r join posts po on po.id = r.post_id where po.shop_id = sid and r.kind = 'repost' and r.created_at >= since),
    'newFollowers', (select count(*) from follows f where f.shop_id = sid and f.created_at >= since),
    'followers', (select count(*) from follows f where f.shop_id = sid),
    'orders', (select count(*) from sold),
    'salesCents', (select coalesce(sum(item_price_cents), 0) from sold),
    'buyers', (select count(distinct buyer_id) from sold),
    'returns', (select count(*) from orders o where o.shop_id = sid and o.created_at >= since and o.status in ('return_requested', 'return_in_transit', 'refunded')),
    'liveShows', (select count(*) from live_shows ls where ls.shop_id = sid and ls.started_at >= since),
    'series', (select jsonb_agg(jsonb_build_object('day', days.day,
        'views', (select count(*) from seen where seen.day = days.day),
        'salesCents', (select coalesce(sum(item_price_cents), 0) from sold where sold.created_at::date = days.day)) order by days.day) from days),
    'top', coalesce((select jsonb_agg(t order by t.sort desc) from (
        select jsonb_build_object('productId', p.id, 'title', p.title,
                 'views', (select count(*) from seen join posts po on po.id = seen.post_id where po.product_id = p.id),
                 'orders', (select count(*) from sold where sold.item_id = p.id),
                 'salesCents', (select coalesce(sum(item_price_cents), 0) from sold where sold.item_id = p.id)) as t,
               (select coalesce(sum(item_price_cents), 0) from sold where sold.item_id = p.id) * 1000
                 + (select count(*) from seen join posts po on po.id = seen.post_id where po.product_id = p.id) as sort
        from products p where p.shop_id = sid and p.from_product_id is null and p.status <> 'removed'
        order by sort desc limit 5) t where (t.t->>'views')::int > 0 or (t.t->>'orders')::int > 0), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke execute on function seller_stats(int) from public, anon;
grant execute on function seller_stats(int) to authenticated;

-- ===== 6. Invite a friend =====
-- Your invite link is myhaul.co.za/?invite=<your username>. A new account that opens it (within a day of joining,
-- before any order) is linked to you: you follow each other, so you're friends straight away, and you're told.
-- Rewards for inviting are in section 7 below.
alter table profiles add column invited_by uuid references profiles (id) on delete set null;

create function accept_invite(p_handle text) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare me profiles; inviter profiles;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.invited_by is not null then return false; end if;
  if me.created_at < now() - interval '1 day' or exists (select 1 from orders where buyer_id = me.id) then return false; end if;
  select * into inviter from profiles where handle = lower(trim(p_handle));
  if inviter.id is null or inviter.id = me.id or is_suspended(inviter.id) or blocked_between(me.id, inviter.id) then return false; end if;
  update profiles set invited_by = inviter.id where id = me.id;
  insert into people_follows (follower_id, followee_id) values (me.id, inviter.id), (inviter.id, me.id) on conflict do nothing;
  perform notify(inviter.id, 'invite', coalesce(nullif(me.display_name, ''), 'Someone') || ' joined from your invite',
    'You follow each other now, so you can chat and share finds.', case when me.handle is not null then '/u/' || me.handle end);
  return true;
end $$;
revoke execute on function accept_invite(text) from public, anon;
grant execute on function accept_invite(text) to authenticated;

create function my_invites() returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from profiles where invited_by = auth.uid();
$$;
grant execute on function my_invites() to authenticated;

-- Keep the view log small: 120 days is enough for the 90 day stats.
create function prune_post_seen() returns void language sql security definer set search_path = public as $$
  delete from post_seen where day < current_date - 120;
$$;
revoke execute on function prune_post_seen() from public, anon, authenticated;
grant execute on function prune_post_seen() to service_role;

-- ===== 7. Invite rewards (Ofentse, 2026-11-11) =====
-- When an invited friend's first purchase passes its return window (the order is completed), the friend gets R50 and
-- so does the inviter, if the inviter had already bought something themselves. Both are ready to use straight away.
-- Abuse guards, same as the surprise rewards: the order must be R100 or more and carried by a courier with tracking;
-- the friend can't buy from the inviter's own shop; suspended accounts and the team switch "welcome_credit" off get
-- nothing; the R15,000 reward budget applies; an inviter earns at most 10 invite rewards [CONFIRM the cap].
alter table rewards drop constraint rewards_kind_check;
alter table rewards add constraint rewards_kind_check check (kind in ('first_buy', 'first_auction', 'first_sale', 'invite_sent', 'invite_joined'));
-- One of each kind per person, except inviting, which you can earn once per friend.
alter table rewards drop constraint rewards_user_id_kind_key;
create unique index rewards_one_each on rewards (user_id, kind) where kind <> 'invite_sent';
create unique index rewards_invite_once_per_order on rewards (user_id, earned_order_id) where kind = 'invite_sent';
insert into app_limits (key, value, note) values
  ('invite_rewards_per_person', 10, 'Most invite rewards one person can earn. [CONFIRM with Ofentse]')
  on conflict (key) do nothing;

-- Same as before, but the "one of each" check names the new index.
create or replace function grant_reward(p_user uuid, p_kind text, p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare o orders; budget bigint;
begin
  select * into o from orders where id = p_order;
  if p_user is null or is_suspended(p_user) or feature_state(p_user, 'welcome_credit') = 'off' then return; end if;
  if exists (select 1 from rewards where user_id = p_user and kind = p_kind) then return; end if;
  if o.item_price_cents < 10000 then return; end if;
  if o.delivery not in ('courier', 'pudo_locker') or o.tracking_ref is null then return; end if;
  if p_kind <> 'first_sale' and (select count(*) from rewards r join orders x on x.id = r.earned_order_id
      where x.shop_id = o.shop_id and r.kind <> 'first_sale' and r.created_at > now() - interval '30 days')
      >= (select value from app_limits where key = 'welcome_credit_per_seller_30d') then return; end if;
  select value into budget from app_limits where key = 'welcome_credit_budget_cents';
  if (select coalesce(sum(amount_cents), 0) from rewards where status <> 'forfeited') + 5000 > coalesce(budget, 0) then return; end if;
  insert into rewards (user_id, kind, amount_cents, earned_order_id, usable_from)
    values (p_user, p_kind, 5000, p_order, coalesce(o.releasable_at, now() + interval '7 days'))
    on conflict (user_id, kind) where kind <> 'invite_sent' do nothing;
  if found then
    perform notify(p_user, 'reward', 'Surprise! You earned R50',
      case p_kind when 'first_buy' then 'A thank you for your first order.' when 'first_auction' then 'A thank you for your first auction win.'
                  else 'A thank you for your first sale.' end
      || ' It''s yours to spend once the return window closes. One reward comes off an order of R200 or more.', '/me');
  end if;
end $$;
revoke execute on function grant_reward(uuid, text, uuid) from public, anon, authenticated;

create function invite_rewards() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare friend profiles; inviter profiles; budget bigint; given bigint;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  select * into friend from profiles where id = new.buyer_id;
  if friend.invited_by is null then return new; end if;
  select * into inviter from profiles where id = friend.invited_by;
  -- Only the friend's first purchase counts, and only a real, tracked one.
  if exists (select 1 from rewards where user_id = friend.id and kind = 'invite_joined') then return new; end if;
  if new.item_price_cents < 10000 or new.delivery not in ('courier', 'pudo_locker') or new.tracking_ref is null then return new; end if;
  if shop_owner(new.shop_id) = inviter.id then return new; end if;
  if exists (select 1 from orders x where x.buyer_id = friend.id and x.id <> new.id and x.status = 'completed' and x.created_at < new.created_at) then return new; end if;
  select value into budget from app_limits where key = 'welcome_credit_budget_cents';

  -- The friend.
  given := (select coalesce(sum(amount_cents), 0) from rewards where status <> 'forfeited');
  if not is_suspended(friend.id) and feature_state(friend.id, 'welcome_credit') is distinct from 'off' and given + 5000 <= coalesce(budget, 0) then
    insert into rewards (user_id, kind, amount_cents, earned_order_id, status, usable_from)
      values (friend.id, 'invite_joined', 5000, new.id, 'ready', now())
      on conflict (user_id, kind) where kind <> 'invite_sent' do nothing;
    if found then
      perform notify(friend.id, 'reward', 'You earned R50 for joining with an invite',
        'A thank you from @' || coalesce(inviter.handle, 'your friend') || ' and us. It comes off your next order of R200 or more, by itself.', '/me');
    end if;
  end if;

  -- The inviter, if they had already bought something themselves.
  given := (select coalesce(sum(amount_cents), 0) from rewards where status <> 'forfeited');
  if inviter.id is not null and not is_suspended(inviter.id) and feature_state(inviter.id, 'welcome_credit') is distinct from 'off'
     and exists (select 1 from orders x where x.buyer_id = inviter.id and x.status in ('delivered', 'completed') and x.created_at < new.created_at)
     and (select count(*) from rewards where user_id = inviter.id and kind = 'invite_sent')
         < coalesce((select value from app_limits where key = 'invite_rewards_per_person'), 10)
     and given + 5000 <= coalesce(budget, 0) then
    insert into rewards (user_id, kind, amount_cents, earned_order_id, status, usable_from)
      values (inviter.id, 'invite_sent', 5000, new.id, 'ready', now())
      on conflict (user_id, earned_order_id) where kind = 'invite_sent' do nothing;
    if found then
      perform notify(inviter.id, 'reward', 'You earned R50 for inviting a friend',
        coalesce(nullif(friend.display_name, ''), 'Your friend') || '''s first order is done. It comes off your next order of R200 or more, by itself.', '/me');
    end if;
  end if;
  return new;
end $$;
revoke execute on function invite_rewards() from public, anon, authenticated;
create trigger zz_invite_rewards after update on orders for each row execute function invite_rewards();

-- The invite notice now mentions the reward.
create or replace function accept_invite(p_handle text) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare me profiles; inviter profiles;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.invited_by is not null then return false; end if;
  if me.created_at < now() - interval '1 day' or exists (select 1 from orders where buyer_id = me.id) then return false; end if;
  select * into inviter from profiles where handle = lower(trim(p_handle));
  if inviter.id is null or inviter.id = me.id or is_suspended(inviter.id) or blocked_between(me.id, inviter.id) then return false; end if;
  update profiles set invited_by = inviter.id where id = me.id;
  insert into people_follows (follower_id, followee_id) values (me.id, inviter.id), (inviter.id, me.id) on conflict do nothing;
  perform notify(inviter.id, 'invite', coalesce(nullif(me.display_name, ''), 'Someone') || ' joined from your invite',
    'You follow each other now. When their first order is done, you both get R50.', case when me.handle is not null then '/u/' || me.handle end);
  return true;
end $$;
revoke execute on function accept_invite(text) from public, anon;
grant execute on function accept_invite(text) to authenticated;

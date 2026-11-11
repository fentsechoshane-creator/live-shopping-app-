-- Live selling (asked for by Ofentse 11 Nov 2026). Video runs on LiveKit Cloud (the live-token function gives out
-- access); everything else lives here: shows, reminders, live chat, the pinned item and quick live auctions.
--
-- Going live has the same rules as the app's goLiveBlockers in packages/core/src/unlocks.ts: an open, checked shop,
-- at least 5 units of live Buy now stock, and 5 good orders (or our team switched Live on for the account).
--
-- A live auction sells ONE unit of a pinned Buy now listing. It's a new auction listing copied from it (one unit
-- taken from the original's stock), so the original keeps selling. If nobody wins, or the winner doesn't pay, the
-- unit goes back. Bids, max bids and paying work like any auction; only the clock differs: 10 to 120 seconds, and a
-- bid in the last 10 seconds resets it to 10 seconds, unless the seller picked sudden death (no resets).

create table live_shows (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  title text not null check (length(title) between 3 and 80),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  starts_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  pinned_product_id uuid references products (id) on delete set null,
  auction_product_id uuid references products (id) on delete set null,
  peak_viewers int not null default 0 check (peak_viewers >= 0),
  created_at timestamptz not null default now()
);
create index live_shows_status on live_shows (status, starts_at);
create index live_shows_shop on live_shows (shop_id, created_at desc);
-- One live show per shop at a time.
create unique index live_shows_one_live on live_shows (shop_id) where status = 'live';
alter table live_shows enable row level security;
grant select on live_shows to anon, authenticated;
grant select, insert, update, delete on live_shows to service_role;
create policy "anyone sees shows" on live_shows for select to anon, authenticated using (true);
-- Changes only through the functions below.

create table live_reminders (
  show_id uuid not null references live_shows (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (show_id, user_id)
);
alter table live_reminders enable row level security;
grant select, insert, delete on live_reminders to authenticated;
grant select, insert, update, delete on live_reminders to service_role;
create policy "your own reminders" on live_reminders for select to authenticated using (user_id = auth.uid());
create policy "remind yourself" on live_reminders for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from live_shows s where s.id = show_id and s.status in ('scheduled', 'live')));
create policy "stop your reminder" on live_reminders for delete to authenticated using (user_id = auth.uid());

create table live_chat (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references live_shows (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  body text not null check (length(body) between 1 and 200),
  hidden boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index live_chat_show on live_chat (show_id, created_at);
alter table live_chat enable row level security;
grant select on live_chat to anon, authenticated;
grant select, insert, update, delete on live_chat to service_role;
create policy "anyone sees visible chat" on live_chat for select to anon, authenticated using (not hidden);
-- Sent only through live_say.

-- Live chat and show changes reach watching phones straight away (Supabase Realtime), where it's set up.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table live_chat, live_shows;
  end if;
end $$;

alter table products
  add column live_show_id uuid references live_shows (id) on delete set null,
  add column from_product_id uuid references products (id) on delete set null,
  add column sudden_death boolean not null default false;
grant select (live_show_id, from_product_id, sudden_death) on products to anon, authenticated;

-- ===== Can this shop go live? Null means yes, else the reason. Same order as goLiveBlockers. =====
create function live_blocker(p_shop uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare owner uuid := shop_owner(p_shop); stock int; ready record;
begin
  if owner is null then return 'Open your shop first.'; end if;
  select * into ready from seller_ready where shop_id = p_shop;
  if not coalesce(ready.can_sell, false) then return 'Your shop goes live once your ID and bank account are checked.'; end if;
  if is_suspended(owner) or (select trust_score from profiles where id = owner) < 40 then return 'Your account is under review.'; end if;
  if feature_state(owner, 'live') = 'off' or feature_state(owner, 'sell') = 'off' then return 'Going live is switched off for your account. Contact us if you think that''s a mistake.'; end if;
  select coalesce(sum(greatest(p.stock, 0)), 0) into stock from products p where p.shop_id = p_shop and p.status = 'live' and p.mode = 'buy_now';
  if stock < 5 then
    return 'You can''t go live without stock. Have at least 5 items in stock, or 5 of one item (you have ' || stock || ').';
  end if;
  if feature_state(owner, 'live') <> 'on' and good_orders(p_shop) < 5 then
    return 'Unlocks after 5 delivered orders with good ratings (' || good_orders(p_shop) || ' so far).';
  end if;
  return null;
end $$;
revoke execute on function live_blocker(uuid) from public, anon;
grant execute on function live_blocker(uuid) to authenticated, service_role;

create function my_live_shop() returns uuid language sql stable security definer set search_path = public as $$
  select id from shops where owner_id = auth.uid();
$$;
revoke execute on function my_live_shop() from public, anon, authenticated;

-- ===== Plan a show, or start one now =====
create function live_create(p_title text, p_starts_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid := my_live_shop(); why text; new_id uuid; t text := trim(coalesce(p_title, ''));
begin
  if sid is null then raise exception 'Open your shop first.'; end if;
  why := live_blocker(sid);
  if why is not null then raise exception '%', why; end if;
  if length(t) < 3 then raise exception 'Give your show a title of at least 3 letters.'; end if;
  if length(t) > 80 then raise exception 'Keep the title under 80 letters.'; end if;
  if rude_text(t) then raise exception 'Please keep it friendly. That title has words we don''t allow.'; end if;
  if p_starts_at is not null and (p_starts_at < now() - interval '5 minutes' or p_starts_at > now() + interval '30 days') then
    raise exception 'Pick a time in the next 30 days.';
  end if;
  if (select count(*) from live_shows where shop_id = sid and status = 'scheduled' and starts_at > now()) >= 5 then
    raise exception 'You already have 5 shows planned. Start or cancel one first.';
  end if;
  insert into live_shows (shop_id, title, starts_at) values (sid, t, coalesce(p_starts_at, now())) returning live_shows.id into new_id;
  return new_id;
end $$;

-- ===== Go live: followers and everyone who asked for a reminder hear about it =====
create function live_go(p_show uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s live_shows; why text; h text; r record;
begin
  select * into s from live_shows where id = p_show for update;
  if s.id is null or s.shop_id is distinct from my_live_shop() then raise exception 'That isn''t your show.'; end if;
  if s.status = 'live' then return; end if;
  if s.status <> 'scheduled' then raise exception 'This show has ended. Start a new one.'; end if;
  why := live_blocker(s.shop_id);
  if why is not null then raise exception '%', why; end if;
  if exists (select 1 from live_shows where shop_id = s.shop_id and status = 'live') then raise exception 'You''re already live in another show. End it first.'; end if;
  update live_shows set status = 'live', started_at = now() where id = p_show;
  select handle into h from shops where id = s.shop_id;
  for r in
    select user_id from follows where shop_id = s.shop_id
    union select user_id from live_reminders where show_id = p_show
  loop
    if r.user_id <> auth.uid() and not blocked_between(r.user_id, auth.uid()) then
      perform notify(r.user_id, 'live', '@' || h || ' is live', s.title, '/live/' || p_show);
    end if;
  end loop;
end $$;

-- ===== Pin an item (or null to take it down) =====
create function live_pin(p_show uuid, p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s live_shows;
begin
  select * into s from live_shows where id = p_show for update;
  if s.id is null or s.shop_id is distinct from my_live_shop() then raise exception 'That isn''t your show.'; end if;
  if s.status <> 'live' then raise exception 'Go live first.'; end if;
  if p_product is not null and not exists (select 1 from products where id = p_product and shop_id = s.shop_id and status = 'live' and mode = 'buy_now' and stock > 0) then
    raise exception 'Pick one of your live items with stock.';
  end if;
  update live_shows set pinned_product_id = p_product where id = p_show;
end $$;

-- ===== Viewer count: the host's phone reports what the video service sees; we keep the highest =====
create function live_viewers(p_show uuid, p_count int) returns void
language sql security definer set search_path = public as $$
  update live_shows set peak_viewers = greatest(peak_viewers, least(greatest(p_count, 0), 1000000))
  where id = p_show and shop_id = my_live_shop() and status = 'live';
$$;

-- ===== A quick auction on one unit of an item =====
create function live_start_auction(p_show uuid, p_product uuid, p_start_cents int, p_seconds int, p_sudden_death boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare s live_shows; p products; nid uuid; owner uuid;
begin
  select * into s from live_shows where id = p_show for update;
  if s.id is null or s.shop_id is distinct from my_live_shop() then raise exception 'That isn''t your show.'; end if;
  if s.status <> 'live' then raise exception 'Go live first.'; end if;
  owner := auth.uid();
  if feature_state(owner, 'auctions') = 'off' then raise exception 'Auctions are switched off for your account.'; end if;
  if s.auction_product_id is not null and exists (select 1 from products where id = s.auction_product_id and auction_state = 'open') then
    raise exception 'Wait for this auction to end first.';
  end if;
  select * into p from products where id = p_product and shop_id = s.shop_id for update;
  if p.id is null or p.status <> 'live' or p.mode <> 'buy_now' or p.stock < 1 then raise exception 'Pick one of your live items with stock.'; end if;
  if p.label = 'authentic_designer' then raise exception 'Designer items can''t be auctioned live yet. Sell them with Buy now.'; end if;
  if p_seconds is null or p_seconds < 10 or p_seconds > 120 then raise exception 'Live auctions run 10 to 120 seconds.'; end if;
  if p_start_cents is null or p_start_cents < 2000 or p_start_cents > 5000000 then raise exception 'Start between R20 and R50,000.'; end if;
  perform set_config('app.auction_internal', '1', true);
  insert into products (shop_id, title, description, mode, label, condition, sizes, stock, parcel_size, price_cents, status,
                        auction_ends_at, auction_state, auction_round, live_show_id, from_product_id, sudden_death)
    values (p.shop_id, p.title, p.description, 'auction', p.label, p.condition, p.sizes, 1, p.parcel_size, p_start_cents, 'live',
            now() + make_interval(secs => p_seconds), 'open', 0, s.id, p.id, coalesce(p_sudden_death, false))
    returning id into nid;
  update products set stock = stock - 1, status = case when stock - 1 = 0 then 'sold_out'::product_status else status end where id = p.id;
  update live_shows set auction_product_id = nid, pinned_product_id = p.id where id = s.id;
  return nid;
end $$;

-- Live auctions: a bid in the last 10 seconds resets the clock to 10 seconds, unless it's sudden death. Others keep 60.
create or replace function extend_auction_after_bid(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p products; win interval;
begin
  select * into p from products where id = p_product;
  if p.live_show_id is not null and p.sudden_death then return; end if;
  win := case when p.live_show_id is not null then interval '10 seconds' else interval '60 seconds' end;
  if p.auction_ends_at - now() < win then
    perform set_config('app.auction_internal', '1', true);
    update products set auction_ends_at = now() + win where id = p_product;
  end if;
end $$;

-- Nobody won, or the winner didn't pay: the unit goes back to the original listing.
create function live_auction_return_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.from_product_id is not null and new.auction_state in ('unsold', 'unpaid') and old.auction_state is distinct from new.auction_state then
    perform set_config('app.auction_internal', '1', true);
    update products set stock = stock + 1 where id = new.from_product_id;
    begin
      update products set status = 'live' where id = new.from_product_id and status = 'sold_out' and mode = 'buy_now';
    exception when others then null; -- the stock is back either way; a rule change must never stop an auction closing
    end;
    update products set status = 'removed' where id = new.id;
  end if;
  return new;
end $$;
create trigger products_live_auction_return after update on products for each row execute function live_auction_return_stock();

-- ===== Live chat =====
create function live_say(p_show uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s live_shows; b text := trim(coalesce(p_body, '')); me profiles; new_id uuid;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null then raise exception 'Sign in to chat.'; end if;
  if me.handle is null then raise exception 'Pick a username first.'; end if;
  if is_suspended(me.id) then raise exception 'Your account is paused.'; end if;
  if feature_state(me.id, 'comment') = 'off' then raise exception 'Comments are switched off for your account.'; end if;
  select * into s from live_shows where id = p_show;
  if s.id is null or s.status <> 'live' then raise exception 'This show isn''t live.'; end if;
  if blocked_between(me.id, shop_owner(s.shop_id)) then raise exception 'You can''t chat in this show.'; end if;
  if length(b) = 0 then raise exception 'Type a message.'; end if;
  if length(b) > 200 then raise exception 'Keep it under 200 letters.'; end if;
  if rude_text(b) then raise exception 'Please keep it friendly. That message has words we don''t allow.'; end if;
  if not take_usage(me.id, 'live_chat', 20, interval '1 minute') then raise exception 'Slow down a little.'; end if;
  insert into live_chat (show_id, user_id, body) values (p_show, me.id, b) returning live_chat.id into new_id;
  return new_id;
end $$;

-- The show's chat, newest last, with names. Hidden messages and people you blocked don't show.
create function live_chat_since(p_show uuid, p_after timestamptz default null) returns table (id uuid, who text, is_seller boolean, body text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, coalesce(pr.handle, 'someone'), c.user_id = shop_owner(s.shop_id), c.body, c.created_at
  from live_chat c join live_shows s on s.id = c.show_id join profiles pr on pr.id = c.user_id
  where c.show_id = p_show and not c.hidden and (p_after is null or c.created_at > p_after)
    and (auth.uid() is null or not blocked_between(auth.uid(), c.user_id))
  order by c.created_at desc limit 50;
$$;

-- The seller (or our team) can hide a chat message.
create function live_hide_chat(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update live_chat c set hidden = true from live_shows s
  where c.id = p_id and s.id = c.show_id and (s.shop_id = my_live_shop() or is_admin());
  if not found then raise exception 'You can''t hide that message.'; end if;
end $$;

-- ===== End the show (or cancel a planned one), with a summary for the seller =====
create function live_end(p_show uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s live_shows; orders_n int; sales int;
begin
  select * into s from live_shows where id = p_show for update;
  if s.id is null or (s.shop_id is distinct from my_live_shop() and not is_admin()) then raise exception 'That isn''t your show.'; end if;
  if s.status = 'scheduled' then
    update live_shows set status = 'cancelled', ended_at = now() where id = p_show;
    return jsonb_build_object('cancelled', true);
  end if;
  if s.status = 'live' then
    update live_shows set status = 'ended', ended_at = now(), pinned_product_id = null where id = p_show;
    select * into s from live_shows where id = p_show;
  end if;
  select count(*), coalesce(sum(o.item_price_cents), 0) into orders_n, sales from orders o
  where o.shop_id = s.shop_id and o.status not in ('pending_payment', 'cancelled')
    and (o.created_at between s.started_at and coalesce(s.ended_at, now())
         or exists (select 1 from products p where p.id = o.product_id and p.live_show_id = s.id));
  return jsonb_build_object('minutes', greatest(1, ceil(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60))::int,
    'peakViewers', s.peak_viewers, 'orders', orders_n, 'salesCents', sales,
    'auctions', (select count(*) from products where live_show_id = s.id),
    'auctionsWon', (select count(*) from products where live_show_id = s.id and auction_state in ('won', 'paid')));
end $$;

-- A host whose phone died leaves a show "live": end anything live for over 8 hours, or planned and never started after a day.
create function end_stale_live_shows() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update live_shows set status = 'ended', ended_at = now(), pinned_product_id = null where status = 'live' and started_at < now() - interval '8 hours';
  get diagnostics n = row_count;
  update live_shows set status = 'cancelled', ended_at = now() where status = 'scheduled' and starts_at < now() - interval '1 day';
  return n;
end $$;
revoke execute on function end_stale_live_shows() from public, anon, authenticated;
grant execute on function end_stale_live_shows() to service_role;

-- ===== What the Live tab and the watch screen read =====
create function live_show_info(p_show uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'shopId', s.shop_id, 'title', s.title, 'status', s.status, 'startsAt', s.starts_at,
    'startedAt', s.started_at, 'endedAt', s.ended_at, 'pinnedProductId', s.pinned_product_id,
    'auctionProductId', s.auction_product_id, 'peakViewers', s.peak_viewers,
    'reminded', coalesce(exists (select 1 from live_reminders r where r.show_id = s.id and r.user_id = auth.uid()), false),
    'reminders', (select count(*) from live_reminders r where r.show_id = s.id),
    'mine', s.shop_id = my_live_shop())
  from live_shows s where s.id = p_show
    and (auth.uid() is null or not blocked_between(auth.uid(), shop_owner(s.shop_id)));
$$;

create function live_shows_list() returns setof jsonb
language sql stable security definer set search_path = public as $$
  select live_show_info(s.id) from live_shows s
  where (s.status = 'live' and s.started_at > now() - interval '8 hours')
     or (s.status = 'scheduled' and s.starts_at > now() - interval '1 hour' and s.starts_at < now() + interval '30 days')
  order by s.status = 'live' desc, case when s.status = 'live' then s.started_at end desc, s.starts_at
  limit 60;
$$;

grant execute on function live_create(text, timestamptz), live_go(uuid), live_pin(uuid, uuid), live_viewers(uuid, int),
  live_start_auction(uuid, uuid, int, int, boolean), live_say(uuid, text), live_hide_chat(uuid), live_end(uuid) to authenticated;
revoke execute on function live_create(text, timestamptz), live_go(uuid), live_pin(uuid, uuid), live_viewers(uuid, int),
  live_start_auction(uuid, uuid, int, int, boolean), live_say(uuid, text), live_hide_chat(uuid), live_end(uuid) from public, anon;
grant execute on function live_show_info(uuid), live_shows_list(), live_chat_since(uuid, timestamptz) to anon, authenticated;

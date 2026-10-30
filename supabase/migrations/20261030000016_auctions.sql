-- Timed auctions: bidding with fixed steps, an optional reserve, no last second sniping, and the winner pays
-- within 2 hours through the normal escrow checkout. Auctions unlock after 5 good orders (products_guard).
-- The numbers match packages/core/src/auction.ts.

alter table products add column auction_ends_at timestamptz;
alter table products add column reserve_cents int check (reserve_cents is null or reserve_cents between 2000 and 50000000);
alter table products add column auction_state text check (auction_state is null or auction_state in ('open', 'won', 'unsold', 'unpaid', 'paid'));
alter table products add column auction_round int not null default 0;
alter table products add column auction_winner uuid references profiles (id) on delete set null;
alter table products add column auction_price_cents int;
alter table products add column auction_pay_by timestamptz;
grant update (auction_ends_at, reserve_cents) on products to authenticated;

create table bids (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  round int not null,
  bidder_id uuid not null references profiles (id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);
create index bids_product on bids (product_id, round, amount_cents desc);
alter table bids enable row level security;
grant select on bids to authenticated;
-- Your own bids. Everyone else sees bids through auction_info (amounts, masked names).
create policy "your own bids" on bids for select to authenticated using (bidder_id = auth.uid() or is_admin());

create function bid_step(c int) returns int language sql immutable as $$
  select case when c < 50000 then 1000 when c < 200000 then 2000 else 5000 end;
$$;

-- Changes made by the auction functions themselves (closing, extending) skip the seller rules below.
create function auction_internal() returns boolean language sql stable as $$
  select coalesce(current_setting('app.auction_internal', true), '') = '1' or auth.role() = 'service_role';
$$;

create function auction_guard() returns trigger language plpgsql security definer set search_path = public as $$
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
          or new.auction_ends_at <> old.auction_ends_at or new.status <> old.status) then
    raise exception 'You can''t change an auction once people have bid.';
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
create trigger products_zz_auction_guard before insert or update on products for each row execute function auction_guard();

-- What anyone can see about an auction (signed out too).
create function auction_info(p_product uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select * from products where id = p_product and mode = 'auction'),
  b as (select b.* from bids b, p where b.product_id = p.id and b.round = p.auction_round),
  top as (select * from b order by amount_cents desc, created_at limit 1)
  select jsonb_build_object(
    'productId', p.id, 'state', p.auction_state, 'endsAt', p.auction_ends_at, 'startCents', p.price_cents,
    'currentCents', (select amount_cents from top),
    'bidCount', (select count(*) from b),
    'minNextCents', coalesce((select amount_cents + bid_step(amount_cents) from top), p.price_cents),
    'reserveSet', p.reserve_cents is not null,
    'reserveMet', p.reserve_cents is null or coalesce((select amount_cents from top), 0) >= p.reserve_cents,
    'leaderIsMe', coalesce((select bidder_id from top) = auth.uid(), false),
    'myTopCents', (select max(amount_cents) from b where bidder_id = auth.uid()),
    'winnerIsMe', coalesce(p.auction_winner = auth.uid(), false),
    'priceCents', p.auction_price_cents, 'payBy', p.auction_pay_by,
    'recent', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('who', case when b.bidder_id = auth.uid() then 'You' else
                 coalesce(left(pr.handle, 1) || '***' || right(pr.handle, 1), 'Bidder') end,
               'amountCents', b.amount_cents, 'at', b.created_at) as x
        from b join profiles pr on pr.id = b.bidder_id order by b.amount_cents desc limit 5) r), '[]'::jsonb))
  from p;
$$;
create function auctions_info(p_products uuid[]) returns setof jsonb language sql stable security definer set search_path = public as $$
  select auction_info(id) from products where id = any (p_products[1:50]) and mode = 'auction';
$$;

-- Close an auction that has ended, or a win that went unpaid. Safe to call any time, by anyone: it only acts when due.
create function settle_auction(p_product uuid) returns void language plpgsql security definer set search_path = public as $$
declare p products; t bids; seller uuid;
begin
  select * into p from products where id = p_product and mode = 'auction' for update;
  if p.id is null then return; end if;
  perform set_config('app.auction_internal', '1', true);
  seller := shop_owner(p.shop_id);
  if p.auction_state = 'open' and now() >= p.auction_ends_at then
    select * into t from bids where product_id = p.id and round = p.auction_round order by amount_cents desc, created_at limit 1;
    if t.id is not null and t.amount_cents >= coalesce(p.reserve_cents, 0) then
      update products set auction_state = 'won', auction_winner = t.bidder_id, auction_price_cents = t.amount_cents,
        auction_pay_by = now() + interval '2 hours', status = 'sold_out' where id = p.id;
      perform notify(t.bidder_id, 'auction', 'You won: ' || p.title,
        'Pay R' || (t.amount_cents / 100) || ' within 2 hours to keep it. Your money is held safely until it arrives.', '/i/' || p.id);
      perform notify(seller, 'auction', 'Sold at auction: ' || p.title, 'R' || (t.amount_cents / 100) || '. The winner has 2 hours to pay.', '/i/' || p.id);
    else
      update products set auction_state = 'unsold', status = 'draft' where id = p.id;
      perform notify(seller, 'auction', 'Auction ended: ' || p.title,
        case when t.id is null then 'No bids this time. You can list it again.' else 'The reserve wasn''t met. You can list it again.' end, null);
    end if;
  elsif p.auction_state = 'won' and now() > p.auction_pay_by
        and not exists (select 1 from orders o where o.product_id = p.id and o.buyer_id = p.auction_winner
                          and o.status not in ('pending_payment', 'cancelled')) then
    update products set auction_state = 'unpaid', status = 'draft' where id = p.id;
    update orders set status = 'cancelled' where product_id = p.id and buyer_id = p.auction_winner and status = 'pending_payment';
    perform add_trust_event(p.auction_winner, 'unpaid_auction_win', null, 'Auction win not paid within 2 hours');
    perform notify(p.auction_winner, 'auction', 'Auction win cancelled', p.title || ' wasn''t paid within 2 hours, so you lost trust points.', null);
    perform notify(seller, 'auction', 'Winner didn''t pay: ' || p.title, 'You can list it again.', null);
  end if;
end $$;

create function settle_due_auctions() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from products where mode = 'auction'
     and ((auction_state = 'open' and auction_ends_at <= now()) or (auction_state = 'won' and auction_pay_by < now())) limit 200 loop
    perform settle_auction(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- Place a bid. All the rules live here.
create function place_bid(p_product uuid, p_amount int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p products; me profiles; t bids; minb int; seller uuid;
begin
  perform settle_auction(p_product);
  select * into p from products where id = p_product for update;
  if p.id is null or p.mode <> 'auction' or p.status <> 'live' or p.auction_state <> 'open' or now() >= p.auction_ends_at then
    raise exception 'This auction has ended.';
  end if;
  if (select status from shops where id = p.shop_id) <> 'open' then raise exception 'This auction has ended.'; end if;
  seller := shop_owner(p.shop_id);
  if seller = auth.uid() then raise exception 'You can''t bid on your own item.'; end if;
  select * into me from profiles where id = auth.uid();
  if me.id is null then raise exception 'Please sign in.'; end if;
  if me.handle is null or me.adult_confirmed_at is null then raise exception 'Finish setting up your account to bid.'; end if;
  if me.trust_score < 40 then raise exception 'Your account is under review, so you can''t bid right now.'; end if;
  if (select count(*) from trust_events e where e.user_id = me.id and e.kind = 'unpaid_auction_win' and e.created_at > now() - interval '90 days') >= 2 then
    raise exception 'You can''t bid for now: two auction wins went unpaid.';
  end if;
  if blocked_between(me.id, seller) then raise exception 'You can''t bid on this shop.'; end if;
  select * into t from bids where product_id = p.id and round = p.auction_round order by amount_cents desc, created_at limit 1;
  minb := case when t.id is null then p.price_cents else t.amount_cents + bid_step(t.amount_cents) end;
  if p_amount < minb then raise exception 'The lowest bid now is R%.', minb / 100; end if;
  if p_amount > greatest(minb * 5, 100000) or p_amount > 50000000 then raise exception 'That''s far above the current bid. Check the amount.'; end if;
  insert into bids (product_id, round, bidder_id, amount_cents) values (p.id, p.auction_round, me.id, p_amount);
  -- No sniping: a bid in the last 2 minutes adds 2 minutes.
  if p.auction_ends_at - now() < interval '2 minutes' then
    perform set_config('app.auction_internal', '1', true);
    update products set auction_ends_at = now() + interval '2 minutes' where id = p.id;
  end if;
  if t.id is not null and t.bidder_id <> me.id then
    perform notify(t.bidder_id, 'auction', 'You''ve been outbid', p.title || ' is now at R' || (p_amount / 100) || '. Bid again before it ends.', '/i/' || p.id);
  end if;
  perform notify(seller, 'auction', 'New bid: R' || (p_amount / 100), p.title, '/i/' || p.id);
  return auction_info(p.id);
end $$;

-- When the winner pays, the auction is done. A refund before shipping puts it back in the seller's drafts.
create function orders_auction_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mode <> 'auction' or new.status is not distinct from old.status then return new; end if;
  perform set_config('app.auction_internal', '1', true);
  if new.status = 'paid' then
    update products set auction_state = 'paid', status = 'sold_out', stock = 0 where id = new.product_id;
  elsif new.status = 'refunded' and old.status = 'paid' then
    update products set auction_state = 'unsold', status = 'draft', stock = 1 where id = new.product_id;
  end if;
  return new;
end $$;
create trigger orders_zz_auction after update on orders for each row execute function orders_auction_after();

grant execute on function auction_info(uuid), auctions_info(uuid[]), settle_auction(uuid) to anon, authenticated;
grant execute on function place_bid(uuid, int) to authenticated;
revoke execute on function settle_due_auctions() from public, anon, authenticated;
grant execute on function settle_due_auctions() to service_role;

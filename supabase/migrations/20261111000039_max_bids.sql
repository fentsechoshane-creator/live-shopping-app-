-- Max bids (asked for by Ofentse 11 Nov 2026). A bidder sets the most they'll pay; we bid for them, only when they're
-- outbid, at the lowest amount that puts them back on top. Nobody but them (and our team) sees a max.
--
-- Fair when many people have a max on one item:
--   * One at a time: place_bid locks the item row, so bids on an item are handled one after the other.
--   * All maxes are weighed together after every bid, ranked only by the amount, then by who set it first.
--   * The top max leads at one step above the next highest max, never above its own max.
--   * Lower maxes each show one bid at their max, then drop out, so it settles at once with no flood of small bids.
-- Same steps as maxBidReplies in packages/core/src/auction.ts; keep them in step.

create table max_bids (
  product_id uuid not null references products (id) on delete cascade,
  round int not null,
  bidder_id uuid not null references profiles (id) on delete cascade,
  max_cents int not null check (max_cents > 0 and max_cents <= 50000000),
  set_at timestamptz not null default clock_timestamp(),
  primary key (product_id, round, bidder_id)
);
alter table max_bids enable row level security;
grant select on max_bids to authenticated;
grant select, insert, update, delete on max_bids to service_role;
create policy "your own max bids" on max_bids for select to authenticated using (bidder_id = auth.uid() or is_admin());

-- Places the bids the maxes call for, after the top bid changed. Bids get the real clock time so their order is kept.
create function run_max_bids(p_product uuid, p_round int) returns void
language plpgsql security definer set search_path = public as $$
declare t bids; ch max_bids; mine max_bids; lmax int; i int := 0;
begin
  loop
    i := i + 1;
    exit when i > 100; -- each round knocks out at least one max, so this is only a safety limit
    select * into t from bids where product_id = p_product and round = p_round order by amount_cents desc, created_at limit 1;
    exit when t.id is null;
    select * into ch from max_bids m
      where m.product_id = p_product and m.round = p_round and m.bidder_id <> t.bidder_id
        and m.max_cents >= t.amount_cents + bid_step(t.amount_cents)
      order by m.max_cents desc, m.set_at limit 1;
    exit when ch.bidder_id is null;
    select * into mine from max_bids where product_id = p_product and round = p_round and bidder_id = t.bidder_id;
    lmax := greatest(t.amount_cents, coalesce(mine.max_cents, 0));
    if lmax > ch.max_cents or (lmax = ch.max_cents and mine.bidder_id is not null and mine.set_at <= ch.set_at) then
      -- The leader's max holds.
      if lmax > ch.max_cents then
        insert into bids (product_id, round, bidder_id, amount_cents, created_at) values (p_product, p_round, ch.bidder_id, ch.max_cents, clock_timestamp());
      end if;
      insert into bids (product_id, round, bidder_id, amount_cents, created_at)
        values (p_product, p_round, t.bidder_id, least(lmax, ch.max_cents + bid_step(ch.max_cents)), clock_timestamp());
    else
      -- The challenger takes over. Show the old leader's max first if it was above their bid (and not equal).
      if lmax > t.amount_cents and lmax < ch.max_cents then
        insert into bids (product_id, round, bidder_id, amount_cents, created_at) values (p_product, p_round, t.bidder_id, lmax, clock_timestamp());
      end if;
      insert into bids (product_id, round, bidder_id, amount_cents, created_at)
        values (p_product, p_round, ch.bidder_id, least(ch.max_cents, lmax + bid_step(lmax)), clock_timestamp());
    end if;
  end loop;
end $$;
revoke execute on function run_max_bids(uuid, int) from public, anon, authenticated;

-- place_bid gains p_max: true sets (or raises) your max instead of bidding an exact amount.
drop function place_bid(uuid, int);
create function place_bid(p_product uuid, p_amount int, p_max boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p products; me profiles; t bids; nt bids; minb int; seller uuid; mym int; started timestamptz := clock_timestamp(); r record;
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

  if p_max then
    select max_cents into mym from max_bids where product_id = p.id and round = p.auction_round and bidder_id = me.id;
    if mym is not null and p_amount <= mym then raise exception 'Your max is already R%. Set a higher one.', mym / 100; end if;
    if t.bidder_id = me.id then
      if p_amount <= t.amount_cents then raise exception 'You''re already on top at R%. Set a max above that.', t.amount_cents / 100; end if;
    elsif p_amount < minb then
      raise exception 'The lowest bid now is R%.', minb / 100;
    end if;
  elsif p_amount < minb then
    raise exception 'The lowest bid now is R%.', minb / 100;
  end if;
  if p_amount > greatest(minb * 5, 100000) or p_amount > 50000000 then raise exception 'That''s far above the current bid. Check the amount.'; end if;

  if p_max then
    insert into max_bids (product_id, round, bidder_id, max_cents) values (p.id, p.auction_round, me.id, p_amount)
      on conflict (product_id, round, bidder_id) do update set max_cents = excluded.max_cents, set_at = clock_timestamp();
    -- Not on top yet: bid the lowest amount now; the max does the rest.
    if t.id is null or t.bidder_id <> me.id then
      insert into bids (product_id, round, bidder_id, amount_cents, created_at) values (p.id, p.auction_round, me.id, minb, clock_timestamp());
    end if;
  else
    insert into bids (product_id, round, bidder_id, amount_cents, created_at) values (p.id, p.auction_round, me.id, p_amount, clock_timestamp());
  end if;
  perform run_max_bids(p.id, p.auction_round);
  select * into nt from bids where product_id = p.id and round = p.auction_round order by amount_cents desc, created_at limit 1;

  if nt.id is distinct from t.id then
    -- No sniping: a bid in the last 2 minutes adds 2 minutes.
    if p.auction_ends_at - now() < interval '2 minutes' then
      perform set_config('app.auction_internal', '1', true);
      update products set auction_ends_at = now() + interval '2 minutes' where id = p.id;
    end if;
    -- Everyone who was on top or bid for by their max in this go, and isn't on top now, is told once.
    -- (You see the result straight away on screen, so you're not sent a notice.)
    for r in
      select distinct b.bidder_id from bids b
      where b.product_id = p.id and b.round = p.auction_round and b.bidder_id not in (nt.bidder_id, me.id)
        and (b.id = t.id or b.created_at >= started)
    loop
      perform notify(r.bidder_id, 'auction', 'You''ve been outbid', p.title || ' is now at R' || (nt.amount_cents / 100) || '. Bid again before it ends.', '/i/' || p.id);
    end loop;
    perform notify(seller, 'auction', 'New bid: R' || (nt.amount_cents / 100), p.title, '/i/' || p.id);
  end if;
  return auction_info(p.id);
end $$;
revoke execute on function place_bid(uuid, int, boolean) from public, anon;
grant execute on function place_bid(uuid, int, boolean) to authenticated;

-- auction_info now also tells you your own max.
create or replace function auction_info(p_product uuid) returns jsonb
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
    'myMaxCents', (select m.max_cents from max_bids m where m.product_id = p.id and m.round = p.auction_round and m.bidder_id = auth.uid()),
    'winnerIsMe', coalesce(p.auction_winner = auth.uid(), false),
    'priceCents', p.auction_price_cents, 'payBy', p.auction_pay_by,
    'recent', coalesce((select jsonb_agg(x order by (x->>'amountCents')::int desc) from (
        select jsonb_build_object('who', case when b.bidder_id = auth.uid() then 'You' else
                 coalesce(left(pr.handle, 1) || '***' || right(pr.handle, 1), 'Bidder') end,
               'amountCents', b.amount_cents, 'at', b.created_at) as x
        from b join profiles pr on pr.id = b.bidder_id order by b.amount_cents desc limit 5) r), '[]'::jsonb))
  from p;
$$;

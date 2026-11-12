-- Max bids answer after a short pause on feed auctions (Ofentse, 12 Nov 2026): "the instant max bid update seems
-- unnatural and doesn't give the bidding war effect". Live show auctions stay instant ("live needs to be instant"). The person who just bid sees they're on top, then 5 seconds later the max answers and
-- they get "You've been outbid". Fairness: a max never loses to the clock. If an auction has 6 seconds or less left
-- and the bid won't reset the clock (sudden death live auctions), the max answers straight away; normal auctions reset
-- to 60 seconds and live ones to 10, so the pause always fits. A max that was due is also answered before an auction is
-- settled. The pending answer is kept on the item (max_reply_at); any phone watching the auction nudges it when due
-- (nudge_max_bids does nothing early), and placing a bid or settling does too.
alter table products add column max_reply_at timestamptz;

create function max_reply_seconds() returns int language sql immutable as $$ select 5 $$;

-- Answers waiting max bids if they're due, or straight away with p_now (server only).
create function answer_max_bids(p_product uuid, p_now boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare p products; t bids; nt bids; r record; started timestamptz := now(); -- bids get the transaction's time
begin
  select * into p from products where id = p_product and mode = 'auction' for update;
  if p.id is null or p.auction_state <> 'open' then return; end if;
  if not p_now and (p.max_reply_at is null or (p.max_reply_at > now() and now() < p.auction_ends_at)) then return; end if;
  perform set_config('app.auction_internal', '1', true);
  update products set max_reply_at = null where id = p.id;
  select * into t from bids where product_id = p.id and round = p.auction_round order by amount_cents desc, created_at limit 1;
  perform run_max_bids(p.id, p.auction_round);
  select * into nt from bids where product_id = p.id and round = p.auction_round order by amount_cents desc, created_at limit 1;
  if nt.id is distinct from t.id then
    perform extend_auction_after_bid(p.id);
    for r in
      select distinct b.bidder_id from bids b
      where b.product_id = p.id and b.round = p.auction_round and b.bidder_id <> nt.bidder_id
        and (b.id = t.id or b.created_at >= started)
    loop
      perform notify(r.bidder_id, 'auction', 'You''ve been outbid', p.title || ' is now at R' || (nt.amount_cents / 100) || '. Bid again before it ends.', '/i/' || p.id);
    end loop;
    perform notify(shop_owner(p.shop_id), 'auction', 'New bid: R' || (nt.amount_cents / 100), p.title, '/i/' || p.id);
  end if;
end $$;
revoke execute on function answer_max_bids(uuid, boolean) from public, anon, authenticated;

-- What phones call when a pending answer is due. Does nothing early.
create function nudge_max_bids(p_product uuid) returns void language sql security definer set search_path = public as $$
  select answer_max_bids(p_product, false);
$$;
grant execute on function nudge_max_bids(uuid) to anon, authenticated;

create or replace function settle_auction(p_product uuid) returns void language plpgsql security definer set search_path = public as $$
declare p products; t bids; seller uuid;
begin
  perform answer_max_bids(p_product); -- a max that was due to answer goes first
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

create or replace function place_bid(p_product uuid, p_amount int, p_max boolean default false) returns jsonb
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
  select * into nt from bids where product_id = p.id and round = p.auction_round order by amount_cents desc, created_at limit 1;

  if nt.id is distinct from t.id then
    perform extend_auction_after_bid(p.id);
    -- Everyone who was on top or bid for by their max in this go, and isn't on top now, is told once.
    -- (You see the result straight away on screen, so you're not sent a notice.)
    for r in
      select distinct b.bidder_id from bids b
      where b.product_id = p.id and b.round = p.auction_round and b.bidder_id not in (nt.bidder_id, me.id)
        and (b.id = t.id or b.created_at >= started)
        -- Someone whose max is about to answer isn't really outbid, so they aren't told.
        and not exists (select 1 from max_bids m where m.product_id = p.id and m.round = p.auction_round and m.bidder_id = b.bidder_id
                          and m.max_cents >= nt.amount_cents + bid_step(nt.amount_cents))
    loop
      perform notify(r.bidder_id, 'auction', 'You''ve been outbid', p.title || ' is now at R' || (nt.amount_cents / 100) || '. Bid again before it ends.', '/i/' || p.id);
    end loop;
    perform notify(seller, 'auction', 'New bid: R' || (nt.amount_cents / 100), p.title, '/i/' || p.id);
  end if;
  -- Feed auctions: max bids answer after 5 seconds, like a person bidding back, so the bidder sees they were on top and
  -- then gets "You've been outbid". Live show auctions, and any auction with 6 seconds or less left, answer now.
  if exists (select 1 from max_bids m where m.product_id = p.id and m.round = p.auction_round and m.bidder_id <> nt.bidder_id
               and m.max_cents >= nt.amount_cents + bid_step(nt.amount_cents)) then
    if p.live_show_id is null and (select auction_ends_at from products where id = p.id) - now() > interval '6 seconds' then
      perform set_config('app.auction_internal', '1', true);
      update products set max_reply_at = least(coalesce(max_reply_at, 'infinity'::timestamptz), now() + make_interval(secs => max_reply_seconds()))
        where id = p.id;
    else
      perform answer_max_bids(p.id, true);
    end if;
  end if;
  return auction_info(p.id);
end $$;
revoke execute on function place_bid(uuid, int, boolean) from public, anon;
grant execute on function place_bid(uuid, int, boolean) to authenticated;

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
    'maxReplyAt', p.max_reply_at,
    'winnerIsMe', coalesce(p.auction_winner = auth.uid(), false),
    'priceCents', p.auction_price_cents, 'payBy', p.auction_pay_by,
    'recent', coalesce((select jsonb_agg(x order by (x->>'amountCents')::int desc) from (
        select jsonb_build_object('who', case when b.bidder_id = auth.uid() then 'You' else
                 coalesce(left(pr.handle, 1) || '***' || right(pr.handle, 1), 'Bidder') end,
               'amountCents', b.amount_cents, 'at', b.created_at) as x
        from b join profiles pr on pr.id = b.bidder_id order by b.amount_cents desc limit 5) r), '[]'::jsonb))
  from p;
$$;

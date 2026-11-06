-- Buyers can make offers, like Vinted and Depop (decided with Ofentse, 6 Nov 2026).
-- A buyer offers a price on one live Buy now item. It waits for the seller ("pending") for up to 24 hours.
-- The seller accepts (it becomes an open special price the buyer can pay for 24 hours), declines, or counters
-- (declines and sends their own special price with make_offer). Checkout only takes open offers, so nothing else
-- changes there. Offers start at R50 (TradeSafe's minimum) and can't be below half the listed price.

alter table offers add column made_by text not null default 'seller' check (made_by in ('seller', 'buyer'));
alter table offers drop constraint if exists offers_status_check;
alter table offers add constraint offers_status_check check (status in ('pending', 'open', 'used', 'withdrawn', 'declined'));
-- New offers start at R50 (older rows are left as they were).
alter table offers add constraint offers_min_r50 check (price_cents >= 5000) not valid;

-- The buyer's side.
create function buyer_offer(p_conversation uuid, p_product uuid, p_price int)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare c conversations; p products; new_id uuid; recent int;
begin
  select * into c from conversations where id = p_conversation;
  if c.id is null or c.buyer_id <> auth.uid() then raise exception 'Only the buyer in this chat can make an offer.'; end if;
  if blocked_between(c.buyer_id, shop_owner(c.shop_id)) then raise exception 'You can''t make offers here.'; end if;
  select * into p from products where id = p_product;
  if p.id is null or p.shop_id <> c.shop_id or p.status <> 'live' then raise exception 'That item isn''t available.'; end if;
  if p.mode <> 'buy_now' then raise exception 'Offers are only for Buy now items.'; end if;
  if p_price < 5000 then raise exception 'Offers start at R50.'; end if;
  if p_price >= p.price_cents then raise exception 'Offer less than the listed price (R%).', p.price_cents / 100; end if;
  if p_price * 2 < p.price_cents then raise exception 'Offers can''t be less than half the price (R%).', ceil(p.price_cents / 200.0); end if;
  -- One waiting offer per item; at most 5 offers a day in one chat, so sellers aren't flooded.
  if exists (select 1 from offers where conversation_id = c.id and made_by = 'buyer' and status = 'pending' and p_product = any (product_ids) and expires_at > now())
    then raise exception 'You already have an offer waiting on this item.'; end if;
  select count(*) into recent from offers where conversation_id = c.id and made_by = 'buyer' and created_at > now() - interval '1 day';
  if recent >= 5 then raise exception 'That''s a lot of offers today. Wait for the seller to reply.'; end if;
  insert into offers (conversation_id, shop_id, buyer_id, product_ids, price_cents, expires_at, status, made_by)
    values (c.id, c.shop_id, c.buyer_id, array[p_product], p_price, now() + interval '24 hours', 'pending', 'buyer') returning id into new_id;
  perform notify(shop_owner(c.shop_id), 'offer', 'New offer: R' || (p_price / 100)::text,
    format('Someone offered R%s for %s (listed R%s).', p_price / 100, p.title, p.price_cents / 100), '/messages/' || c.id);
  return new_id;
end $$;

-- The seller's answer.
create function answer_offer(p_offer uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare o offers; t text;
begin
  select * into o from offers where id = p_offer for update;
  if o.id is null or shop_owner(o.shop_id) <> auth.uid() then raise exception 'Only the seller can answer this offer.'; end if;
  if o.status <> 'pending' or o.expires_at < now() then raise exception 'This offer has already been answered or has ended.'; end if;
  if p_accept and exists (select 1 from products where id = any (o.product_ids) and status <> 'live') then raise exception 'That item isn''t available any more.'; end if;
  update offers set status = case when p_accept then 'open' else 'declined' end,
    expires_at = case when p_accept then now() + interval '24 hours' else expires_at end where id = o.id;
  select title into t from products where id = o.product_ids[1];
  perform notify(o.buyer_id, 'offer',
    case when p_accept then 'Offer accepted' else 'Offer declined' end,
    case when p_accept then format('Your R%s offer for %s was accepted. Pay within 24 hours to get it.', o.price_cents / 100, t)
         else format('Your R%s offer for %s was declined.', o.price_cents / 100, t) end,
    '/messages/' || o.conversation_id);
end $$;

revoke execute on function buyer_offer(uuid, uuid, int), answer_offer(uuid, boolean) from public, anon;
grant execute on function buyer_offer(uuid, uuid, int), answer_offer(uuid, boolean) to authenticated;

-- An offer card can be posted in the chat by whoever made it: the shop for its special prices, the buyer for theirs.
create or replace function message_extras_ok(p_conv uuid, p_image text, p_offer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (p_image is null or p_image like auth.uid()::text || '/%')
     and (p_offer is null or exists (select 1 from offers o where o.id = p_offer and o.conversation_id = p_conv
          and (shop_owner(o.shop_id) = auth.uid() or (o.made_by = 'buyer' and o.buyer_id = auth.uid()))));
$$;

-- The seller's special prices also start at R50, with a plain message.
create or replace function make_offer(p_conversation uuid, p_products uuid[], p_price int, p_hours int default 24)
returns uuid language plpgsql security definer set search_path = public as $$
declare c conversations; listed int; new_id uuid;
begin
  select * into c from conversations where id = p_conversation;
  if c.id is null or shop_owner(c.shop_id) <> auth.uid() then raise exception 'Only the shop in this chat can make an offer.'; end if;
  if exists (select 1 from unnest(p_products) pid left join products p on p.id = pid
             where p.id is null or p.shop_id <> c.shop_id or p.status <> 'live') then
    raise exception 'Offers can only include live items from your shop.';
  end if;
  select sum(price_cents) into listed from products where id = any (p_products);
  if p_price > listed then raise exception 'An offer can''t be more than the listed price (R%).', listed / 100; end if;
  if p_price < 5000 then raise exception 'Special prices start at R50.'; end if;
  if p_hours not between 1 and 72 then raise exception 'Offers last between 1 and 72 hours.'; end if;
  insert into offers (conversation_id, shop_id, buyer_id, product_ids, price_cents, expires_at)
    values (c.id, c.shop_id, c.buyer_id, p_products, p_price, now() + make_interval(hours => p_hours)) returning id into new_id;
  perform notify(c.buyer_id, 'offer', 'Special price: R' || (p_price / 100)::text, 'The seller sent you a special price. It ends in ' || p_hours || ' hours.', '/messages/' || c.id);
  return new_id;
end $$;
revoke execute on function make_offer(uuid, uuid[], int, int) from public, anon;
grant execute on function make_offer(uuid, uuid[], int, int) to authenticated;

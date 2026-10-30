-- Selling inside chats: special prices (offers) for one item or a bundle, holding an item for a buyer,
-- photos in messages, and a "usually replies within" time for shops.

-- ===== Offers =====
create table offers (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  shop_id uuid not null references shops (id) on delete cascade,
  buyer_id uuid not null references profiles (id) on delete cascade,
  product_ids uuid[] not null check (cardinality(product_ids) between 1 and 10),
  price_cents int not null check (price_cents >= 1000),
  expires_at timestamptz not null default now() + interval '24 hours',
  status text not null default 'open' check (status in ('open', 'used', 'withdrawn')),
  created_at timestamptz not null default now()
);
alter table offers enable row level security;
grant select on offers to authenticated;
create policy "people in the chat see offers" on offers for select to authenticated
  using (buyer_id = auth.uid() or shop_owner(shop_id) = auth.uid() or is_admin());

-- Sellers make offers through this function so the rules are checked in one place.
create function make_offer(p_conversation uuid, p_products uuid[], p_price int, p_hours int default 24)
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
  if p_hours not between 1 and 72 then raise exception 'Offers last between 1 and 72 hours.'; end if;
  insert into offers (conversation_id, shop_id, buyer_id, product_ids, price_cents, expires_at)
    values (c.id, c.shop_id, c.buyer_id, p_products, p_price, now() + make_interval(hours => p_hours)) returning id into new_id;
  return new_id;
end $$;
grant execute on function make_offer(uuid, uuid[], int, int) to authenticated;

-- ===== Messages: photos and offers =====
alter table messages add column image_path text;
alter table messages add column offer_id uuid references offers (id) on delete set null;
alter table messages drop constraint messages_body_check;
alter table messages add constraint messages_body_check
  check (length(trim(body)) between 1 and 1000 or (length(body) = 0 and (image_path is not null or offer_id is not null)));
-- Photos live in the private bucket, inside the sender's own folder.
create or replace function message_extras_ok(p_conv uuid, p_image text, p_offer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (p_image is null or p_image like auth.uid()::text || '/%')
     and (p_offer is null or exists (select 1 from offers o where o.id = p_offer and o.conversation_id = p_conv and shop_owner(o.shop_id) = auth.uid()));
$$;
drop policy "send in your own chats" on messages;
create policy "send in your own chats" on messages for insert to authenticated
  with check (sender_id = auth.uid() and in_conversation(conversation_id) and not blocked_between(auth.uid(), other_person(conversation_id))
    and message_extras_ok(conversation_id, image_path, offer_id));

-- People in a chat can see its photos.
create policy "chat photos" on storage.objects for select to authenticated
  using (bucket_id = 'private' and exists (
    select 1 from messages m where m.image_path = storage.objects.name and in_conversation(m.conversation_id)));

-- The rude word filter skips empty bodies (photo or offer only).
create or replace function social_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if length(new.body) > 0 and rude_text(new.body) then raise exception 'Please keep it friendly. That message has words we don''t allow.'; end if;
  if tg_table_name = 'messages' then
    if new.product_id is not null and (select shop_id from products where id = new.product_id)
       <> (select shop_id from conversations where id = new.conversation_id) then
      raise exception 'That item is from a different shop.';
    end if;
    update conversations set last_message_at = now() where id = new.conversation_id;
    perform notify(other_person_of(new.conversation_id, new.sender_id), 'message',
      case when new.offer_id is not null then 'New offer' when new.image_path is not null and length(new.body) = 0 then 'New photo' else 'New message' end,
      left(coalesce(nullif(new.body, ''), 'Open the chat to see it.'), 80), '/messages/' || new.conversation_id);
  elsif tg_table_name = 'comments' then
    if shop_owner((select shop_id from posts where id = new.post_id)) <> new.user_id then
      perform notify(shop_owner((select shop_id from posts where id = new.post_id)), 'comment', 'New comment', left(new.body, 80), null);
    end if;
  end if;
  return new;
end $$;

-- ===== Holding an item for a buyer =====
alter table products add column held_for uuid references profiles (id) on delete set null;
alter table products add column held_until timestamptz;
create function hold_product(p_product uuid, p_buyer uuid, p_hours int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from products p join shops s on s.id = p.shop_id where p.id = p_product and s.owner_id = auth.uid()) then
    raise exception 'Only the seller can hold this item.';
  end if;
  if p_hours = 0 then
    update products set held_for = null, held_until = null where id = p_product;
  elsif p_hours between 1 and 48 then
    update products set held_for = p_buyer, held_until = now() + make_interval(hours => p_hours) where id = p_product;
  else
    raise exception 'Hold for between 1 and 48 hours.';
  end if;
end $$;
grant execute on function hold_product(uuid, uuid, int) to authenticated;

-- ===== Bundles: one order can carry extra items from the same shop =====
alter table orders add column bundle_product_ids uuid[] not null default '{}';
alter table orders add column offer_id uuid references offers (id) on delete set null;

create function orders_bundle_stock() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    if cardinality(new.bundle_product_ids) > 0 then
      update products set stock = greatest(stock - 1, 0),
        status = case when stock - 1 <= 0 and mode <> 'order_now' then 'sold_out'::product_status else status end
        where id = any (new.bundle_product_ids);
    end if;
    if new.offer_id is not null then update offers set status = 'used' where id = new.offer_id; end if;
    update products set held_for = null, held_until = null where id = new.product_id or id = any (new.bundle_product_ids);
  end if;
  return new;
end $$;
create trigger orders_bundle_stock after update on orders for each row execute function orders_bundle_stock();

-- ===== "Usually replies within" =====
-- Median minutes between a buyer's first message in a chat and the shop's first answer, over the last 60 days.
create function shop_reply_minutes(p_shop uuid) returns int
language sql stable security definer set search_path = public as $$
  with firsts as (
    select c.id,
      (select min(created_at) from messages m where m.conversation_id = c.id and m.sender_id = c.buyer_id) as asked,
      (select min(created_at) from messages m where m.conversation_id = c.id and m.sender_id <> c.buyer_id) as answered
    from conversations c where c.shop_id = p_shop and c.created_at > now() - interval '60 days'
  )
  select (percentile_cont(0.5) within group (order by extract(epoch from answered - asked) / 60))::int
  from firsts where asked is not null and answered is not null and answered > asked;
$$;
grant execute on function shop_reply_minutes(uuid) to anon, authenticated;

-- my_conversations also returns the buyer's id (to show their orders in the chat).
drop function my_conversations();
create function my_conversations()
returns table (id uuid, shop_id uuid, shop_name text, shop_handle text, other_name text, i_am_seller boolean,
               last_body text, last_at timestamptz, unread int, buyer_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id, s.id, s.name, s.handle,
         case when c.buyer_id = auth.uid() then s.name else coalesce(nullif(p.display_name, ''), 'Buyer') end,
         c.buyer_id <> auth.uid(),
         (select case when m.offer_id is not null then 'Sent an offer' when length(m.body) = 0 then 'Sent a photo' else m.body end
            from messages m where m.conversation_id = c.id order by created_at desc limit 1),
         c.last_message_at,
         (select count(*)::int from messages m where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.read_at is null),
         c.buyer_id
  from conversations c join shops s on s.id = c.shop_id join profiles p on p.id = c.buyer_id
  where (c.buyer_id = auth.uid() or s.owner_id = auth.uid())
    and not blocked_between(c.buyer_id, s.owner_id)
  order by c.last_message_at desc;
$$;
grant execute on function my_conversations() to authenticated;

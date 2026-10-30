-- Brings the live database up to date: migrations 0009 to 0014, in one go.
-- Paste into Supabase > SQL Editor > New query, then Run. Safe to run once; it stops and changes nothing if any part fails.
-- Afterwards `supabase db push` knows these are applied (they are recorded at the bottom).
begin;

-- ===== 20261029000009_public_reactions.sql =====
-- Likes and reposts are public: anyone can see who liked or reposted what, like TikTok.
-- People can still only add or remove their own.
drop policy "own reactions" on post_reactions;
grant select on post_reactions to anon;
create policy "reactions are public" on post_reactions for select to anon, authenticated using (true);
create policy "add own reactions" on post_reactions for insert to authenticated with check (user_id = auth.uid());
create policy "remove own reactions" on post_reactions for delete to authenticated using (user_id = auth.uid());

-- ===== 20261029000010_listing_photos.sql =====
-- Extra photos on a listing (up to 10). The post's video or photo stays the cover; these show in the item sheet.
create table listing_photos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  storage_path text not null,
  position int not null default 0 check (position between 0 and 9),
  created_at timestamptz not null default now()
);
create index listing_photos_product on listing_photos (product_id, position);

alter table listing_photos enable row level security;
grant select on listing_photos to anon, authenticated;
grant insert, delete on listing_photos to authenticated;

create function owns_product(p_product uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from products p join shops s on s.id = p.shop_id where p.id = p_product and s.owner_id = auth.uid());
$$;
create function product_is_live(p_product uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from products where id = p_product and status = 'live');
$$;
create function listing_photo_count(p_product uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from listing_photos where product_id = p_product;
$$;

create policy "photos of live items are public" on listing_photos for select to anon, authenticated
  using (product_is_live(product_id) or owns_product(product_id));
create policy "sellers add photos to their own items" on listing_photos for insert to authenticated
  with check (owns_product(product_id) and storage_path like auth.uid()::text || '/%' and listing_photo_count(product_id) < 10);
create policy "sellers remove their own photos" on listing_photos for delete to authenticated using (owns_product(product_id));

-- ===== 20261030000011_safety_comments_messages.sql =====
-- Store must haves (report, block, a content filter) plus comments and messages.

-- ===== A simple filter for abusive words in comments and messages =====
-- [CONFIRM] grow this list, and add automatic image and text moderation later.
create function rude_text(t text) returns boolean language sql immutable as $$
  select t ~* '\m(fuck|fucking|cunt|bitch|nigger|kaffir|kaffer|poes|naai|moer|faggot|whore|slut)\M';
$$;

-- ===== Blocks =====
create table blocks (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table blocks enable row level security;
grant select, insert, delete on blocks to authenticated;
create policy "own blocks" on blocks for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- True when either person blocked the other.
create function blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;
create function shop_owner(p_shop uuid) returns uuid
language sql stable security definer set search_path = public as $$ select owner_id from shops where id = p_shop; $$;

-- People you blocked, with names, for the settings list.
create function my_blocks() returns table (user_id uuid, name text, shop_id uuid, shop_handle text)
language sql stable security definer set search_path = public as $$
  select b.blocked_id, coalesce(nullif(p.display_name, ''), 'User'), s.id, s.handle
  from blocks b join profiles p on p.id = b.blocked_id left join shops s on s.owner_id = b.blocked_id
  where b.blocker_id = auth.uid() order by b.created_at desc;
$$;

-- ===== Reports =====
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles (id) on delete set null,
  target_kind text not null check (target_kind in ('post', 'shop', 'comment', 'message', 'user')),
  target_id uuid not null,
  reason text not null check (reason in ('counterfeit', 'not_as_shown', 'offensive', 'scam', 'spam', 'other')),
  details text not null default '' check (length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table reports enable row level security;
grant select, insert on reports to authenticated;
create policy "file a report" on reports for insert to authenticated with check (reporter_id = auth.uid() and status = 'open');
create policy "see own reports, team sees all" on reports for select to authenticated using (reporter_id = auth.uid() or is_admin());

-- ===== Comments =====
create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 300),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index comments_post on comments (post_id, created_at);
alter table comments enable row level security;
grant select, insert, delete on comments to authenticated;
create policy "see visible comments" on comments for select to authenticated
  using (not hidden and not blocked_between(auth.uid(), user_id) or user_id = auth.uid() or is_admin());
create policy "comment as yourself" on comments for insert to authenticated
  with check (user_id = auth.uid() and not hidden
    and not blocked_between(auth.uid(), shop_owner((select shop_id from posts where id = post_id))));
create policy "delete own comment, or on your own post" on comments for delete to authenticated
  using (user_id = auth.uid() or shop_owner((select shop_id from posts where id = post_id)) = auth.uid() or is_admin());

-- Comments for a post with the author's name, for everyone (signed out too). Hides blocked people.
create function post_comments(p_post uuid)
returns table (id uuid, body text, created_at timestamptz, user_id uuid, name text, shop_handle text, is_seller boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.body, c.created_at, c.user_id, coalesce(nullif(p.display_name, ''), 'User'), s.handle,
         s.owner_id is not null and s.id = (select shop_id from posts where id = p_post)
  from comments c join profiles p on p.id = c.user_id left join shops s on s.owner_id = c.user_id
  where c.post_id = p_post and not c.hidden
    and (auth.uid() is null or not blocked_between(auth.uid(), c.user_id))
  order by c.created_at
  limit 200;
$$;
create function comment_counts(p_ids uuid[]) returns table (post_id uuid, comments int)
language sql stable security definer set search_path = public as $$
  select p.id, (select count(*)::int from comments c where c.post_id = p.id and not c.hidden) from posts p where p.id = any (p_ids[1:100]);
$$;

-- ===== Messages between a buyer and a shop =====
create table conversations (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references profiles (id) on delete cascade,
  shop_id uuid not null references shops (id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (buyer_id, shop_id)
);
alter table conversations enable row level security;
grant select, insert on conversations to authenticated;
create policy "people in the chat see it" on conversations for select to authenticated
  using (buyer_id = auth.uid() or shop_owner(shop_id) = auth.uid() or is_admin());
create policy "start a chat with a shop" on conversations for insert to authenticated
  with check (buyer_id = auth.uid() and shop_owner(shop_id) <> auth.uid() and not blocked_between(auth.uid(), shop_owner(shop_id)));

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  sender_id uuid not null references profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 1000),
  -- The item the message is about (from "Message seller" on a product). Must belong to the chat's shop.
  product_id uuid references products (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_conv on messages (conversation_id, created_at);
alter table messages enable row level security;
grant select, insert on messages to authenticated;
grant update (read_at) on messages to authenticated;

create function in_conversation(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversations c where c.id = p_conv and (c.buyer_id = auth.uid() or shop_owner(c.shop_id) = auth.uid()));
$$;
create function other_person(p_conv uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when c.buyer_id = auth.uid() then shop_owner(c.shop_id) else c.buyer_id end from conversations c where c.id = p_conv;
$$;
create policy "people in the chat read it" on messages for select to authenticated using (in_conversation(conversation_id) or is_admin());
create policy "send in your own chats" on messages for insert to authenticated
  with check (sender_id = auth.uid() and in_conversation(conversation_id) and not blocked_between(auth.uid(), other_person(conversation_id)));
create policy "mark messages to you as read" on messages for update to authenticated
  using (in_conversation(conversation_id) and sender_id <> auth.uid()) with check (in_conversation(conversation_id));

-- My chats with the other side's name, the last message and unread count.
create function my_conversations()
returns table (id uuid, shop_id uuid, shop_name text, shop_handle text, other_name text, i_am_seller boolean,
               last_body text, last_at timestamptz, unread int)
language sql stable security definer set search_path = public as $$
  select c.id, s.id, s.name, s.handle,
         case when c.buyer_id = auth.uid() then s.name else coalesce(nullif(p.display_name, ''), 'Buyer') end,
         c.buyer_id <> auth.uid(),
         (select body from messages m where m.conversation_id = c.id order by created_at desc limit 1),
         c.last_message_at,
         (select count(*)::int from messages m where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.read_at is null)
  from conversations c join shops s on s.id = c.shop_id join profiles p on p.id = c.buyer_id
  where (c.buyer_id = auth.uid() or s.owner_id = auth.uid())
    and not blocked_between(c.buyer_id, s.owner_id)
  order by c.last_message_at desc;
$$;

-- ===== Filter, chat bookkeeping and notifications =====
create function social_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if rude_text(new.body) then raise exception 'Please keep it friendly. That message has words we don''t allow.'; end if;
  if tg_table_name = 'messages' then
    if new.product_id is not null and (select shop_id from products where id = new.product_id)
       <> (select shop_id from conversations where id = new.conversation_id) then
      raise exception 'That item is from a different shop.';
    end if;
    update conversations set last_message_at = now() where id = new.conversation_id;
    perform notify(other_person_of(new.conversation_id, new.sender_id), 'message', 'New message', left(new.body, 80), '/messages/' || new.conversation_id);
  elsif tg_table_name = 'comments' then
    if shop_owner((select shop_id from posts where id = new.post_id)) <> new.user_id then
      perform notify(shop_owner((select shop_id from posts where id = new.post_id)), 'comment', 'New comment', left(new.body, 80), null);
    end if;
  end if;
  return new;
end $$;
create function other_person_of(p_conv uuid, p_sender uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when c.buyer_id = p_sender then shop_owner(c.shop_id) else c.buyer_id end from conversations c where c.id = p_conv;
$$;
create trigger comments_guard before insert on comments for each row execute function social_guard();
create trigger messages_guard before insert on messages for each row execute function social_guard();

-- ===== Team: handle a report =====
create function admin_handle_report(p_report uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare r reports;
begin
  if not is_admin() then raise exception 'Only our team can do this.'; end if;
  select * into r from reports where id = p_report for update;
  if r.id is null then raise exception 'Report not found.'; end if;
  if p_action = 'dismiss' then
    update reports set status = 'dismissed', handled_at = now() where id = p_report;
    return;
  elsif p_action <> 'remove' then
    raise exception 'Unknown action.';
  end if;
  if r.target_kind = 'post' then update posts set status = 'removed' where id = r.target_id;
  elsif r.target_kind = 'comment' then update comments set hidden = true where id = r.target_id;
  elsif r.target_kind = 'shop' then update shops set status = 'banned' where id = r.target_id;
  end if;
  update reports set status = 'actioned', handled_at = now() where id = p_report;
end $$;

-- ===== Delete my account (called by the delete-account server function) =====
-- Keeps orders and payouts the law and disputes need, but removes the person: name, bio, posts, comments,
-- likes, follows, chats and blocks. The server function then deletes the sign in.
create function forget_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set display_name = 'Deleted user', bio = '', handle = null where id = p_user;
  update shops set status = 'paused', bio = '' where owner_id = p_user and status <> 'banned';
  update posts set status = 'removed' where shop_id in (select id from shops where owner_id = p_user);
  delete from comments where user_id = p_user;
  delete from post_reactions where user_id = p_user;
  delete from follows where user_id = p_user;
  delete from blocks where blocker_id = p_user or blocked_id = p_user;
  delete from conversations where buyer_id = p_user or shop_id in (select id from shops where owner_id = p_user);
  delete from notifications where user_id = p_user;
end $$;

-- Orders that still need finishing before an account can be deleted.
create function open_orders_for(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from orders o
  where (o.buyer_id = p_user or o.shop_id in (select id from shops where owner_id = p_user))
    and o.status not in ('completed', 'cancelled', 'refunded');
$$;

revoke execute on function forget_user(uuid), open_orders_for(uuid), other_person_of(uuid, uuid) from public, anon, authenticated;
revoke execute on function admin_handle_report(uuid, text) from public, anon;
grant execute on function admin_handle_report(uuid, text), my_blocks(), my_conversations() to authenticated;
grant execute on function post_comments(uuid), comment_counts(uuid[]) to anon, authenticated;

-- ===== 20261030000012_chat_selling.sql =====
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

-- ===== 20261030000013_device_tokens.sql =====
-- Phone app push notifications: each signed in device registers its token here.
-- Sending happens in a server function once Apple (APNs) and Google (Firebase) keys are added. [Lehloma]
create table device_tokens (
  token text primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index device_tokens_user on device_tokens (user_id);
alter table device_tokens enable row level security;
grant select, insert, update, delete on device_tokens to authenticated;
create policy "own devices" on device_tokens for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Deleting an account also forgets its devices.
create or replace function forget_devices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.display_name = 'Deleted user' and old.display_name is distinct from 'Deleted user' then
    delete from device_tokens where user_id = new.id;
  end if;
  return new;
end $$;
create trigger profiles_forget_devices after update on profiles for each row execute function forget_devices();

-- ===== 20261030000014_flow.sql =====
-- Faster checkout, a better first feed, and error reports.

-- ===== Saved delivery details =====
-- Kept in their own table (not on profiles) because profiles are readable by other signed in users.
create table delivery_details (
  user_id uuid primary key references profiles (id) on delete cascade,
  delivery text check (delivery is null or length(delivery) <= 40),
  locker text check (locker is null or length(locker) <= 120),
  name text check (name is null or length(name) <= 80),
  phone text check (phone is null or length(phone) <= 20),
  address text check (address is null or length(address) <= 300),
  updated_at timestamptz not null default now()
);
alter table delivery_details enable row level security;
grant select, insert, update, delete on delivery_details to authenticated;
create policy "only you see your delivery details" on delivery_details for select to authenticated using (user_id = auth.uid());
create policy "only you save your delivery details" on delivery_details for insert to authenticated with check (user_id = auth.uid());
create policy "only you change your delivery details" on delivery_details for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "only you remove your delivery details" on delivery_details for delete to authenticated using (user_id = auth.uid());

-- ===== Interests picked on the welcome screens (used to order the first For You feed) =====
alter table profiles add column interests text[] not null default '{}'
  check (interests <@ array['clothes', 'beauty', 'food', 'designer']::text[]);
grant update (interests) on profiles to authenticated;

-- ===== Error reports from the app =====
-- Anyone can send one (even before signing in). Only the team can read them.
create table app_errors (
  id bigint generated always as identity primary key,
  user_id uuid references profiles (id) on delete set null default auth.uid(),
  message text not null check (length(message) between 1 and 500),
  stack text check (stack is null or length(stack) <= 4000),
  path text check (path is null or length(path) <= 200),
  platform text check (platform is null or length(platform) <= 20),
  version text check (version is null or length(version) <= 40),
  created_at timestamptz not null default now()
);
create index app_errors_created_idx on app_errors (created_at desc);
alter table app_errors enable row level security;
grant insert on app_errors to anon, authenticated;
grant select on app_errors to authenticated;
create policy "anyone can send an error report" on app_errors for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
create policy "the team reads error reports" on app_errors for select to authenticated using (is_admin());

-- Keep 30 days of error reports.
create function prune_app_errors() returns void language sql security definer set search_path = public as $$
  delete from app_errors where created_at < now() - interval '30 days';
$$;

-- Deleting an account also forgets its devices, saved delivery details and interests.
create or replace function forget_devices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.display_name = 'Deleted user' and old.display_name is distinct from 'Deleted user' then
    delete from device_tokens where user_id = new.id;
    delete from delivery_details where user_id = new.id;
    new.interests := '{}';
  end if;
  return new;
end $$;
drop trigger profiles_forget_devices on profiles;
create trigger profiles_forget_devices before update on profiles for each row execute function forget_devices();

-- ===== Link previews =====
-- What WhatsApp and others show when someone shares an item: title, price, shop and a picture.
-- Only items that are on sale (or just sold out) from open shops.
create function share_card(p_product uuid)
returns table (title text, price_cents int, shop_handle text, shop_name text, mux_playback_id text, image_path text)
language sql stable security definer set search_path = public as $$
  select p.title, p.price_cents, s.handle, s.name,
    (select m.mux_playback_id from posts po join media m on m.id = po.media_id
       where po.product_id = p.id and po.status = 'live' order by po.created_at desc limit 1),
    coalesce(
      (select m.storage_path from posts po join media m on m.id = po.media_id
         where po.product_id = p.id and po.status = 'live' and m.kind = 'image' order by po.created_at desc limit 1),
      (select lp.storage_path from listing_photos lp where lp.product_id = p.id order by lp.position limit 1))
  from products p join shops s on s.id = p.shop_id
  where p.id = p_product and p.status in ('live', 'sold_out') and s.status = 'open';
$$;
grant execute on function share_card(uuid) to anon, authenticated;

-- Record them as applied.
insert into supabase_migrations.schema_migrations (version, name) values ('20261029000009', 'public_reactions') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261029000010', 'listing_photos') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261030000011', 'safety_comments_messages') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261030000012', 'chat_selling') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261030000013', 'device_tokens') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20261030000014', 'flow') on conflict (version) do nothing;
commit;

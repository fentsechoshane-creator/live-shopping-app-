-- Friends and sharing, like TikTok (decided with Ofentse 7 Nov 2026).
-- People follow people. Friends are people who follow each other; following someone's shop counts as following them.
-- Friends can chat and send each other posts from the Share sheet. Everyone on myHaul is 18 or older (complete_account),
-- so messaging only needs a finished account. Shop chats (conversations) are unchanged.

create table people_follows (
  follower_id uuid not null references profiles (id) on delete cascade,
  followee_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index people_follows_followee on people_follows (followee_id);
alter table people_follows enable row level security;
grant select on people_follows to authenticated;
-- You see who you follow and who follows you. Counts come from person_page().
create policy "own follows" on people_follows for select to authenticated using (follower_id = auth.uid() or followee_id = auth.uid());

-- x follows y: directly, or by following one of y's shops.
create function follows_person(x uuid, y uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from people_follows where follower_id = x and followee_id = y)
      or exists (select 1 from follows f join shops s on s.id = f.shop_id where f.user_id = x and s.owner_id = y);
$$;
create function are_friends(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select a <> b and follows_person(a, b) and follows_person(b, a);
$$;
revoke execute on function follows_person(uuid, uuid), are_friends(uuid, uuid) from public, anon;

create function follow_person(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me profiles; was boolean;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.handle is null or me.adult_confirmed_at is null then raise exception 'Finish setting up your account first.'; end if;
  if p_user = me.id then raise exception 'You can''t follow yourself.'; end if;
  if p_on and is_suspended(me.id) then raise exception 'Your account is paused, so you can''t follow people.'; end if;
  if not p_on then delete from people_follows where follower_id = me.id and followee_id = p_user; return; end if;
  if blocked_between(me.id, p_user) then raise exception 'You can''t follow this account.'; end if;
  if not exists (select 1 from profiles where id = p_user and handle is not null) then raise exception 'That account isn''t available.'; end if;
  if (select count(*) from people_follows where follower_id = me.id and created_at > now() - interval '1 day') >= 200 then
    raise exception 'That''s a lot of follows today. Try again tomorrow.'; end if;
  was := follows_person(me.id, p_user);
  insert into people_follows (follower_id, followee_id) values (me.id, p_user) on conflict do nothing;
  if not was then
    perform notify(p_user, 'follow',
      case when follows_person(p_user, me.id) then coalesce(nullif(me.display_name, ''), '@' || me.handle) || ' followed you back. You''re friends now.'
           else coalesce(nullif(me.display_name, ''), '@' || me.handle) || ' followed you' end,
      case when follows_person(p_user, me.id) then 'You can send each other posts and messages.' else 'Follow back to be friends.' end,
      '/u/' || me.handle);
  end if;
end $$;
revoke execute on function follow_person(uuid, boolean) from public, anon;
grant execute on function follow_person(uuid, boolean) to authenticated;

-- A person's page: name, picture, counts, their shop, and how you're connected.
create function person_page(p_handle text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', p.id, 'name', p.display_name, 'handle', p.handle, 'avatarPath', p.avatar_path, 'bio', p.bio,
    'followers', (select count(*) from people_follows where followee_id = p.id),
    'following', (select count(*) from people_follows where follower_id = p.id),
    'shop', (select jsonb_build_object('handle', s.handle, 'name', s.name) from shops s where s.owner_id = p.id and s.status = 'open' limit 1),
    'iFollow', follows_person(auth.uid(), p.id), 'followsMe', follows_person(p.id, auth.uid()),
    'me', p.id = auth.uid(), 'blocked', blocked_between(auth.uid(), p.id))
  from profiles p where p.handle = lower(p_handle) and not is_suspended(p.id);
$$;
grant execute on function person_page(text) to authenticated;

-- Find people by name or username, for Find friends.
create function find_people(p_query text) returns table (id uuid, name text, handle text, avatar_path text, i_follow boolean, follows_me boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.display_name, p.handle, p.avatar_path, follows_person(auth.uid(), p.id), follows_person(p.id, auth.uid())
  from profiles p
  where length(trim(p_query)) >= 2 and p.handle is not null and p.id <> auth.uid() and not is_suspended(p.id)
    and not blocked_between(auth.uid(), p.id)
    and (p.handle ilike replace(replace(trim(lower(p_query)), '%', ''), '_', '\_') || '%'
      or p.display_name ilike '%' || replace(replace(trim(p_query), '%', ''), '_', '\_') || '%')
  order by (p.handle = trim(lower(p_query))) desc, p.handle
  limit 20;
$$;
grant execute on function find_people(text) to authenticated;

-- People who follow you (or your shop) that you don't follow back yet: Find friends shows them first.
create function follow_backs() returns table (id uuid, name text, handle text, avatar_path text)
language sql stable security definer set search_path = public, pg_temp as $$
  with fans as (
    select follower_id as id, created_at from people_follows where followee_id = auth.uid()
    union all select f.user_id, f.created_at from follows f join shops s on s.id = f.shop_id where s.owner_id = auth.uid())
  select p.id, p.display_name, p.handle, p.avatar_path
  from (select fans.id, max(fans.created_at) as at from fans group by fans.id) x join profiles p on p.id = x.id
  where p.id <> auth.uid() and p.handle is not null and not follows_person(auth.uid(), p.id)
    and not blocked_between(auth.uid(), p.id) and not is_suspended(p.id)
  order by x.at desc
  limit 50;
$$;
grant execute on function follow_backs() to authenticated;

-- ===== Friend chats =====
create table friend_chats (
  id uuid primary key default gen_random_uuid(),
  a_id uuid not null references profiles (id) on delete cascade,
  b_id uuid not null references profiles (id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (a_id < b_id),
  unique (a_id, b_id)
);
alter table friend_chats enable row level security;
grant select on friend_chats to authenticated;
create policy "people in the chat see it" on friend_chats for select to authenticated using (auth.uid() in (a_id, b_id) or is_admin());

create table friend_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references friend_chats (id) on delete cascade,
  sender_id uuid not null references profiles (id) on delete cascade,
  body text not null default '' check (length(body) <= 1000),
  -- A shared post. Shown as a card; if the post is taken down the card says so.
  post_id uuid references posts (id) on delete set null,
  shared boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (length(trim(body)) > 0 or shared)
);
create index friend_messages_chat on friend_messages (chat_id, created_at);
alter table friend_messages enable row level security;
grant select on friend_messages to authenticated;
create policy "people in the chat see messages" on friend_messages for select to authenticated
  using (exists (select 1 from friend_chats t where t.id = chat_id and (auth.uid() in (t.a_id, t.b_id) or is_admin())));
-- My friends (for the Share sheet and the Inbox row), people I chatted with most recently first.
create function my_friends() returns table (id uuid, name text, handle text, avatar_path text, chat_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (
    select followee_id as id from people_follows where follower_id = auth.uid()
    union select s.owner_id from follows f join shops s on s.id = f.shop_id where f.user_id = auth.uid())
  select p.id, p.display_name, p.handle, p.avatar_path, t.id
  from mine join profiles p on p.id = mine.id
  left join friend_chats t on t.a_id = least(auth.uid(), p.id) and t.b_id = greatest(auth.uid(), p.id)
  where p.id <> auth.uid() and follows_person(p.id, auth.uid()) and not blocked_between(auth.uid(), p.id) and not is_suspended(p.id)
  order by t.last_message_at desc nulls last, p.display_name
  limit 200;
$$;

grant execute on function my_friends() to authenticated;

-- Send to one friend: a message, a shared post, or both. Every rule is here.
create function send_to_friend(p_to uuid, p_body text, p_post uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me profiles; t friend_chats; b text := trim(coalesce(p_body, ''));
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.handle is null or me.adult_confirmed_at is null then raise exception 'Finish setting up your account first.'; end if;
  if is_suspended(me.id) then raise exception 'Your account is paused, so you can''t send messages.'; end if;
  if not are_friends(me.id, p_to) then raise exception 'You can message friends: people you follow who follow you back.'; end if;
  if blocked_between(me.id, p_to) or is_suspended(p_to) then raise exception 'You can''t message this account.'; end if;
  if length(b) = 0 and p_post is null then raise exception 'Write a message first.'; end if;
  if length(b) > 1000 then raise exception 'Keep messages under 1000 characters.'; end if;
  if length(b) > 0 and rude_text(b) then raise exception 'Please keep it friendly. That message has words we don''t allow.'; end if;
  if p_post is not null and not exists (select 1 from posts where id = p_post and status = 'live') then raise exception 'That post isn''t available any more.'; end if;
  if (select count(*) from friend_messages where sender_id = me.id and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'You''re sending a lot. Take a short break and try again.'; end if;
  insert into friend_chats (a_id, b_id) values (least(me.id, p_to), greatest(me.id, p_to))
    on conflict (a_id, b_id) do update set last_message_at = now() returning * into t;
  insert into friend_messages (chat_id, sender_id, body, post_id, shared) values (t.id, me.id, b, p_post, p_post is not null);
  perform notify(p_to, 'friend_message', coalesce(nullif(me.display_name, ''), '@' || me.handle),
    case when p_post is not null then 'Sent you a post' || case when length(b) > 0 then ': ' || left(b, 80) else '' end else left(b, 120) end,
    '/chats/' || t.id);
  return t.id;
end $$;
revoke execute on function send_to_friend(uuid, text, uuid) from public, anon;
grant execute on function send_to_friend(uuid, text, uuid) to authenticated;

-- The Share sheet: one post to up to 20 friends, with an optional note.
create function share_post(p_post uuid, p_to uuid[], p_note text default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid; n int := 0;
begin
  if coalesce(array_length(p_to, 1), 0) = 0 then raise exception 'Pick at least one friend.'; end if;
  if array_length(p_to, 1) > 20 then raise exception 'Send to up to 20 friends at a time.'; end if;
  foreach u in array (select array_agg(distinct x) from unnest(p_to) x) loop
    perform send_to_friend(u, p_note, p_post);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function share_post(uuid, uuid[], text) from public, anon;
grant execute on function share_post(uuid, uuid[], text) to authenticated;

-- Inbox list of friend chats.
create function my_friend_chats() returns table (id uuid, other_id uuid, other_name text, other_handle text, other_avatar text,
  last_body text, last_shared boolean, last_mine boolean, last_at timestamptz, unread int, friends boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, p.id, p.display_name, p.handle, p.avatar_path, m.body, m.shared, m.sender_id = auth.uid(), t.last_message_at,
    (select count(*)::int from friend_messages x where x.chat_id = t.id and x.sender_id <> auth.uid() and x.read_at is null),
    are_friends(auth.uid(), p.id)
  from friend_chats t
  join profiles p on p.id = case when t.a_id = auth.uid() then t.b_id else t.a_id end
  left join lateral (select body, shared, sender_id from friend_messages where chat_id = t.id order by created_at desc limit 1) m on true
  where auth.uid() in (t.a_id, t.b_id) and not blocked_between(auth.uid(), p.id)
  order by t.last_message_at desc
  limit 100;
$$;
grant execute on function my_friend_chats() to authenticated;

-- Open a chat with a friend (from their page or the Inbox row) without sending anything yet.
create function friend_chat_with(p_user uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid;
begin
  select id into t from friend_chats where a_id = least(auth.uid(), p_user) and b_id = greatest(auth.uid(), p_user);
  if t is not null then return t; end if;
  if not are_friends(auth.uid(), p_user) then raise exception 'You can message friends: people you follow who follow you back.'; end if;
  insert into friend_chats (a_id, b_id) values (least(auth.uid(), p_user), greatest(auth.uid(), p_user)) returning id into t;
  return t;
end $$;
revoke execute on function friend_chat_with(uuid) from public, anon;
grant execute on function friend_chat_with(uuid) to authenticated;

create function read_friend_chat(p_chat uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update friend_messages m set read_at = now()
  from friend_chats t
  where m.chat_id = p_chat and t.id = p_chat and auth.uid() in (t.a_id, t.b_id) and m.sender_id <> auth.uid() and m.read_at is null;
$$;
revoke execute on function read_friend_chat(uuid) from public, anon;
grant execute on function read_friend_chat(uuid) to authenticated;

-- What a shared post card shows: the item, its price, the picture, whether it can still be bought.
create function shared_post_card(p_post uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('postId', po.id, 'productId', p.id, 'title', p.title, 'priceCents', p.price_cents, 'mode', p.mode,
    'shopName', s.name, 'shopHandle', s.handle, 'playbackId', m.mux_playback_id, 'path', m.storage_path, 'kind', m.kind,
    'cover', coalesce((po.edit->>'cover')::numeric, 0), 'available', po.status = 'live' and p.status = 'live' and s.status = 'open')
  from posts po join products p on p.id = po.product_id join shops s on s.id = po.shop_id join media m on m.id = po.media_id
  where po.id = p_post
    and exists (select 1 from friend_messages fm join friend_chats t on t.id = fm.chat_id
                where fm.post_id = p_post and auth.uid() in (t.a_id, t.b_id));
$$;
grant execute on function shared_post_card(uuid) to authenticated;

-- Blocking someone also unfollows both ways.
create function unfollow_on_block() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from people_follows where (follower_id = new.blocker_id and followee_id = new.blocked_id) or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end $$;
create trigger blocks_unfollow after insert on blocks for each row execute function unfollow_on_block();

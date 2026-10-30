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

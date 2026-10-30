-- Proper accounts, like Instagram and TikTok: a unique @username, a name, a profile photo,
-- an age check (18 and over) and accepting the terms when the account is made.

-- ===== Profile fields =====
alter table profiles add column avatar_path text check (avatar_path is null or length(avatar_path) <= 200);
alter table profiles add column handle_changed_at timestamptz;
alter table profiles add column adult_confirmed_at timestamptz;
alter table profiles add column terms_accepted_at timestamptz;
-- Usernames only change through set_username (so the rules below always apply).
revoke update (handle) on profiles from authenticated;
grant update (avatar_path) on profiles to authenticated;

-- ===== Username rules =====
-- 3 to 30 characters: lowercase letters, numbers, dots and underscores. No dot at the start or end, no two dots in a row.
-- Usernames and shop handles share one list, so @thandi can't be one person and a different person's shop.
create table reserved_handles (handle text primary key);
insert into reserved_handles (handle) values
  ('admin'), ('administrator'), ('myhaul'), ('my.haul'), ('myhaul.official'), ('official'), ('support'), ('help'), ('team'),
  ('staff'), ('moderator'), ('security'), ('settings'), ('explore'), ('activity'), ('messages'), ('orders'), ('checkout'),
  ('signin'), ('signup'), ('login'), ('logout'), ('privacy'), ('terms'), ('about'), ('api'), ('www'), ('root'), ('system'),
  ('null'), ('undefined'), ('anonymous'), ('deleted'), ('everyone'), ('live'), ('shop'), ('shops'), ('sell'), ('post'),
  ('tradesafe'), ('pudo'), ('payfast'), ('ozow');

create function handle_problem(p_handle text, p_user uuid default auth.uid()) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_handle is null or length(p_handle) < 3 then 'Use at least 3 characters.'
    when length(p_handle) > 30 then 'Use 30 characters or fewer.'
    when p_handle !~ '^[a-z0-9._]+$' then 'Use only lowercase letters, numbers, dots and underscores.'
    when p_handle ~ '^\.|\.$' then 'A username can''t start or end with a dot.'
    when p_handle ~ '\.\.' then 'A username can''t have two dots in a row.'
    when p_handle ~ '^[0-9._]+$' then 'Add at least one letter.'
    when exists (select 1 from reserved_handles r where r.handle = p_handle) then 'That username is reserved.'
    when exists (select 1 from profiles p where p.handle = p_handle and p.id is distinct from p_user) then 'That username is taken.'
    when exists (select 1 from shops s where s.handle = p_handle and s.owner_id is distinct from p_user) then 'That username is taken.'
    else null
  end;
$$;

-- Which of these usernames are free (for live checks and suggestions while typing).
create function available_handles(p_handles text[]) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(h order by i), '{}') from unnest(p_handles[1:12]) with ordinality as t(h, i)
  where handle_problem(lower(h)) is null;
$$;

-- Set or change your username. The first one is free; after that, once every 30 days (like TikTok).
create function set_username(p_handle text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles; h text := lower(trim(p_handle)); problem text;
begin
  select * into me from profiles where id = auth.uid() for update;
  if me.id is null then raise exception 'Please sign in.'; end if;
  if me.handle = h then return; end if;
  problem := handle_problem(h, me.id);
  if problem is not null then raise exception '%', problem; end if;
  if me.handle is not null and me.handle_changed_at is not null and me.handle_changed_at > now() - interval '30 days' then
    raise exception 'You can change your username again on %.', to_char(me.handle_changed_at + interval '30 days', 'FMDD FMMonth');
  end if;
  update profiles set handle = h, handle_changed_at = case when me.handle is null then null else now() end where id = me.id;
end $$;

-- Finish making the account: name, username, 18 and over, terms. Called once from the sign up steps.
create function complete_account(p_name text, p_handle text, p_adult boolean, p_terms boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(p_adult, false) then raise exception 'You need to be 18 or older to use myHaul.'; end if;
  if not coalesce(p_terms, false) then raise exception 'Please accept the terms to continue.'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Add your name (up to 40 characters).'; end if;
  perform set_username(p_handle);
  update profiles set display_name = trim(p_name),
    adult_confirmed_at = coalesce(adult_confirmed_at, now()), terms_accepted_at = coalesce(terms_accepted_at, now())
  where id = auth.uid();
end $$;

-- Shop handles follow the same list: a shop can use its owner's username, but not anyone else's.
create function shop_handle_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare problem text;
begin
  if tg_op = 'INSERT' or new.handle is distinct from old.handle then
    problem := handle_problem(new.handle, new.owner_id);
    if problem is not null then raise exception 'Shop handle: %', problem; end if;
  end if;
  return new;
end $$;
create trigger shops_handle_guard before insert or update of handle on shops for each row execute function shop_handle_guard();

-- ===== Profile photos =====
-- Public bucket; each person writes only inside their own folder.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
create policy "avatars are public" on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
create policy "upload your own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace your own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "remove your own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
-- The saved photo must be in your own folder.
alter table profiles add constraint avatar_in_own_folder check (avatar_path is null or avatar_path like id::text || '/%');

-- Photos and usernames for a list of people or shops, for avatars across the app (signed out too).
create function people_cards(p_users uuid[]) returns table (user_id uuid, handle text, name text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select id, handle, coalesce(nullif(display_name, ''), handle, 'User'), avatar_path from profiles where id = any (p_users[1:100]);
$$;
create function shop_avatars(p_shops uuid[]) returns table (shop_id uuid, avatar_path text)
language sql stable security definer set search_path = public as $$
  select s.id, p.avatar_path from shops s join profiles p on p.id = s.owner_id where s.id = any (p_shops[1:100]) and p.avatar_path is not null;
$$;
grant execute on function handle_problem(text, uuid) to authenticated;
grant execute on function available_handles(text[]), people_cards(uuid[]), shop_avatars(uuid[]) to anon, authenticated;
grant execute on function set_username(text), complete_account(text, text, boolean, boolean) to authenticated;

-- Deleting an account also clears the photo (the delete-account function removes the file).
create or replace function forget_devices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.display_name = 'Deleted user' and old.display_name is distinct from 'Deleted user' then
    delete from device_tokens where user_id = new.id;
    delete from delivery_details where user_id = new.id;
    new.interests := '{}';
    new.avatar_path := null;
  end if;
  return new;
end $$;

-- Comments show the person's photo and @username.
drop function post_comments(uuid);
create function post_comments(p_post uuid)
returns table (id uuid, body text, created_at timestamptz, user_id uuid, name text, shop_handle text, is_seller boolean, user_handle text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select c.id, c.body, c.created_at, c.user_id, coalesce(nullif(p.display_name, ''), p.handle, 'User'), s.handle,
         s.owner_id is not null and s.id = (select shop_id from posts where id = p_post), p.handle, p.avatar_path
  from comments c join profiles p on p.id = c.user_id left join shops s on s.owner_id = c.user_id
  where c.post_id = p_post and not c.hidden
    and (auth.uid() is null or not blocked_between(auth.uid(), c.user_id))
  order by c.created_at
  limit 200;
$$;
grant execute on function post_comments(uuid) to anon, authenticated;

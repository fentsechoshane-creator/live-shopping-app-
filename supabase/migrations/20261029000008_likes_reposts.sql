-- Likes and reposts on feed posts. Each person manages their own; counts are public through post_counts().
-- These are also signals for the ranking engine (buys count most, then browse and share, then likes, reposts and views).
create table post_reactions (
  user_id uuid not null references profiles (id) on delete cascade,
  post_id uuid not null references posts (id) on delete cascade,
  kind text not null check (kind in ('like', 'repost')),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id, kind)
);
create index post_reactions_post on post_reactions (post_id, kind);

alter table post_reactions enable row level security;
grant select, insert, delete on post_reactions to authenticated;
create policy "own reactions" on post_reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Like and repost counts for a set of posts. Counts only, never who reacted.
create function post_counts(p_ids uuid[])
returns table (post_id uuid, likes int, reposts int)
language sql stable security definer set search_path = public as $$
  select p.id,
         (select count(*)::int from post_reactions r where r.post_id = p.id and r.kind = 'like'),
         (select count(*)::int from post_reactions r where r.post_id = p.id and r.kind = 'repost')
  from posts p
  where p.id = any (p_ids[1:100]);
$$;
revoke execute on function post_counts(uuid[]) from public;
grant execute on function post_counts(uuid[]) to anon, authenticated;

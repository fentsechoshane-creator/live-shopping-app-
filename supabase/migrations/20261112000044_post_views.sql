-- View counts on grid tiles, like TikTok (Ofentse, 2026-11-12).
-- post_seen keeps one row per person per post per day and is pruned after 120 days, so the lifetime count lives on the
-- post itself (posts.views, there since the first schema but never filled) and only ever goes up. Same rule as the
-- stats: signed in, 2 seconds watched, once a day, owners don't count.
update posts po set views = (select count(*) from post_seen s where s.post_id = po.id);

create or replace function record_views(p_posts uuid[]) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or coalesce(array_length(p_posts, 1), 0) = 0 then return; end if;
  with added as (
    insert into post_seen (post_id, user_id)
      select po.id, auth.uid() from posts po join shops s on s.id = po.shop_id
      where po.id = any (p_posts[1:30]) and s.owner_id <> auth.uid()
      on conflict do nothing
      returning post_id
  )
  update posts po set views = po.views + 1 from added a where a.post_id = po.id;
end $$;
revoke execute on function record_views(uuid[]) from public, anon;
grant execute on function record_views(uuid[]) to authenticated;

-- Views for each item (all its posts added up). Public, like the counts on a TikTok profile. Items with no post are left out.
create function product_views(p_ids uuid[]) returns table (product_id uuid, views int)
language sql stable security definer set search_path = public as $$
  select po.product_id, sum(po.views)::int from posts po
  where po.product_id = any (p_ids[1:200]) and po.status <> 'removed'
  group by po.product_id;
$$;
revoke execute on function product_views(uuid[]) from public;
grant execute on function product_views(uuid[]) to anon, authenticated;

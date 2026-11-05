-- Fixes from the read only check of the live project (5 Nov 2026).

-- 1. Signed out visitors could ask whether any two people had blocked each other.
--    Every real use runs signed in or inside the database's own functions, so signed out callers lose it.
revoke execute on function public.blocked_between(uuid, uuid) from anon, public;
grant execute on function public.blocked_between(uuid, uuid) to authenticated;

-- 2. Every media row was readable by anyone, including packing proof rows, which name the order
--    and the seller. Now: media of live posts (what the feed and shop pages show), your own media, and the team.
--    The post check runs as its own helper so the media and posts rules don't loop into each other.
create function public.media_in_live_post(p_media uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from posts where media_id = p_media and status = 'live');
$$;
revoke execute on function public.media_in_live_post(uuid) from public;
grant execute on function public.media_in_live_post(uuid) to anon, authenticated;
drop policy if exists "media is public" on media;
create policy "media of live posts, your own, the team" on media for select using (
  owner_id = auth.uid() or is_admin() or media_in_live_post(id));

-- 3. Reviews showed which buyer bought from which shop, to anyone. Now only the buyer, the seller and
--    the team see a review row. Shop pages will show stars through a summary that leaves out the buyer.
drop policy if exists "reviews are public" on reviews;
create policy "buyer, seller and team see reviews" on reviews for select using (
  buyer_id = auth.uid() or is_admin()
  or exists (select 1 from shops s where s.id = reviews.shop_id and s.owner_id = auth.uid()));

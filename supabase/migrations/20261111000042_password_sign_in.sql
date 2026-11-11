-- Sign in with a username (or email) and a password (Ofentse, 11 Nov 2026). Supabase signs people in by email, so the
-- password-login function looks the person up here and checks the password, without ever telling the app anyone's
-- email. Only that server function (service role) can call this.
-- Guard: 10 tries per account per 15 minutes, counted before the password is checked, so guessing stalls quickly.
create function password_login_check(p_login text, p_password text) returns table (user_id uuid, email text)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare who uuid; login text := ltrim(lower(trim(coalesce(p_login, ''))), '@');
begin
  if length(login) < 3 or length(coalesce(p_password, '')) < 1 or length(p_password) > 200 then return; end if;
  if position('@' in login) > 0 then
    select u.id into who from auth.users u where lower(u.email) = login limit 1;
  else
    select pr.id into who from profiles pr where pr.handle = login;
  end if;
  if who is null then return; end if;
  if not take_usage(who, 'password_login', 10, interval '15 minutes') then
    raise exception 'Too many tries. Wait 15 minutes, or tap Forgot password.' using errcode = 'P0001';
  end if;
  return query
    select u.id, u.email::text from auth.users u
    where u.id = who and u.encrypted_password is not null and u.encrypted_password <> ''
      and u.encrypted_password = crypt(p_password, u.encrypted_password)
      and not is_suspended(u.id);
end $$;
revoke execute on function password_login_check(text, text) from public, anon, authenticated;
grant execute on function password_login_check(text, text) to service_role;

-- ===== Thumbnails for any list of items (Ofentse: "there are no thumbnails") =====
-- The cover of each item: its newest ready post's video or photo, else its first extra photo. Live auction copies use
-- the original listing's. Removed items only show to the buyer who ordered them and to the seller.
create function product_thumbs(p_ids uuid[]) returns table (product_id uuid, playback_id text, storage_path text, photo_path text)
language sql stable security definer set search_path = public as $$
  select p.id,
         m.mux_playback_id,
         m.storage_path,
         (select lp.storage_path from listing_photos lp where lp.product_id = coalesce(p.from_product_id, p.id) order by lp.position limit 1)
  from products p
  left join lateral (
    select md.mux_playback_id, md.storage_path from posts po join media md on md.id = po.media_id
    where po.product_id = coalesce(p.from_product_id, p.id) and md.status = 'ready'
    order by po.created_at desc limit 1) m on true
  where p.id = any (p_ids[1:100])
    and (p.status <> 'removed' or shop_owner(p.shop_id) = auth.uid()
         or exists (select 1 from orders o where o.product_id = p.id and o.buyer_id = auth.uid()));
$$;
grant execute on function product_thumbs(uuid[]) to anon, authenticated;

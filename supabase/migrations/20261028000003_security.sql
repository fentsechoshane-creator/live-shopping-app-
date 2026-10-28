-- Row level security: who can read and write what.
-- Rule of thumb: the app reads through these policies, and anything involving money goes through server functions.

alter table profiles enable row level security;
alter table shops enable row level security;
alter table seller_checks enable row level security;
alter table products enable row level security;
alter table media enable row level security;
alter table posts enable row level security;
alter table follows enable row level security;
alter table orders enable row level security;
alter table order_events enable row level security;
alter table returns enable row level security;
alter table reviews enable row level security;
alter table payouts enable row level security;
alter table trust_rules enable row level security;
alter table trust_events enable row level security;
alter table notifications enable row level security;

-- Start from nothing, then grant only what each role needs.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ===== Profiles =====
grant select on profiles to authenticated;
grant update (display_name, handle, city) on profiles to authenticated;
create policy "profiles readable by signed in users" on profiles for select to authenticated using (true);
create policy "update own profile" on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ===== Shops =====
grant select on shops to anon, authenticated;
grant update (name, bio, city) on shops to authenticated;
create policy "open shops are public" on shops for select using (status = 'open' or owner_id = auth.uid() or is_admin());
create policy "owner edits shop" on shops for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ===== Seller checks (private) =====
grant select on seller_checks to authenticated;
create policy "owner and admin read checks" on seller_checks for select to authenticated
  using (is_admin() or shop_id in (select id from shops where owner_id = auth.uid()));
grant select on seller_ready to authenticated;

-- ===== Products =====
grant select on products to anon, authenticated;
grant insert (shop_id, title, description, price_cents, mode, label, condition, sizes, stock, lead_days, allergens, status)
  on products to authenticated;
grant update (title, description, price_cents, label, condition, sizes, stock, lead_days, allergens, status)
  on products to authenticated;
create policy "live products are public" on products for select
  using (status in ('live', 'sold_out') or shop_id in (select id from shops where owner_id = auth.uid()) or is_admin());
create policy "owner adds products" on products for insert to authenticated
  with check (shop_id in (select id from shops where owner_id = auth.uid() and status <> 'banned'));
create policy "owner edits products" on products for update to authenticated
  using (shop_id in (select id from shops where owner_id = auth.uid() and status <> 'banned'))
  with check (shop_id in (select id from shops where owner_id = auth.uid() and status <> 'banned'));

-- ===== Media =====
grant select on media to anon, authenticated;
grant insert (owner_id, kind, storage_path, status) on media to authenticated;
create policy "media is public" on media for select using (true);
-- Without Mux, the app uploads to Storage first and then records the file as ready.
create policy "owner adds media" on media for insert to authenticated
  with check (owner_id = auth.uid()
              and (status = 'uploading' or (status = 'ready' and storage_path like auth.uid()::text || '/%')));

-- ===== Posts =====
grant select on posts to anon, authenticated;
grant insert (shop_id, product_id, media_id, caption) on posts to authenticated;
grant update (caption, status) on posts to authenticated;
create policy "live posts are public" on posts for select
  using (status = 'live' or shop_id in (select id from shops where owner_id = auth.uid()) or is_admin());
create policy "owner posts" on posts for insert to authenticated
  with check (
    shop_id in (select id from shops where owner_id = auth.uid() and status = 'open')
    and product_id in (select id from products where shop_id = posts.shop_id)
    and media_id in (select id from media where owner_id = auth.uid())
  );
create policy "owner edits posts" on posts for update to authenticated
  using (shop_id in (select id from shops where owner_id = auth.uid()));

-- ===== Follows =====
grant select, insert, delete on follows to authenticated;
create policy "own follows" on follows for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== Orders: read only for clients. Created and changed by server functions. =====
grant select on orders to authenticated;
create policy "buyer, seller and admin read orders" on orders for select to authenticated
  using (buyer_id = auth.uid() or shop_id in (select id from shops where owner_id = auth.uid()) or is_admin());

grant select on order_events to authenticated;
create policy "read events of visible orders" on order_events for select to authenticated
  using (order_id in (select id from orders));

grant select on returns to authenticated;
create policy "read returns of visible orders" on returns for select to authenticated
  using (order_id in (select id from orders));

grant select on reviews to anon, authenticated;
create policy "reviews are public" on reviews for select using (true);

grant select on payouts to authenticated;
create policy "seller and admin read payouts" on payouts for select to authenticated
  using (shop_id in (select id from shops where owner_id = auth.uid()) or is_admin());

-- ===== Trust =====
grant select on trust_rules to anon, authenticated;
create policy "rules are public" on trust_rules for select using (true);
grant select on trust_events to authenticated;
create policy "own trust history" on trust_events for select to authenticated using (user_id = auth.uid() or is_admin());

-- ===== Notifications =====
grant select on notifications to authenticated;
grant update (read_at) on notifications to authenticated;
create policy "own notifications" on notifications for select to authenticated using (user_id = auth.uid());
create policy "mark own read" on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== Functions the app may call =====
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function feed(int, int), shop_public(text) to anon, authenticated;
grant execute on function
  start_shop(text, text, shop_category), my_shop_id(), submit_id(text, text, text), submit_food_cert(text),
  accept_seller_rules(), open_shop(), submit_designer_proof(uuid, text),
  confirm_received(uuid), request_return(uuid, return_reason, text), leave_review(uuid, int, text),
  good_orders(uuid), is_admin(), tier_for(int),
  admin_review(uuid, text, boolean, text), admin_review_proof(uuid, boolean), admin_remove_product(uuid, text, boolean)
  to authenticated;
-- Used inside policies and triggers.
grant execute on function is_admin(), looks_counterfeit(text), mentions_brand(text), return_window(sale_mode),
  order_transition_allowed(order_status, order_status) to anon, authenticated;

-- ===== Storage =====
-- videos: public, for seller clips when Mux is not set up.
-- private: ID documents, selfies, food certificates, designer proof and packing videos. Owner and admins only.
insert into storage.buckets (id, name, public) values ('videos', 'videos', true), ('private', 'private', false)
on conflict (id) do nothing;

create policy "upload own videos" on storage.objects for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "videos are public" on storage.objects for select using (bucket_id = 'videos');
create policy "upload own private files" on storage.objects for insert to authenticated
  with check (bucket_id = 'private' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read own private files" on storage.objects for select to authenticated
  using (bucket_id = 'private' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

-- Server functions use the service role, which bypasses row level security.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

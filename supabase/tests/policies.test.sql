-- Policy and rule tests. Each block raises an error if a rule does not hold.
\set ON_ERROR_STOP 1

-- Helpers to act as a user. jwt claims mimic what Supabase sends.
create function pg_temp.act_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;
create function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  execute 'set role service_role';
end $$;
create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set role anon';
end $$;
create function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(lower(needle) in lower(sqlerrm)) = 0 then
      raise exception 'Expected error containing "%" but got: %', needle, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected an error containing "%" for: %', needle, sql;
end $$;
-- Packing proof for an order (video and sealed parcel photo by the seller, after payment).
create function pg_temp.packed(o uuid) returns void language plpgsql security definer as $$
declare seller uuid := (select s.owner_id from orders x join shops s on s.id = x.shop_id where x.id = o); v uuid; p uuid;
begin
  insert into media (owner_id, kind, storage_path, status) values (seller, 'video', seller || '/packing-' || o || '.mp4', 'ready') returning id into v;
  insert into media (owner_id, kind, storage_path, status) values (seller, 'image', seller || '/parcel-' || o || '.jpg', 'ready') returning id into p;
  if to_regclass('storage.objects') is not null then
    execute 'insert into storage.objects (bucket_id, name) values (''private'', $1), (''private'', $2)' using seller || '/packing-' || o || '.mp4', seller || '/parcel-' || o || '.jpg';
  end if;
  update orders set packing_media_id = v, packing_photo_media_id = p where id = o;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'seller@test.co.za'),
  ('00000000-0000-0000-0000-00000000000b', 'buyer@test.co.za'),
  ('00000000-0000-0000-0000-00000000000c', 'admin@test.co.za'),
  ('00000000-0000-0000-0000-00000000000d', 'other@test.co.za');
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000c';
do $$ begin assert (select count(*) from profiles) = 4, 'profiles created for new users'; end $$;

-- ===== Seller onboarding =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select start_shop('Lebo''s Thrift', 'thrift.with.lebo', 'clothes');
select pg_temp.expect_error($$update seller_checks set id_status = 'approved'$$, 'permission denied');
select pg_temp.expect_error($$update profiles set trust_score = 100 where id = auth.uid()$$, 'permission denied');
select pg_temp.expect_error($$insert into products (shop_id, title, price_cents, status) values (my_shop_id(), 'Oversized tee', 34900, 'live')$$, 'ID and bank');
select pg_temp.expect_error($$select open_shop()$$, 'rules');
select accept_seller_rules();
select pg_temp.expect_error($$select submit_id('0821234567', 'someone-else/id.jpg', 'someone-else/selfie.jpg')$$, 'own folder');
select submit_id('0821234567', '00000000-0000-0000-0000-00000000000a/id.jpg', '00000000-0000-0000-0000-00000000000a/selfie.jpg');
do $$ begin assert (select id_status from seller_checks) = 'pending', 'id pending after submit'; end $$;
select pg_temp.expect_error($$select open_shop()$$, 'bank');
reset role;

-- The bank step runs on the server (it creates the TradeSafe token).
select pg_temp.act_as_service();
update seller_checks set bank_status = 'approved', bank_name = 'Capitec', bank_last4 = '7890', escrow_token = 'tok_seller'
  where shop_id = (select id from shops where handle = 'thrift.with.lebo');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select open_shop();
do $$ begin
  assert (select status from shops where handle = 'thrift.with.lebo') = 'open', 'shop open';
  assert (select founding_until from shops where handle = 'thrift.with.lebo') > now() + interval '89 days', 'founding seller';
end $$;
-- Still pending ID, so listings cannot go live yet.
select pg_temp.expect_error($$insert into products (shop_id, title, price_cents, status) values (my_shop_id(), 'Oversized tee', 34900, 'live')$$, 'ID and bank');
reset role;

-- Another user cannot approve, the admin can.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select admin_review((select id from shops limit 1), 'id', true)$$, 'Admins only');
do $$ begin assert (select count(*) from seller_checks) = 0, 'others cannot read checks'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select admin_review((select id from shops where handle = 'thrift.with.lebo'), 'id', true);
reset role;
do $$ begin assert (select trust_score from profiles where id = '00000000-0000-0000-0000-00000000000a') = 60, 'verified gives +10'; end $$;

-- ===== Listings =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into products (shop_id, title, price_cents, sizes, status) values (my_shop_id(), 'Oversized tee, sand', 34900, '{S,M,L,XL}', 'live');
select pg_temp.expect_error($$insert into products (shop_id, title, price_cents, status) values (my_shop_id(), 'Jordan 4 reps', 90000, 'draft')$$, 'Counterfeit');
select pg_temp.expect_error($$insert into products (shop_id, title, price_cents, label, status) values (my_shop_id(), 'Nike style runner', 40000, 'unbranded_dupe', 'draft')$$, 'brand');
insert into products (shop_id, title, price_cents, label, status) values (my_shop_id(), 'Chunky white runner', 40000, 'unbranded_dupe', 'live');
select pg_temp.expect_error($$insert into products (shop_id, title, price_cents, mode, status) values (my_shop_id(), 'Vintage belt', 25000, 'auction', 'live')$$, 'Auctions unlock');
select pg_temp.expect_error($$insert into products (shop_id, title, price_cents, mode, status) values (my_shop_id(), 'Birthday cake', 65000, 'order_now', 'live')$$, 'Certificate');
select pg_temp.expect_error($$insert into products (shop_id, title, price_cents, label, status) values (my_shop_id(), 'Designer shirt', 120000, 'authentic_designer', 'live')$$, 'proof');
select pg_temp.expect_error($$insert into products (shop_id, title, price_cents, label, status) values (my_shop_id(), 'Old denim jacket', 45000, 'pre_loved', 'draft')$$, 'condition');
select pg_temp.expect_error($$insert into products (shop_id, title, price_cents, proof_status) values (my_shop_id(), 'Designer shirt', 120000, 'approved')$$, 'permission denied');

-- Video stored in Supabase Storage (no Mux), then a post.
insert into media (owner_id, kind, storage_path, status) values (auth.uid(), 'video', '00000000-0000-0000-0000-00000000000a/tee.mp4', 'ready');
select pg_temp.expect_error($$insert into media (owner_id, kind, storage_path, status) values (auth.uid(), 'video', 'elsewhere/x.mp4', 'ready')$$, 'row-level security');
insert into posts (shop_id, product_id, media_id, caption)
  select my_shop_id(), (select id from products where title = 'Oversized tee, sand'), (select id from media limit 1), '3 ways to style one tee';
-- The video editor: two clips (one from the gallery), a text, a tag of your own item, a flaw and a cover.
insert into media (owner_id, kind, storage_path, status) values (auth.uid(), 'video', '00000000-0000-0000-0000-00000000000a/clip2.mp4', 'ready');
select set_post_edit((select id from posts limit 1), jsonb_build_object(
  'clips', jsonb_build_array(
    jsonb_build_object('media', (select id from media where storage_path like '%tee.mp4'), 'start', 1, 'end', 6, 'inApp', true),
    jsonb_build_object('media', (select id from media where storage_path like '%clip2.mp4'), 'start', 0, 'end', 4, 'muted', true)),
  'marks', jsonb_build_array(
    jsonb_build_object('kind', 'text', 'at', 0.5, 'text', '  Size M  ', 'pos', 'top'),
    jsonb_build_object('kind', 'tag', 'at', 0, 'productId', (select id from products where title = 'Oversized tee, sand')),
    jsonb_build_object('kind', 'flaw', 'at', 6, 'text', 'Tiny mark')),
  'cover', 2));
select pg_temp.expect_error($$select set_post_edit((select id from posts limit 1), '{"clips":[{"media":"00000000-0000-0000-0000-000000000000","start":0,"end":3}]}')$$, 'isn''t one of your uploads');
select pg_temp.expect_error($$select set_post_edit((select id from posts limit 1), jsonb_build_object('clips', jsonb_build_array(jsonb_build_object('media', (select id from media where storage_path like '%tee.mp4'), 'start', 1, 'end', 1.5))))$$, 'at least 1 second');
select pg_temp.expect_error($$select set_post_edit((select id from posts limit 1), jsonb_build_object('clips', jsonb_build_array(jsonb_build_object('media', (select id from media where storage_path like '%tee.mp4'), 'start', 0, 'end', 200))))$$, 'up to 3 minutes');
do $$ begin
  assert (select edit->'marks'->0->>'text' from posts limit 1) = 'Size M', 'text trimmed';
  assert (select (edit->>'cover')::numeric from posts limit 1) = 2, 'cover kept';
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select set_post_edit((select id from posts limit 1), '{"clips":[]}')$$, 'Only the seller');
reset role;

-- The feed is public.
select pg_temp.act_as_anon();
do $$ begin
  assert (select count(*) from feed()) = 1, 'feed shows the live post';
  assert (select tier from feed() limit 1) = 'standard', 'tier shown';
  assert (select jsonb_array_length(clips) from feed() limit 1) = 2, 'feed has both clips';
  assert (select clips->1->>'muted' from feed() limit 1) = 'true', 'clip settings kept';
  assert (select count(*) from media where storage_path like '%clip2.mp4') = 1, 'clip videos are public with the post';
end $$;
select pg_temp.expect_error($$select * from orders$$, 'permission denied');
reset role;

-- Another seller cannot post someone else's product.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'seller2@test.co.za');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select start_shop('Other shop', 'other.shop', 'beauty');
update products set price_cents = 100 where title = 'Oversized tee, sand'; -- RLS: matches no rows
do $$ begin
  assert (select count(*) from products where title = 'Oversized tee, sand' and price_cents = 34900) = 1, 'other seller cannot change price';
end $$;
reset role;

-- ===== Orders =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values (auth.uid(), (select id from shops limit 1), (select id from products limit 1), 'buy_now', 100, 'collect_cpt', 0, 0, 100, 0, 100)$$, 'permission denied');
reset role;

select pg_temp.act_as_service();
-- Totals must add up.
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ('00000000-0000-0000-0000-00000000000b', (select id from shops where handle = 'thrift.with.lebo'), (select id from products where title = 'Oversized tee, sand'),
  'buy_now', 35000, 'collect_cpt', 0, 1200, 30000, 2100, 32900)$$, 'check constraint');
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents, size)
  values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', (select id from shops where handle = 'thrift.with.lebo'),
  (select id from products where title = 'Oversized tee, sand'), 'buy_now', 35000, 'collect_cpt', 0, 1200, 36200, 2100, 32900, 'M');
select pg_temp.expect_error($$update orders set status = 'shipped' where id = '10000000-0000-0000-0000-000000000001'$$, 'cannot go from');
update orders set status = 'paid' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$update orders set total_cents = 1, item_price_cents = 1, seller_payout_cents = 1, seller_fee_cents = 0, protection_fee_cents = 0 where id = '10000000-0000-0000-0000-000000000001'$$, 'cannot be changed');
-- No shipping without packing proof, even from the server.
select pg_temp.expect_error($$update orders set status = 'shipped', tracking_ref = 'TCG123' where id = '10000000-0000-0000-0000-000000000001'$$, 'packing video');
select pg_temp.expect_error($$update orders set status = 'shipped', packing_media_id = (select id from media where kind = 'video' limit 1), packing_photo_media_id = (select id from media where kind = 'video' limit 1) where id = '10000000-0000-0000-0000-000000000001'$$, 'packing');
reset role;
select pg_temp.packed('10000000-0000-0000-0000-000000000001');
select pg_temp.act_as_service();
update orders set status = 'shipped', tracking_ref = 'TCG123' where id = '10000000-0000-0000-0000-000000000001';
reset role;
do $$ begin
  assert (select stock from products where title = 'Oversized tee, sand') = 0, 'stock taken on payment';
  assert (select status from products where title = 'Oversized tee, sand') = 'sold_out', 'sold out';
  assert (select ship_by - paid_at from orders where id = '10000000-0000-0000-0000-000000000001') = interval '72 hours', 'ship by 72h';
  assert (select trust_score from profiles where id = '00000000-0000-0000-0000-00000000000a') = 61, 'fast ship with video +1';
  assert (select count(*) from notifications where user_id = '00000000-0000-0000-0000-00000000000b') = 2, 'buyer notified twice';
  assert (select count(*) from order_events where order_id = '10000000-0000-0000-0000-000000000001') = 2, 'events logged';
end $$;

-- Visibility: buyer and seller see the order, others do not.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from orders) = 1, 'buyer sees order'; end $$;
select pg_temp.expect_error($$update orders set status = 'delivered'$$, 'permission denied');
select pg_temp.expect_error($$select request_return('10000000-0000-0000-0000-000000000001', 'changed_mind', 'Too big')$$, 'once the order is delivered');
select confirm_received('10000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select releasable_at - delivered_at from orders) = interval '7 days', 'Buy now window is 7 days';
end $$;
select request_return('10000000-0000-0000-0000-000000000001', 'changed_mind', 'Too big');
do $$ begin assert (select postage_payer from returns) = 'buyer', 'buyer pays postage on change of mind'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
do $$ begin
  assert (select count(*) from orders) = 0, 'others cannot see the order';
  assert (select count(*) from returns) = 0, 'others cannot see returns';
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from orders) = 1, 'seller sees order';
  assert (select count(*) from payouts) = 0, 'no payout yet';
end $$;
reset role;

-- Server refunds after the item comes back.
select pg_temp.act_as_service();
update orders set status = 'return_in_transit' where id = '10000000-0000-0000-0000-000000000001';
update orders set status = 'refunded' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$update orders set status = 'completed' where id = '10000000-0000-0000-0000-000000000001'$$, 'cannot go from');
reset role;

-- A food order cannot be returned for a change of mind.
select pg_temp.act_as_service();
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', (select id from shops where handle = 'thrift.with.lebo'),
  (select id from products where title = 'Chunky white runner'), 'order_now', 40000, 'collect_baker', 0, 1200, 41200, 2400, 37600);
update orders set status = 'paid' where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.packed('10000000-0000-0000-0000-000000000002');
update orders set status = 'shipped' where id = '10000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select confirm_received('10000000-0000-0000-0000-000000000002');
select pg_temp.expect_error($$select request_return('10000000-0000-0000-0000-000000000002', 'changed_mind', '')$$, 'change of mind');
select leave_review('10000000-0000-0000-0000-000000000002', 5, 'Lovely');
reset role;
select pg_temp.act_as_service();
update orders set status = 'completed' where id = '10000000-0000-0000-0000-000000000002';
reset role;
do $$ begin
  -- 61 + 5 star (+1) + kept (+2). No fast shipping point: the same buyer already gave one (once per buyer per 90 days).
  assert (select trust_score from profiles where id = '00000000-0000-0000-0000-00000000000a') = 64, 'review and kept order add points';
  assert (select good_orders(id) from shops where handle = 'thrift.with.lebo') = 1, 'one good order';
end $$;

-- ===== Counterfeit ban =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select admin_remove_product((select id from products where title = 'Chunky white runner'), 'Copied logo on the tongue', true);
reset role;
do $$ begin
  assert (select status from shops where handle = 'thrift.with.lebo') = 'banned', 'shop banned';
  assert (select count(*) from products where status <> 'removed' and shop_id = (select id from shops where handle = 'thrift.with.lebo')) = 0, 'all listings removed';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update products set status = 'live' where title = 'Chunky white runner'; -- banned shop: matches no rows
reset role;
do $$ begin assert (select status from products where title = 'Chunky white runner') = 'removed', 'still removed'; end $$;
-- Reward credit top up: R349 tee, R50 credit, buyer pays R311, we top the seller up R17.06.
select pg_temp.act_as_service();
update seller_checks set bank_status = 'approved' where shop_id = (select id from shops where handle = 'other.shop');
reset role;
-- A buyer with a finished account and an earned reward that is ready (no credit just for signing up).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'credit@test.co.za');
update profiles set handle = 'credit.buyer', adult_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.act_as_service();
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, credit_cents, total_cents, seller_fee_cents, seller_payout_cents, credit_topup_cents)
  values ('00000000-0000-0000-0000-0000000000a1', (select id from shops where handle = 'other.shop'), (select id from products limit 1), 'buy_now', 34900, 'collect_cpt', 0, 1200, 5000, 31100, 2094, 32806, 1706)$$, 'credit');
reset role;
insert into rewards (user_id, kind, amount_cents, status) values ('00000000-0000-0000-0000-0000000000a1', 'first_buy', 5000, 'ready');
select pg_temp.act_as_service();
update seller_checks set bank_status = 'approved' where shop_id = (select id from shops where handle = 'other.shop');
reset role;
select pg_temp.act_as_service();
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, credit_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ('00000000-0000-0000-0000-0000000000a1', (select id from shops where handle = 'other.shop'), (select id from products limit 1), 'buy_now', 34900, 'collect_cpt', 0, 1200, 5000, 31100, 2094, 32806)$$, 'orders_topup_exact');
insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, credit_cents, total_cents, seller_fee_cents, seller_payout_cents, credit_topup_cents)
  values ('00000000-0000-0000-0000-0000000000a1', (select id from shops where handle = 'other.shop'), (select id from products limit 1), 'buy_now', 34900, 'collect_cpt', 0, 1200, 5000, 31100, 2094, 32806, 1706);
reset role;
select 'all policy tests passed' as result;
-- Scheduler secret: only the service role can check it, and only the right value passes.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select cron_secret_ok('guess')$$, 'permission denied');
reset role;
do $$ begin
  assert not cron_secret_ok('guess'), 'wrong secret rejected';
  assert cron_secret_ok((select secret from vault.secrets where name = 'run_due_secret')), 'right secret accepted';
end $$;
select 'scheduler secret tests passed' as result;
-- Likes and reposts: you manage only your own, others see counts only.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into post_reactions (user_id, post_id, kind) select '00000000-0000-0000-0000-00000000000b', id, 'like' from posts limit 1;
insert into post_reactions (user_id, post_id, kind) select '00000000-0000-0000-0000-00000000000b', id, 'repost' from posts limit 1;
select pg_temp.expect_error($$insert into post_reactions (user_id, post_id, kind) select '00000000-0000-0000-0000-00000000000c', id, 'like' from posts limit 1$$, 'row-level security');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from post_reactions) = 2, 'likes and reposts are public';
  assert (select likes from post_counts(array(select id from posts limit 1))) = 1, 'like counted';
  assert (select reposts from post_counts(array(select id from posts limit 1))) = 1, 'repost counted';
end $$;
delete from post_reactions where user_id = '00000000-0000-0000-0000-00000000000b'; -- as someone else: matches no rows
reset role;
do $$ begin assert (select count(*) from post_reactions) = 2, 'others cannot remove your likes'; end $$;
select 'like and repost tests passed' as result;
-- Extra listing photos: only the seller adds them, inside their own folder, and anyone sees them on live items.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into listing_photos (product_id, storage_path, position)
  select id, '00000000-0000-0000-0000-00000000000a/tee-2.jpg', 1 from products where title = 'Oversized tee, sand';
select pg_temp.expect_error($$insert into listing_photos (product_id, storage_path) select id, 'someone-else/x.jpg' from products where title = 'Oversized tee, sand'$$, 'row-level security');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$insert into listing_photos (product_id, storage_path) select id, '00000000-0000-0000-0000-00000000000c/x.jpg' from products where title = 'Oversized tee, sand'$$, 'row-level security');
reset role;
select pg_temp.act_as_anon();
do $$ begin assert (select count(*) from listing_photos) = 0, 'the tee is sold out by now, so its photos are hidden'; end $$;
reset role;
set session_replication_role = replica; -- skip the guard triggers just for this test setup
update products set status = 'live', stock = 1 where title = 'Oversized tee, sand';
set session_replication_role = default;
select pg_temp.act_as_anon();
do $$ begin assert (select count(*) from listing_photos) = 1, 'photos of live items are public'; end $$;
reset role;
select 'listing photo tests passed' as result;
-- ===== Comments, messages, blocks, reports, delete account =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into comments (post_id, user_id, body) select id, '00000000-0000-0000-0000-00000000000b', 'Is it still available?' from posts limit 1;
select pg_temp.expect_error($$insert into comments (post_id, user_id, body) select id, '00000000-0000-0000-0000-00000000000b', 'you bitch' from posts limit 1$$, 'friendly');
select pg_temp.expect_error($$insert into comments (post_id, user_id, body) select id, '00000000-0000-0000-0000-00000000000d', 'pretending' from posts limit 1$$, 'row-level security');
reset role;
do $$ begin assert (select count(*) from notifications where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'comment') = 1, 'seller told about the comment'; end $$;
select pg_temp.act_as_anon();
do $$ begin assert (select count(*) from post_comments((select id from posts limit 1))) = 1, 'comments are public'; end $$;
reset role;

-- Messages: buyer b and Other shop (owner e). Nobody else can read them.
update shops set status = 'open' where handle = 'other.shop'; -- test setup: the shop is open
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into conversations (buyer_id, shop_id) select '00000000-0000-0000-0000-00000000000b', id from shops where handle = 'other.shop';
insert into messages (conversation_id, sender_id, body) select id, '00000000-0000-0000-0000-00000000000b', 'Hi, what sizes do you have?' from conversations;
select pg_temp.expect_error($$insert into messages (conversation_id, sender_id, body, product_id) select c.id, '00000000-0000-0000-0000-00000000000b', 'About this', (select id from products where title = 'Oversized tee, sand') from conversations c$$, 'different shop');
reset role;
do $$ begin assert (select count(*) from notifications where user_id = '00000000-0000-0000-0000-00000000000e' and kind = 'message') = 1, 'shop told about the message'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from messages) = 0, 'others cannot read the chat'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
insert into messages (conversation_id, sender_id, body) select id, '00000000-0000-0000-0000-00000000000e', 'S to XL' from conversations;
update messages set read_at = now() where sender_id = '00000000-0000-0000-0000-00000000000b';
do $$ begin assert (select unread from my_conversations() limit 1) = 0, 'read'; end $$;
reset role;

-- Block: b blocks e, then nobody can message, and the chat disappears.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$insert into messages (conversation_id, sender_id, body) select id, '00000000-0000-0000-0000-00000000000b', 'hello?' from conversations$$, 'row-level security');
do $$ begin
  assert (select count(*) from my_conversations()) = 0, 'blocked chats are hidden';
  assert (select count(*) from my_blocks()) = 1, 'blocked list';
end $$;
reset role;

-- Reports: only the reporter and our team see them; the team can remove the post.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into reports (reporter_id, target_kind, target_id, reason) select '00000000-0000-0000-0000-00000000000b', 'post', id, 'counterfeit' from posts limit 1;
select pg_temp.expect_error($$select admin_handle_report((select id from reports limit 1), 'remove')$$, 'Only our team');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
do $$ begin assert (select count(*) from reports) = 0, 'reports are private'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select admin_handle_report((select id from reports limit 1), 'remove');
reset role;
do $$ begin assert (select status from posts limit 1) = 'removed', 'reported post removed'; end $$;

-- Delete my account: the person is removed, records the law needs stay.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select forget_user('00000000-0000-0000-0000-00000000000b')$$, 'permission denied');
reset role;
select forget_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select display_name from profiles where id = '00000000-0000-0000-0000-00000000000b') = 'Deleted user', 'name removed';
  assert (select count(*) from comments where user_id = '00000000-0000-0000-0000-00000000000b') = 0, 'comments removed';
  assert (select count(*) from conversations) = 0, 'chats removed';
  assert (select count(*) from orders where buyer_id = '00000000-0000-0000-0000-00000000000b') > 0, 'orders kept for the records';
end $$;
select 'safety, comment and message tests passed' as result;
-- ===== Offers, holds, photos and reply time in chats =====
set session_replication_role = replica; -- test setup: a live item in Other shop (owner e)
insert into products (shop_id, title, price_cents, sizes, status, stock)
  values ((select id from shops where handle = 'other.shop'), 'Satin scarf', 20000, '{}', 'live', 3);
set session_replication_role = default;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into conversations (buyer_id, shop_id) select '00000000-0000-0000-0000-00000000000d', id from shops where handle = 'other.shop';
insert into messages (conversation_id, sender_id, body) select id, '00000000-0000-0000-0000-00000000000d', 'Can you do a better price?' from conversations;
select pg_temp.expect_error($$select make_offer((select id from conversations limit 1), array[(select id from products where title = 'Satin scarf')], 15000)$$, 'Only the shop');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$select make_offer((select id from conversations limit 1), array[(select id from products where title = 'Satin scarf')], 30000)$$, 'more than the listed price');
select make_offer((select id from conversations limit 1), array[(select id from products where title = 'Satin scarf')], 15000);
insert into messages (conversation_id, sender_id, body, offer_id) select c.id, '00000000-0000-0000-0000-00000000000e', '', o.id from conversations c, offers o;
select hold_product((select id from products where title = 'Satin scarf'), '00000000-0000-0000-0000-00000000000d', 6);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$insert into messages (conversation_id, sender_id, body, offer_id) select c.id, '00000000-0000-0000-0000-00000000000d', '', o.id from conversations c, offers o$$, 'row-level security');
select pg_temp.expect_error($$select hold_product((select id from products where title = 'Satin scarf'), '00000000-0000-0000-0000-00000000000d', 6)$$, 'Only the seller');
do $$ begin
  assert (select count(*) from offers) = 1, 'buyer sees the offer';
  assert (select held_for from products where title = 'Satin scarf') = '00000000-0000-0000-0000-00000000000d', 'held for the buyer';
  assert shop_reply_minutes((select id from shops where handle = 'other.shop')) is not null, 'reply time works';
end $$;
reset role;
-- Buyer offers: the buyer offers, the seller answers. Limits: R50, under the listed price, at least half, one waiting per item.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select buyer_offer((select id from conversations limit 1), (select id from products where title = 'Satin scarf'), 4000)$$, 'start at R50');
select pg_temp.expect_error($$select buyer_offer((select id from conversations limit 1), (select id from products where title = 'Satin scarf'), 20000)$$, 'less than the listed price');
select pg_temp.expect_error($$select buyer_offer((select id from conversations limit 1), (select id from products where title = 'Satin scarf'), 9000)$$, 'less than half');
select buyer_offer((select id from conversations limit 1), (select id from products where title = 'Satin scarf'), 16000);
select pg_temp.expect_error($$select buyer_offer((select id from conversations limit 1), (select id from products where title = 'Satin scarf'), 17000)$$, 'already have an offer waiting');
insert into messages (conversation_id, sender_id, body, offer_id) select c.id, '00000000-0000-0000-0000-00000000000d', '', o.id from conversations c, offers o where o.made_by = 'buyer';
select pg_temp.expect_error($$select answer_offer((select id from offers where made_by = 'buyer'), true)$$, 'Only the seller');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$select buyer_offer((select id from conversations limit 1), (select id from products where title = 'Satin scarf'), 16000)$$, 'Only the buyer');
select answer_offer((select id from offers where made_by = 'buyer'), true);
select pg_temp.expect_error($$select answer_offer((select id from offers where made_by = 'buyer'), false)$$, 'already been answered');
select pg_temp.expect_error($$select make_offer((select id from conversations limit 1), array[(select id from products where title = 'Satin scarf')], 4000)$$, 'start at R50');
do $$ begin assert (select status from offers where made_by = 'buyer') = 'open', 'accepted offer can be paid'; end $$;
reset role;
do $$ begin assert (select count(*) from notifications where kind = 'offer') >= 2, 'both sides told'; end $$;
reset role;
select 'offer, hold and reply time tests passed' as result;
-- Device tokens: your own only; removed when the account is deleted.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into device_tokens (token, user_id, platform) values ('tok-d', '00000000-0000-0000-0000-00000000000d', 'ios');
select pg_temp.expect_error($$insert into device_tokens (token, user_id, platform) values ('tok-x', '00000000-0000-0000-0000-00000000000e', 'ios')$$, 'row-level security');
reset role;
select forget_user('00000000-0000-0000-0000-00000000000d');
do $$ begin assert (select count(*) from device_tokens where user_id = '00000000-0000-0000-0000-00000000000d') = 0, 'devices forgotten'; end $$;
select 'device token tests passed' as result;
-- Saved delivery details: only your own; error reports: anyone sends, only the team reads.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
insert into delivery_details (user_id, delivery, name, phone, address) values ('00000000-0000-0000-0000-00000000000e', 'courier', 'Ayesha', '0821234567', '1 Main Road');
select pg_temp.expect_error($$insert into delivery_details (user_id, name) values ('00000000-0000-0000-0000-00000000000a', 'Someone')$$, 'row-level security');
update profiles set interests = array['beauty', 'food'] where id = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect_error($$update profiles set interests = array['cars'] where id = '00000000-0000-0000-0000-00000000000e'$$, 'check');
insert into app_errors (message, path) values ('Test error', '/');
do $$ begin assert (select count(*) from app_errors) = 0, 'normal users cannot read error reports'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from delivery_details) = 0, 'others cannot see delivery details'; end $$;
reset role;
select pg_temp.act_as_anon();
insert into app_errors (message, path) values ('Signed out error', '/');
reset role;
select forget_user('00000000-0000-0000-0000-00000000000e');
do $$ begin
  assert (select count(*) from delivery_details where user_id = '00000000-0000-0000-0000-00000000000e') = 0, 'delivery details forgotten';
  assert (select cardinality(interests) from profiles where id = '00000000-0000-0000-0000-00000000000e') = 0, 'interests forgotten';
  assert (select count(*) from app_errors) = 2, 'error reports saved';
end $$;
select 'delivery, interests and error report tests passed' as result;
-- Link previews only show items on sale from open shops.
select pg_temp.act_as_anon();
do $$ begin
  assert (select count(*) from share_card((select id from products where title = 'Satin scarf'))) = 0, 'no card once the shop is paused (account deleted above)';
  assert (select count(*) from share_card('00000000-0000-0000-0000-000000000000')) = 0, 'no card for a missing item';
end $$;
reset role;
update shops set status = 'open' where handle = 'other.shop';
update products set status = 'live' where title = 'Satin scarf';
select pg_temp.act_as_anon();
do $$ begin assert (select count(*) from share_card((select id from products where title = 'Satin scarf'))) = 1, 'share card for a live item'; end $$;
reset role;
select 'share card tests passed' as result;
-- Accounts: unique usernames shared with shop handles, change limits, age and terms, photos in your own folder.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select complete_account('Thandi', 'thandi.m', false, true)$$, '18 or older');
select pg_temp.expect_error($$select complete_account('Thandi', 'thandi.m', true, false)$$, 'accept the terms');
select pg_temp.expect_error($$select set_username('Ab')$$, 'at least 3');
select pg_temp.expect_error($$select set_username('.thandi')$$, 'start or end');
select pg_temp.expect_error($$select set_username('thandi..m')$$, 'two dots');
select pg_temp.expect_error($$select set_username('support')$$, 'reserved');
select pg_temp.expect_error($$select set_username('other.shop')$$, 'taken');
select complete_account('Thandi M', 'Thandi.M', true, true);
do $$ begin
  assert (select handle from profiles where id = '00000000-0000-0000-0000-00000000000d') = 'thandi.m', 'username saved in lowercase';
  assert (select adult_confirmed_at is not null and terms_accepted_at is not null from profiles where id = '00000000-0000-0000-0000-00000000000d'), 'age and terms saved';
  assert available_handles(array['thandi.m', 'thandi.m2', 'support', 'other.shop']) = array['thandi.m', 'thandi.m2'], 'your own and free usernames come back';
end $$;
select set_username('thandi.new'); -- the first change after signing up is allowed
select pg_temp.expect_error($$select set_username('thandi.again')$$, 'change your username again');
select pg_temp.expect_error($$update profiles set handle = 'sneaky' where id = '00000000-0000-0000-0000-00000000000d'$$, 'permission denied');
select pg_temp.expect_error($$update profiles set avatar_path = '00000000-0000-0000-0000-00000000000a/me.jpg' where id = '00000000-0000-0000-0000-00000000000d'$$, 'avatar_in_own_folder');
update profiles set avatar_path = '00000000-0000-0000-0000-00000000000d/me.jpg' where id = '00000000-0000-0000-0000-00000000000d';
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select set_username('thandi.new')$$, 'taken');
reset role;
select pg_temp.act_as_anon();
do $$ begin assert (select avatar_path from people_cards(array['00000000-0000-0000-0000-00000000000d'::uuid])) like '%me.jpg', 'photos are public'; end $$;
reset role;
select 'account tests passed' as result;
-- ===== Auctions =====
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'bidder1@test.co.za'), ('00000000-0000-0000-0000-0000000000f2', 'bidder2@test.co.za');
select pg_temp.act_as_service();
update shops set status = 'open' where handle = 'thrift.with.lebo'; -- test setup: reopen the shop banned above
select pg_temp.act_as_service();
insert into products (shop_id, title, price_cents, sizes, status, stock, mode, reserve_cents, auction_ends_at, auction_state)
  values ((select id from shops where handle = 'thrift.with.lebo'), 'Vintage leather jacket', 20000, '{}', 'live', 1, 'auction', 30000, now() + interval '1 day', 'open'),
         ((select id from shops where handle = 'thrift.with.lebo'), 'Retro sunglasses', 5000, '{}', 'live', 1, 'auction', null, now() + interval '1 day', 'open');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect_error($$select place_bid((select id from products where title = 'Vintage leather jacket'), 20000)$$, 'Finish setting up');
select complete_account('Bidder One', 'bidder.one', true, true);
select pg_temp.expect_error($$select place_bid((select id from products where title = 'Vintage leather jacket'), 15000)$$, 'lowest bid now is R200');
select place_bid((select id from products where title = 'Vintage leather jacket'), 20000);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select complete_account('Bidder Two', 'bidder.two', true, true);
select pg_temp.expect_error($$select place_bid((select id from products where title = 'Vintage leather jacket'), 20500)$$, 'lowest bid now is R210');
select place_bid((select id from products where title = 'Vintage leather jacket'), 21000);
do $$ declare i jsonb := auction_info((select id from products where title = 'Vintage leather jacket')); begin
  assert (i->>'currentCents')::int = 21000 and (i->>'bidCount')::int = 2, 'two bids, top R210';
  assert (i->>'minNextCents')::int = 22000, 'next bid is R220 (R10 steps under R500)';
  assert (i->>'leaderIsMe')::boolean and not (i->>'reserveMet')::boolean, 'leader is me, reserve not met';
  assert i->'recent'->1->>'who' = 'b***e', 'other bidders are masked';
end $$;
reset role;
do $$ begin assert exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000f1' and title = 'You''ve been outbid'), 'outbid notice'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select place_bid((select id from products where title = 'Vintage leather jacket'), 50000)$$, 'own item');
select pg_temp.expect_error($$update products set reserve_cents = 25000 where title = 'Vintage leather jacket'$$, 'once people have bid');
reset role;
-- No sniping: a bid in the last 2 minutes adds 2 minutes.
select pg_temp.act_as_service();
update products set auction_ends_at = now() + interval '30 seconds' where title = 'Vintage leather jacket';
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select place_bid((select id from products where title = 'Vintage leather jacket'), 22000);
reset role;
do $$ begin assert (select auction_ends_at from products where title = 'Vintage leather jacket') > now() + interval '100 seconds', 'late bid extends the end'; end $$;
-- Max bids: many maxes on one item, settled fairly in one go.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f3', 'bidder3@test.co.za');
select pg_temp.act_as_service();
insert into products (shop_id, title, price_cents, sizes, status, stock, mode, auction_ends_at, auction_state)
  values ((select id from shops where handle = 'thrift.with.lebo'), 'Max bid denim', 70000, '{}', 'live', 1, 'auction', now() + interval '1 day', 'open');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select place_bid((select id from products where title = 'Max bid denim'), 90000, true);
do $$ declare i jsonb := auction_info((select id from products where title = 'Max bid denim')); begin
  assert (i->>'currentCents')::int = 70000 and (i->>'myMaxCents')::int = 90000 and (i->>'leaderIsMe')::boolean, 'a max bids only the lowest amount';
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select place_bid((select id from products where title = 'Max bid denim'), 72000);
do $$ declare i jsonb := auction_info((select id from products where title = 'Max bid denim')); begin
  assert (i->>'currentCents')::int = 74000 and not (i->>'leaderIsMe')::boolean, 'the max answers one step higher';
  assert i->>'myMaxCents' is null, 'no max of my own';
end $$;
do $$ begin assert (select count(*) from max_bids) = 0, 'other people''s maxes are secret'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f3');
select complete_account('Bidder Three', 'bidder.three', true, true);
select place_bid((select id from products where title = 'Max bid denim'), 120000, true);
do $$ declare i jsonb := auction_info((select id from products where title = 'Max bid denim')); begin
  assert (i->>'currentCents')::int = 92000 and (i->>'leaderIsMe')::boolean, 'the higher max leads at one step over the other max';
  assert (i->'recent'->1->>'amountCents')::int = 90000, 'the beaten max shows as a bid at that max';
end $$;
reset role;
do $$ begin assert exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000f1' and title = 'You''ve been outbid' and body like '%R920%'), 'the beaten max is told'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect_error($$select place_bid((select id from products where title = 'Max bid denim'), 80000, true)$$, 'Your max is already R900');
-- An equal max set later loses to the one set first, at that max.
select place_bid((select id from products where title = 'Max bid denim'), 120000, true);
do $$ declare i jsonb := auction_info((select id from products where title = 'Max bid denim')); begin
  assert (i->>'currentCents')::int = 120000 and not (i->>'leaderIsMe')::boolean, 'equal max: first one set wins';
end $$;
reset role;
do $$ begin assert (select count(*) from bids where product_id = (select id from products where title = 'Max bid denim')) <= 8, 'settled in a few bids, not a flood'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f3');
do $$ begin assert (auction_info((select id from products where title = 'Max bid denim'))->>'leaderIsMe')::boolean, 'the first max is on top'; end $$;
select pg_temp.expect_error($$select run_max_bids((select id from products where title = 'Max bid denim'), 0)$$, 'permission denied');
reset role;
-- Ends below the reserve: not sold, back to the seller's drafts.
select pg_temp.act_as_service();
update products set auction_ends_at = now() - interval '1 second' where title = 'Vintage leather jacket';
reset role;
select pg_temp.act_as_anon();
select settle_auction((select id from products where title = 'Vintage leather jacket'));
reset role;
do $$ begin assert (select auction_state = 'unsold' and status = 'draft' from products where title = 'Vintage leather jacket'), 'reserve not met: unsold'; end $$;
-- No reserve: the top bid wins and has 2 hours to pay; if not paid, trust points are lost.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select place_bid((select id from products where title = 'Retro sunglasses'), 5000);
reset role;
select pg_temp.act_as_service();
update products set auction_ends_at = now() - interval '1 second' where title = 'Retro sunglasses';
select settle_due_auctions();
reset role;
do $$ begin
  assert (select auction_state = 'won' and status = 'sold_out' and auction_winner = '00000000-0000-0000-0000-0000000000f2' and auction_price_cents = 5000
          from products where title = 'Retro sunglasses'), 'top bid wins';
  assert exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000f2' and title like 'You won%'), 'winner told';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect_error($$select place_bid((select id from products where title = 'Retro sunglasses'), 9000)$$, 'ended');
reset role;
select pg_temp.act_as_service();
update products set auction_pay_by = now() - interval '1 second' where title = 'Retro sunglasses';
select settle_due_auctions();
reset role;
do $$ begin
  assert (select auction_state = 'unpaid' and status = 'draft' from products where title = 'Retro sunglasses'), 'unpaid win goes back to the seller';
  assert exists (select 1 from trust_events where user_id = '00000000-0000-0000-0000-0000000000f2' and kind = 'unpaid_auction_win'), 'unpaid win costs trust';
end $$;
select 'auction tests passed' as result;

-- ===== Team dashboard =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select admin_overview()$$, 'team');
select pg_temp.expect_error($$select admin_people('', 'all', 10, 0)$$, 'team');
select pg_temp.expect_error($$select admin_suspend('00000000-0000-0000-0000-00000000000d', 'Spam')$$, 'team');
select pg_temp.expect_error($$select admin_set_role('00000000-0000-0000-0000-00000000000b', 'admin')$$, 'team');
do $$ begin assert (select count(*) from admin_actions) = 0, 'action log is team only'; end $$;
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
do $$ declare o jsonb := admin_overview(); begin
  assert (o ->> 'people')::int >= 4, 'overview counts people';
  assert jsonb_array_length(o -> 'daily') = 14, 'overview has 14 days';
end $$;
do $$ begin
  assert (select count(*) from admin_people('buyer@test', 'all', 10, 0)) = 1, 'search by email';
  assert (select x ->> 'email' from admin_people('buyer@test', 'all', 10, 0) x) = 'buyer@test.co.za', 'team sees the email';
  assert (select count(*) from admin_people('', 'team', 10, 0)) = 1, 'team filter';
  assert (select count(*) from admin_people('', 'sellers', 50, 0)) >= 1, 'sellers filter';
  assert (admin_person('00000000-0000-0000-0000-00000000000a') ->> 'shop') is not null, 'person shows their shop';
  assert jsonb_typeof(admin_person('00000000-0000-0000-0000-00000000000b') -> 'orders') = 'array', 'person shows orders';
  assert (select count(*) from admin_orders('', 'all', 50, 0)) >= 0, 'orders list runs';
  assert (select count(*) from admin_listings('', 'live', 50, 0)) >= 0, 'listings list runs';
end $$;
select pg_temp.expect_error($$select admin_suspend('00000000-0000-0000-0000-00000000000c', 'Test')$$, 'your own');
select pg_temp.expect_error($$select admin_suspend('00000000-0000-0000-0000-00000000000d', '  ')$$, 'reason');
select pg_temp.expect_error($$select admin_set_role('00000000-0000-0000-0000-00000000000c', 'user')$$, 'someone else');
select admin_suspend('00000000-0000-0000-0000-00000000000d', 'Spam in comments.');
select pg_temp.expect_error($$select admin_suspend('00000000-0000-0000-0000-00000000000d', 'Again')$$, 'already');
reset role;

-- A suspended person can't comment, start chats or bid, and only they (and the team) see why.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$insert into comments (post_id, user_id, body) values (gen_random_uuid(), auth.uid(), 'hello')$$, 'suspended');
select pg_temp.expect_error($$insert into conversations (buyer_id, shop_id) values (auth.uid(), gen_random_uuid())$$, 'suspended');
do $$ begin
  assert (select reason from suspensions) = 'Spam in comments.', 'you see your own suspension';
  assert exists (select 1 from notifications where title = 'Your account is suspended'), 'told about the suspension';
end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from suspensions) = 0, 'others can''t see suspensions'; end $$;
select pg_temp.expect_error($$select admin_suspend('00000000-0000-0000-0000-00000000000c', 'x')$$, 'team');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select admin_set_role('00000000-0000-0000-0000-00000000000d', 'admin')$$, 'suspension');
select admin_unsuspend('00000000-0000-0000-0000-00000000000d');
select admin_set_role('00000000-0000-0000-0000-00000000000d', 'admin');
select admin_set_role('00000000-0000-0000-0000-00000000000d', 'user');
-- Shops: pause needs a reason; opening needs approved checks.
select pg_temp.expect_error($$select admin_set_shop_status((select id from shops where handle = 'thrift.with.lebo'), 'paused', '')$$, 'reason');
select admin_set_shop_status((select id from shops where handle = 'thrift.with.lebo'), 'paused', 'Checking a report.');
select admin_set_shop_status((select id from shops where handle = 'thrift.with.lebo'), 'open', null);
do $$ begin
  assert (select status from shops where handle = 'thrift.with.lebo') = 'open', 'shop reopened';
  assert (select count(*) from admin_log(100) x where x ->> 'action' in ('Suspended account', 'Lifted suspension', 'Added to the team', 'Removed from the team', 'Paused shop', 'Opened shop')) = 6, 'team actions are logged';
  assert exists (select 1 from admin_log(100) x where x ->> 'action' = 'Approved ID check'), 'existing check approvals are logged';
  assert (select x ->> 'by' from admin_log(1) x) is not null, 'log says who did it';
end $$;
reset role;
select 'team dashboard tests passed' as result;

-- ===== Security hardening (docs/SECURITY.md) =====
-- 1.2 One welcome credit per person, even with several checkouts open at once.
select pg_temp.act_as_service();
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, credit_cents, total_cents, seller_fee_cents, seller_payout_cents, credit_topup_cents)
  values ('00000000-0000-0000-0000-0000000000a1', (select id from shops where handle = 'other.shop'), (select id from products limit 1), 'buy_now', 34900, 'collect_cpt', 0, 1200, 5000, 31100, 2094, 32806, 1706)$$, 'credit');
-- 1.4 A buyer without a finished account can't use it.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'fresh@test.co.za');
select pg_temp.act_as_service();
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, credit_cents, total_cents, seller_fee_cents, seller_payout_cents, credit_topup_cents)
  values ('00000000-0000-0000-0000-0000000000a2', (select id from shops where handle = 'other.shop'), (select id from products limit 1), 'buy_now', 34900, 'collect_cpt', 0, 1200, 5000, 31100, 2094, 32806, 1706)$$, 'credit');
-- 1.5 Nobody buys from their own shop, even through the server.
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ((select owner_id from shops where handle = 'other.shop'), (select id from shops where handle = 'other.shop'), (select id from products limit 1), 'buy_now', 35000, 'collect_cpt', 0, 1200, 36200, 2100, 32900)$$, 'your own');
-- Order amounts can't change once made.
select pg_temp.expect_error($$update orders set credit_cents = 0, total_cents = 36100 where buyer_id = '00000000-0000-0000-0000-0000000000a1'$$, 'cannot be changed');
-- 1.3 Surprise rewards: nothing for signing up; R50 when an order is delivered; usable once the return window closes;
-- none when the budget is used up; a reward used on a cancelled order comes back.
reset role;
update profiles set handle = 'fresh.buyer', adult_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000a2';
do $$ begin assert not welcome_credit_ok('00000000-0000-0000-0000-0000000000a2', (select id from shops where handle = 'other.shop')), 'no credit just for signing up'; end $$;
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  select ('30000000-0000-0000-0000-00000000000' || i)::uuid, '00000000-0000-0000-0000-0000000000a2', (select id from shops where handle = 'other.shop'),
    (select id from products limit 1), 'buy_now', 35000, 'courier', 0, 1200, 36200, 2100, 32900 from generate_series(1, 2) i;
create function pg_temp.deliver(o uuid) returns void language plpgsql as $$
begin
  update orders set status = 'paid' where id = o;
  perform pg_temp.packed(o);
  update orders set status = 'shipped', tracking_ref = 'TCG' || left(o::text, 6) where id = o;
  update orders set status = 'delivered' where id = o;
end $$;
-- Budget nearly used: the first delivery gives nothing (silently).
update app_limits set value = (select coalesce(sum(amount_cents), 0) from rewards where status <> 'forfeited') + 4000 where key = 'welcome_credit_budget_cents';
select pg_temp.deliver('30000000-0000-0000-0000-000000000001');
do $$ begin assert not exists (select 1 from rewards where user_id = '00000000-0000-0000-0000-0000000000a2'), 'no reward past the budget'; end $$;
update app_limits set value = 1500000 where key = 'welcome_credit_budget_cents';
select pg_temp.deliver('30000000-0000-0000-0000-000000000002');
do $$ begin
  assert (select status from rewards where user_id = '00000000-0000-0000-0000-0000000000a2' and kind = 'first_buy') = 'pending', 'surprise on delivery, not usable yet';
  assert exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000a2' and title = 'Surprise! You earned R50'), 'buyer is surprised';
  assert exists (select 1 from rewards where user_id = (select owner_id from shops where handle = 'other.shop') and kind = 'first_sale'), 'seller gets one for a first sale';
  assert not welcome_credit_ok('00000000-0000-0000-0000-0000000000a2', (select id from shops where handle = 'other.shop')), 'not before the return window closes';
end $$;
update orders set status = 'completed' where id = '30000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select status from rewards where user_id = '00000000-0000-0000-0000-0000000000a2' and kind = 'first_buy') = 'ready', 'ready after the window';
  assert welcome_credit_ok('00000000-0000-0000-0000-0000000000a2', (select id from shops where handle = 'other.shop')), 'credit ok now';
end $$;
-- Collections earn nothing (easy to fake between friends); only courier orders with tracking do.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a3', 'collect@test.co.za');
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ('30000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a3', (select id from shops where handle = 'other.shop'), (select id from products limit 1), 'buy_now', 35000, 'collect_cpt', 0, 1200, 36200, 2100, 32900);
update orders set status = 'paid' where id = '30000000-0000-0000-0000-000000000009';
select pg_temp.packed('30000000-0000-0000-0000-000000000009');
update orders set status = 'shipped' where id = '30000000-0000-0000-0000-000000000009';
update orders set status = 'delivered' where id = '30000000-0000-0000-0000-000000000009';
do $$ begin assert not exists (select 1 from rewards where user_id = '00000000-0000-0000-0000-0000000000a3'), 'collections earn no reward'; end $$;
-- Using it on an order that's then cancelled gives it back.
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, credit_cents, total_cents, seller_fee_cents, seller_payout_cents, credit_topup_cents)
  values ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2', (select id from shops where handle = 'other.shop'), (select id from products limit 1), 'buy_now', 34900, 'collect_cpt', 0, 1200, 5000, 31100, 2094, 32806, 1706);
do $$ begin assert (select status from rewards where user_id = '00000000-0000-0000-0000-0000000000a2' and kind = 'first_buy') = 'used', 'used on the order'; end $$;
update orders set status = 'cancelled' where id = '30000000-0000-0000-0000-000000000003';
do $$ begin assert (select status from rewards where user_id = '00000000-0000-0000-0000-0000000000a2' and kind = 'first_buy') = 'ready', 'back after cancelling'; end $$;
-- People only see their own rewards.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from rewards where user_id = '00000000-0000-0000-0000-0000000000a2') = 0, 'rewards are private'; end $$;
select pg_temp.expect_error($$update rewards set status = 'ready'$$, 'permission denied');
reset role;
select pg_temp.act_as_service();
-- 1.9 Changing a bank account needs our team again.
update seller_checks set escrow_token = 'tok_first', bank_status = 'approved' where shop_id = (select id from shops where handle = 'other.shop');
update seller_checks set escrow_token = 'tok_changed', bank_status = 'approved' where shop_id = (select id from shops where handle = 'other.shop');
do $$ begin assert (select bank_status from seller_checks where shop_id = (select id from shops where handle = 'other.shop')) = 'pending', 'bank change waits for the team'; end $$;
reset role;
-- 2.2 to 2.6 Rights.
select pg_temp.act_as_anon();
select pg_temp.expect_error($$delete from reserved_handles$$, 'permission denied');
select pg_temp.expect_error($$insert into comments (post_id, user_id, body) values (gen_random_uuid(), gen_random_uuid(), 'x')$$, 'permission denied');
select pg_temp.expect_error($$select place_bid(gen_random_uuid(), 100)$$, 'permission denied');
select pg_temp.expect_error($$select prune_app_errors()$$, 'permission denied');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$update messages set body = 'fake'$$, 'permission denied');
select pg_temp.expect_error($$truncate bids$$, 'permission denied');
select pg_temp.expect_error($$select * from app_limits$$, 'permission denied');
select pg_temp.expect_error($$select take_usage(auth.uid(), 'x', 100, '1 day')$$, 'permission denied');
select pg_temp.expect_error($$select admin_topups()$$, 'team');
do $$ begin assert (select count(*) from reserved_handles) >= 0; exception when insufficient_privilege then null; end $$;
-- 7.1 Flood limits: at most 20 reports a day.
select pg_temp.expect_error($q$do $x$ begin for i in 1..21 loop insert into reports (reporter_id, target_kind, target_id, reason) values (auth.uid(), 'user', gen_random_uuid(), 'spam'); end loop; end $x$$q$, 'slow down');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
do $$ begin assert (select count(*) from admin_topups()) >= 0, 'team sees top ups'; end $$;
reset role;
-- 6.3 Paid service limits.
select pg_temp.act_as_service();
do $$ begin
  assert take_usage('00000000-0000-0000-0000-00000000000b', 'suggest', 2, '1 day') and take_usage('00000000-0000-0000-0000-00000000000b', 'suggest', 2, '1 day'), 'two allowed';
  assert not take_usage('00000000-0000-0000-0000-00000000000b', 'suggest', 2, '1 day'), 'third refused';
end $$;
reset role;
select 'security tests passed' as result;

-- ===== Team alerts and AI reviews =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into reports (reporter_id, target_kind, target_id, reason) values (auth.uid(), 'user', '00000000-0000-0000-0000-00000000000b', 'scam');
reset role;
select pg_temp.act_as_service();
do $$ declare first int; again int; begin
  first := check_alerts();
  again := check_alerts();
  assert first >= 1, 'alerts raised';
  assert again = 0, 'each alert only once';
end $$;
reset role;
do $$ begin assert exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-00000000000c' and title like 'New report%'), 'team told in the app'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from team_alerts) = 0, 'alerts are team only'; end $$;
select pg_temp.expect_error($$select check_alerts()$$, 'permission denied');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
do $$ begin assert (select count(*) from team_alerts where kind = 'report') >= 1, 'team sees alerts'; end $$;
update team_alerts set seen_at = now() where kind = 'report';
select pg_temp.expect_error($$update team_alerts set title = 'x'$$, 'permission denied');
reset role;
select 'alert tests passed' as result;

-- ===== Per account feature switches =====
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select admin_set_feature('00000000-0000-0000-0000-00000000000b', 'buy', 'on', 'x')$$, 'team');
select pg_temp.expect_error($$insert into account_features (user_id, feature, state, reason) values (auth.uid(), 'auctions', 'on', 'me')$$, 'permission denied');
reset role;
select pg_temp.act_as_anon();
create temp table feed_before as select count(*) n from feed(50, 0) where shop_handle = 'thrift.with.lebo';
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
-- Legal checks can't be skipped.
select pg_temp.expect_error($$select admin_set_feature('00000000-0000-0000-0000-00000000000a', 'sell', 'on', 'friend')$$, 'only be turned off');
select pg_temp.expect_error($$select admin_set_feature('00000000-0000-0000-0000-00000000000a', 'auctions', 'on', '')$$, 'reason');
select admin_set_feature('00000000-0000-0000-0000-00000000000a', 'auctions', 'on', 'Founding seller, early auctions');
select admin_set_feature('00000000-0000-0000-0000-00000000000a', 'in_feed', 'off', 'Checking a report');
select admin_set_feature('00000000-0000-0000-0000-00000000000b', 'comment', 'off', 'Spam comments');
select admin_set_feature('00000000-0000-0000-0000-0000000000a2', 'welcome_credit', 'off', 'Second account');
do $$ declare f jsonb := admin_features('00000000-0000-0000-0000-00000000000a'); begin
  assert f -> 'auctions' ->> 'state' = 'on' and f -> 'auctions' ->> 'reason' like 'Founding%', 'team sees the switch and why';
  assert f -> 'buy' ->> 'state' = 'auto', 'unset means auto';
  assert exists (select 1 from admin_log(20) x where x ->> 'action' = 'Auctions: turned on'), 'switches are logged';
end $$;
reset role;
-- On: the 5 good orders milestone is skipped.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into products (shop_id, title, price_cents, sizes, status, stock, mode, auction_ends_at) values (my_shop_id(), 'Early auction belt', 25000, '{}', 'live', 1, 'auction', now() + interval '1 day');
reset role;
-- Off: hidden from the feed.
select pg_temp.act_as_anon();
do $$ begin assert (select count(*) from feed(50, 0) where shop_handle = 'thrift.with.lebo') = 0, 'hidden from the feed'; end $$;
reset role;
-- Off: the action is refused, and the person only sees the state, not the reason.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into comments (post_id, user_id, body) values ((select id from posts limit 1), auth.uid(), 'buy from me')$$, 'turned off for your account');
do $$ begin assert (select state from account_features where feature = 'comment') = 'off', 'you see your own switch'; end $$;
select pg_temp.expect_error($$select reason from account_features$$, 'permission denied');
reset role;
do $$ begin assert not welcome_credit_ok('00000000-0000-0000-0000-0000000000a2', (select id from shops where handle = 'other.shop')), 'welcome credit off'; end $$;
-- Payouts off holds what is scheduled; back to auto pays it again.
insert into payouts (order_id, shop_id, amount_cents, releasable_at, pay_on, status)
  select id, shop_id, 1000, now(), current_date + 3, 'scheduled' from orders where shop_id = (select id from shops where handle = 'thrift.with.lebo')
    and id not in (select order_id from payouts) limit 1;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select admin_set_feature('00000000-0000-0000-0000-00000000000a', 'payouts', 'off', 'Fraud check');
reset role;
do $$ begin assert not exists (select 1 from payouts p join shops s on s.id = p.shop_id where s.handle = 'thrift.with.lebo' and p.status = 'scheduled'), 'payouts held'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select admin_set_feature('00000000-0000-0000-0000-00000000000a', 'payouts', 'auto');
select admin_set_feature('00000000-0000-0000-0000-00000000000a', 'in_feed', 'auto');
reset role;
do $$ begin assert not exists (select 1 from account_features where user_id = '00000000-0000-0000-0000-00000000000a' and feature in ('payouts', 'in_feed')), 'auto removes the switch'; end $$;
select pg_temp.act_as_anon();
do $$ begin assert (select count(*) from feed(50, 0) where shop_handle = 'thrift.with.lebo') = (select n from feed_before), 'back in the feed'; end $$;
reset role;
select 'feature switch tests passed' as result;

-- ===== Packing proof =====
-- Three of Lebo's orders with packing proof to review.
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  select ('20000000-0000-0000-0000-00000000000' || i)::uuid, '00000000-0000-0000-0000-00000000000b', (select id from shops where handle = 'thrift.with.lebo'),
    (select id from products where title = 'Oversized tee, sand'), 'buy_now', 35000, 'collect_cpt', 0, 1200, 36200, 2100, 32900 from generate_series(1, 3) i;
create temp table pk as select id from orders where shop_id = (select id from shops where handle = 'thrift.with.lebo') order by created_at limit 3;
do $$ declare r record; begin
  for r in select id from pk loop
    if (select packing_media_id from orders where id = r.id) is null then perform pg_temp.packed(r.id); end if;
  end loop;
end $$;
grant select on pk to authenticated, service_role;
do $$ begin assert (select count(*) from pk) = 3, 'three orders to test with'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select admin_packing((select id from pk limit 1))$$, 'team');
select pg_temp.expect_error($$select admin_packing_review((select id from pk limit 1), false, 'x')$$, 'team');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
do $$ declare j jsonb := admin_packing((select id from pk order by id limit 1)); begin
  assert j ->> 'code' like 'MH %' and j ->> 'video' is not null and j ->> 'photo' is not null, 'team sees the code, video and photo';
  assert exists (select 1 from admin_log(5) x where x ->> 'action' = 'Viewed packing proof'), 'views are logged';
end $$;
select admin_packing_shared((select id from pk order by id limit 1), 'Buyer asked by email');
select pg_temp.expect_error($$select admin_packing_review((select id from pk order by id limit 1), false, '')$$, 'what was wrong');
do $$ declare r record; n int; i int := 0; begin
  for r in select id from pk order by id loop
    i := i + 1;
    n := admin_packing_review(r.id, false, 'The item was not shown from every side.');
    assert n = i, 'strikes count up';
  end loop;
end $$;
select pg_temp.expect_error($$select admin_packing_review((select id from pk order by id limit 1), false, 'again')$$, 'already has a strike');
reset role;
do $$ begin
  assert exists (select 1 from trust_events where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'packing_strike'), '2nd strike costs trust';
  assert feature_state('00000000-0000-0000-0000-00000000000a', 'sell') = 'off', '3rd strike pauses listing';
  assert exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-00000000000a' and title like 'Listings paused%'), 'seller is told';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select count(*) from packing_strikes) = 3, 'seller sees their strikes'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from packing_strikes) = 0, 'others do not'; end $$;
select pg_temp.expect_error($$select packing_due_purge()$$, 'permission denied');
reset role;
-- Deleted 6 months after delivery.
update orders set delivered_at = now() - interval '7 months' where id = (select id from pk order by id limit 1);
select pg_temp.act_as_service();
do $$ declare ids uuid[]; begin
  select array_agg(order_id) into ids from packing_due_purge();
  assert (select id from pk order by id limit 1) = any (ids), 'old proof is due';
  assert not exists (select 1 from packing_due_purge() d join pk on pk.id = d.order_id where d.order_id <> (select id from pk order by id limit 1)
                     and (select coalesce(delivered_at, shipped_at) from orders where id = d.order_id) > now() - interval '6 months'), 'recent proof is kept';
  perform packing_mark_purged(ids);
end $$;
reset role;
do $$ begin assert (select packing_media_id is null and packing_purged_at is not null from orders where id = (select id from pk order by id limit 1)), 'proof deleted and marked'; end $$;
select 'packing proof tests passed' as result;

-- ===== Hardening round 2 (migration 0025): each attack the reviews found must now fail =====
-- A product of Other shop with one left, and two orders racing for it.
select pg_temp.act_as_service();
update seller_checks set bank_status = 'approved' where shop_id = (select id from shops where handle = 'other.shop');
reset role;
insert into products (id, shop_id, title, price_cents, mode, stock, status)
  values ('40000000-0000-0000-0000-000000000001', (select id from shops where handle = 'other.shop'), 'Last lip kit', 30000, 'buy_now', 1, 'draft');
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  select ('40000000-0000-0000-0000-00000000001' || i)::uuid, '00000000-0000-0000-0000-00000000000b', (select id from shops where handle = 'other.shop'),
    '40000000-0000-0000-0000-000000000001', 'buy_now', 30000, 'courier', 0, 1200, 31200, 1800, 28200 from generate_series(1, 3) i;
select pg_temp.act_as_service();
update orders set status = 'paid' where id = '40000000-0000-0000-0000-000000000011';
update orders set status = 'paid' where id = '40000000-0000-0000-0000-000000000012';
reset role;
do $$ begin
  assert not (select oversold from orders where id = '40000000-0000-0000-0000-000000000011'), 'first payment gets the item';
  assert (select oversold from orders where id = '40000000-0000-0000-0000-000000000012'), 'second payment is marked oversold';
end $$;
select pg_temp.act_as_service();
update orders set status = 'refunded' where id = '40000000-0000-0000-0000-000000000012';
reset role;
do $$ begin
  assert (select stock from products where id = '40000000-0000-0000-0000-000000000001') = 0, 'a sold item is not relisted';
  assert not exists (select 1 from trust_events where order_id = '40000000-0000-0000-0000-000000000012'), 'no penalty for the seller';
end $$;
-- Packing proof: someone else's file can't be claimed; files must be real, ready and used once.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$insert into media (owner_id, kind, storage_path, status) values (auth.uid(), 'video', '00000000-0000-0000-0000-00000000000a/packing-x.mp4', 'uploading')$$, 'row-level security');
insert into media (owner_id, kind, status) values (auth.uid(), 'video', 'uploading'), (auth.uid(), 'image', 'uploading');
reset role;
select pg_temp.act_as_service();
select pg_temp.expect_error($$update orders set packing_media_id = (select id from media where owner_id = '00000000-0000-0000-0000-00000000000e' and kind = 'video' and status = 'uploading' limit 1), packing_photo_media_id = (select id from media where owner_id = '00000000-0000-0000-0000-00000000000e' and kind = 'image' and status = 'uploading' limit 1), status = 'shipped' where id = '40000000-0000-0000-0000-000000000011'$$, 'from the app');
reset role;
select pg_temp.packed('40000000-0000-0000-0000-000000000011');
select pg_temp.act_as_service();
update orders set status = 'shipped', tracking_ref = 'TCG1' where id = '40000000-0000-0000-0000-000000000011';
update orders set status = 'paid' where id = '40000000-0000-0000-0000-000000000013';
select pg_temp.expect_error($$update orders set packing_media_id = (select packing_media_id from orders where id = '40000000-0000-0000-0000-000000000011') where id = '40000000-0000-0000-0000-000000000013'$$, 'orders_packing_video_once');
reset role;
-- Removed posts stay removed.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$update posts set status = 'live' where status = 'removed'$$, 'removed by our team');
reset role;
-- Backdated rows get today's date, so rate limits can't be dodged.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into reports (reporter_id, target_kind, target_id, reason, created_at) values (auth.uid(), 'user', gen_random_uuid(), 'spam', now() - interval '3 days');
reset role;
do $$ begin assert (select max(created_at) from reports where reporter_id = '00000000-0000-0000-0000-00000000000d') > now() - interval '1 minute', 'created_at is set by the database'; end $$;
-- A won auction can't be put back up for sale.
update products set auction_state = 'won', status = 'sold_out' where title = 'Retro sunglasses';
select pg_temp.expect_error($$update products set status = 'live', auction_ends_at = now() + interval '2 days' where title = 'Retro sunglasses'$$, 'already has a winner');
-- Hidden fields, private facts, reserved names.
select pg_temp.act_as_anon();
select pg_temp.expect_error($$select reserve_cents from products$$, 'permission denied');
select pg_temp.expect_error($$select proof_path from products$$, 'permission denied');
select pg_temp.expect_error($$select is_suspended('00000000-0000-0000-0000-00000000000b')$$, 'permission denied');
select pg_temp.expect_error($$select admin_rewards('00000000-0000-0000-0000-00000000000b')$$, 'permission denied');
do $$ begin assert (select count(*) from products) > 0, 'public product fields still readable'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$update profiles set display_name = 'myHaul Support' where id = auth.uid()$$, 'reserved');
select pg_temp.expect_error($$update profiles set display_name = repeat('x', 100) where id = auth.uid()$$, 'profiles_text_sizes');
do $$ begin assert not blocked_between('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b'), 'others cannot test blocks'; end $$;
reset role;
-- At most one photo per position (10 per listing), even in one big insert.
select pg_temp.expect_error($$insert into listing_photos (product_id, storage_path, position) select '40000000-0000-0000-0000-000000000001', 'x/' || i, 0 from generate_series(1, 2) i$$, 'listing_photos_one_per_position');
-- Suspending a seller holds their payouts; a changed bank account blocks new orders.
insert into payouts (order_id, shop_id, amount_cents, releasable_at, pay_on, status)
  values ('40000000-0000-0000-0000-000000000011', (select id from shops where handle = 'other.shop'), 28200, now(), current_date + 2, 'scheduled');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select admin_suspend('00000000-0000-0000-0000-00000000000e', 'Exit scam suspected');
reset role;
do $$ begin assert (select status from payouts where order_id = '40000000-0000-0000-0000-000000000011') = 'held', 'suspension holds payouts'; end $$;
select pg_temp.act_as_service();
update seller_checks set bank_status = 'pending' where shop_id = (select id from shops where handle = 'other.shop');
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ('00000000-0000-0000-0000-00000000000b', (select id from shops where handle = 'other.shop'), '40000000-0000-0000-0000-000000000001', 'buy_now', 30000, 'courier', 0, 1200, 31200, 1800, 28200)$$, 'cannot take payments');
reset role;
-- Cheap orders from the same friend don't build trust.
do $$ declare before int; begin
  select count(*) into before from trust_events where user_id = '00000000-0000-0000-0000-00000000000e';
  perform add_trust_event('00000000-0000-0000-0000-00000000000e', 'order_kept', '40000000-0000-0000-0000-000000000011');
  perform add_trust_event('00000000-0000-0000-0000-00000000000e', 'order_kept', '40000000-0000-0000-0000-000000000013');
  assert (select count(*) from trust_events where user_id = '00000000-0000-0000-0000-00000000000e') = before + 1, 'once per buyer per 90 days';
end $$;
select 'hardening round 2 tests passed' as result;

-- ===== Live check fixes (migration 0027) =====
-- Signed out: can't test who blocked whom; sees media of live posts but not packing proof; can't read reviews.
select pg_temp.act_as_service();
insert into reviews (order_id, buyer_id, shop_id, stars, body)
  select id, buyer_id, shop_id, 5, 'Lovely' from orders where id = '40000000-0000-0000-0000-000000000011'
  on conflict do nothing;
update posts set status = 'live' where id = (select id from posts where media_id is not null limit 1);
reset role;
select pg_temp.act_as_anon();
select pg_temp.expect_error($$select blocked_between('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')$$, 'permission denied');
do $$ begin
  assert (select count(*) from media) = (select count(distinct x) from (
    select media_id x from posts where status = 'live'
    union select (c->>'media')::uuid from posts, jsonb_array_elements(coalesce(edit->'clips', '[]')) c where status = 'live') q), 'only media of live posts (and their clips) is public';
  assert not exists (select 1 from feed() f where f.storage_path is not null and not exists (select 1 from media m where m.storage_path = f.storage_path)), 'every feed video is still readable';
  assert (select count(*) from media where storage_path like '%packing-%' or storage_path like '%parcel-%') = 0, 'packing proof rows are hidden';
  assert (select count(*) from reviews) = 0, 'reviews hidden from signed out visitors';
  assert (select count(*) from media) >= 1, 'media of a live post is public';
end $$;
reset role;
-- The buyer and the seller still see their review; a stranger doesn't.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from reviews where order_id = '40000000-0000-0000-0000-000000000011') = 1, 'buyer sees own review'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
do $$ begin assert (select count(*) from reviews where order_id = '40000000-0000-0000-0000-000000000011') = 1, 'seller sees review'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
do $$ begin
  assert (select count(*) from reviews) = 0, 'strangers do not see reviews';
  assert (select count(*) from media where storage_path like '%packing-%') = 0, 'strangers do not see packing proof rows';
end $$;
reset role;
select 'live check fix tests passed' as result;

-- ===== Delivery through Bob Go (migration 0028) =====
-- Pickup addresses are private to the seller and the team.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
insert into shop_pickup (shop_id, name, phone, street, suburb, city, province, postal_code)
  values ((select id from shops where handle = 'other.shop'), 'Other Seller', '0821234567', '5 Lower Main Road', 'Observatory', 'Cape Town', 'WC', '7925');
select pg_temp.expect_error($$update shop_pickup set postal_code = '79' where true$$, 'violates check');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
do $$ begin assert (select count(*) from shop_pickup) = 0, 'strangers do not see pickup addresses'; end $$;
select pg_temp.expect_error($$insert into shop_pickup (shop_id, name, phone, street, suburb, city, province, postal_code)
  values ((select id from shops where handle = 'other.shop'), 'Fake', '0821234567', '1 Fake Street', 'Nowhere', 'Cape Town', 'WC', '8001')$$, 'row-level security');
reset role;
-- Buyers and sellers can't write booking fields; only our server does.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$update orders set courier_extra_cents = 0, shipment_id = 'X' where id = '40000000-0000-0000-0000-000000000011'$$, 'permission denied');
reset role;
-- The payout sum: courier money kept for Bob Go never reaches the seller, and can't be more than the fee.
select pg_temp.act_as_service();
update seller_checks set bank_status = 'approved' where shop_id = (select id from shops where handle = 'other.shop');
reset role;
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, delivery_kept_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ('00000000-0000-0000-0000-00000000000b', (select id from shops where handle = 'other.shop'), '40000000-0000-0000-0000-000000000001', 'buy_now', 30000, 'courier', 9000, 9000, 1200, 40200, 1800, 37200)$$, 'orders_payout_exact');
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, delivery_kept_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ('00000000-0000-0000-0000-00000000000b', (select id from shops where handle = 'other.shop'), '40000000-0000-0000-0000-000000000001', 'buy_now', 30000, 'courier', 9000, 12000, 1200, 40200, 1800, 25200)$$, 'orders_kept_within_fee');
-- Tracking: the buyer and seller see it, a stranger doesn't. A booking that costs more than the buyer paid alerts the team.
select pg_temp.act_as_service();
update orders set delivery_kept_cents = 0 where id = '40000000-0000-0000-0000-000000000011';
insert into shipment_events (order_id, happened_at, status, message) values ('40000000-0000-0000-0000-000000000011', now(), 'collected', 'Collected');
update orders set shipping_cost_cents = 9650 where id = '40000000-0000-0000-0000-000000000011';
reset role;
do $$ begin assert exists (select 1 from team_alerts where dedupe = 'shipping_cost:40000000-0000-0000-0000-000000000011'), 'team alerted about the courier cost'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from shipment_events where order_id = '40000000-0000-0000-0000-000000000011') = 1, 'buyer sees tracking'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
do $$ begin assert (select count(*) from shipment_events) = 0, 'strangers do not see tracking'; end $$;
reset role;
-- Every non food listing has a parcel size.
select pg_temp.act_as_service();
select pg_temp.expect_error($$update products set parcel_size = null where id = '40000000-0000-0000-0000-000000000001'$$, 'products_parcel_size_needed');
reset role;
select 'delivery tests passed' as result;

-- ===== Delivery perks (migration 0029) =====
select pg_temp.act_as_service();
update seller_checks set bank_status = 'approved' where shop_id = (select id from shops where handle = 'other.shop');
-- Not enough stamps: the order isn't saved.
select pg_temp.expect_error($$insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, delivery_kept_cents, delivery_discount_cents, delivery_perk, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ('40000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-00000000000d', (select id from shops where handle = 'other.shop'), '40000000-0000-0000-0000-000000000001', 'buy_now', 30000, 'courier', 9000, 9000, 4500, 'stamp', 1200, 35700, 1800, 28200)$$, '5 delivery stamps');
-- Five stamps from five old orders, then an order that uses them.
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  select ('40000000-0000-0000-0000-00000000004' || i)::uuid, '00000000-0000-0000-0000-00000000000d', (select id from shops where handle = 'other.shop'),
    '40000000-0000-0000-0000-000000000001', 'buy_now', 30000, 'collect_cpt', 0, 1200, 31200, 1800, 28200 from generate_series(1, 5) i;
insert into delivery_stamps (user_id, earned_order_id) select '00000000-0000-0000-0000-00000000000d', ('40000000-0000-0000-0000-00000000004' || i)::uuid from generate_series(1, 5) i;
do $$ begin assert delivery_stamps_ready('00000000-0000-0000-0000-00000000000d'), '5 stamps are ready'; end $$;
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, delivery_kept_cents, delivery_discount_cents, delivery_perk, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ('40000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-00000000000d', (select id from shops where handle = 'other.shop'), '40000000-0000-0000-0000-000000000001', 'buy_now', 30000, 'courier', 9000, 9000, 4500, 'stamp', 1200, 35700, 1800, 28200);
do $$ begin assert not delivery_stamps_ready('00000000-0000-0000-0000-00000000000d'), 'stamps used'; end $$;
-- The discount must match the total, can't exceed the fee, and needs a perk name.
select pg_temp.expect_error($$update orders set delivery_discount_cents = 9500 where id = '40000000-0000-0000-0000-000000000031'$$, 'orders_');
-- Unpaid and cancelled: the stamps come back.
update orders set status = 'cancelled' where id = '40000000-0000-0000-0000-000000000031';
do $$ begin assert delivery_stamps_ready('00000000-0000-0000-0000-00000000000d'), 'stamps back after cancel'; end $$;
reset role;
-- People can't make stamps or check others' stamps; the budget and ready checks are server only.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$insert into delivery_stamps (user_id, earned_order_id) values ('00000000-0000-0000-0000-00000000000d', '40000000-0000-0000-0000-000000000011')$$, 'permission denied');
select pg_temp.expect_error($$select delivery_stamps_ready('00000000-0000-0000-0000-00000000000b')$$, 'permission denied');
do $$ begin assert (select count(*) from delivery_stamps) = 5, 'you see your own stamps'; end $$;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from delivery_stamps) = 0, 'you do not see others'' stamps'; end $$;
reset role;
select 'delivery perk tests passed' as result;

-- ===== Friends and sharing (migration 0033) =====
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'thandi@test.co.za'), ('00000000-0000-0000-0000-0000000000b2', 'sipho@test.co.za'),
  ('00000000-0000-0000-0000-0000000000b3', 'stranger@test.co.za'), ('00000000-0000-0000-0000-0000000000b4', 'unfinished@test.co.za');
update profiles set handle = 'thandi', display_name = 'Thandi', adult_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
update profiles set handle = 'sipho', display_name = 'Sipho', adult_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000b2';
update profiles set handle = 'stranger', adult_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000b3';
-- An unfinished account can't follow or message.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b4');
select pg_temp.expect_error($$select follow_person('00000000-0000-0000-0000-0000000000b1', true)$$, 'Finish setting up');
reset role;
-- Thandi follows Sipho: not friends yet, so no messages. Sipho is told.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_error($$select follow_person('00000000-0000-0000-0000-0000000000b1', true)$$, 'yourself');
select follow_person('00000000-0000-0000-0000-0000000000b2', true);
select follow_person('00000000-0000-0000-0000-0000000000b2', true); -- twice is fine
select pg_temp.expect_error($$select send_to_friend('00000000-0000-0000-0000-0000000000b2', 'hi')$$, 'follow you back');
select pg_temp.expect_error($$select friend_chat_with('00000000-0000-0000-0000-0000000000b2')$$, 'follow you back');
do $$ begin assert (person_page('sipho')->>'iFollow')::boolean and not (person_page('sipho')->>'followsMe')::boolean, 'Thandi follows Sipho'; end $$;
do $$ begin assert (select count(*) from my_friends()) = 0, 'no friends yet'; end $$;
-- People can't write follows directly.
select pg_temp.expect_error($$insert into people_follows values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2')$$, 'permission denied');
reset role;
do $$ begin assert (select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000b2' and kind = 'follow') = 1, 'Sipho told once'; end $$;
-- Sipho follows back: friends, and Thandi is told.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin assert (select handle from follow_backs() limit 1) = 'thandi', 'Thandi shows under follow back'; end $$;
select follow_person('00000000-0000-0000-0000-0000000000b1', true);
do $$ begin assert (select count(*) from my_friends()) = 1, 'Sipho has one friend'; end $$;
do $$ begin assert (select count(*) from follow_backs()) = 0, 'nobody left to follow back'; end $$;
do $$ begin assert (select handle from find_people('tha') limit 1) = 'thandi', 'find people by username'; end $$;
do $$ begin assert (select count(*) from find_people('t')) = 0, 'search needs 2 letters'; end $$;
reset role;
do $$ begin assert exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and title like '%You''re friends now%'), 'Thandi told they are friends'; end $$;
-- Thandi shares a live post with Sipho and a note; strangers and fakes are refused.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_error($$select share_post((select id from posts where status = 'live' limit 1), array['00000000-0000-0000-0000-0000000000b3']::uuid[])$$, 'follow you back');
select pg_temp.expect_error($$select share_post((select id from posts where status = 'live' limit 1), array[]::uuid[])$$, 'at least one');
select pg_temp.expect_error($$select send_to_friend('00000000-0000-0000-0000-0000000000b2', '   ')$$, 'Write a message');
select pg_temp.expect_error($$select send_to_friend('00000000-0000-0000-0000-0000000000b2', 'you bitch')$$, 'friendly');
select pg_temp.expect_error($$select send_to_friend('00000000-0000-0000-0000-0000000000b2', '', '00000000-0000-0000-0000-000000000000')$$, 'isn''t available');
do $$ begin assert share_post((select id from posts where status = 'live' limit 1), array['00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2']::uuid[], 'Look at this') = 1, 'one share, duplicates once'; end $$;
select pg_temp.expect_error($$insert into friend_messages (chat_id, sender_id, body) select id, '00000000-0000-0000-0000-0000000000b1', 'sneaky' from friend_chats$$, 'permission denied');
do $$ begin assert (select count(*) from friend_messages) = 1, 'Thandi sees the message'; end $$;
do $$ begin assert (select last_shared and last_mine from my_friend_chats() limit 1), 'chat list shows the shared post'; end $$;
reset role;
do $$ begin assert exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-0000000000b2' and kind = 'friend_message' and body = 'Sent you a post: Look at this'), 'Sipho told about the post'; end $$;
-- Sipho sees it unread with the post card, reads it, replies.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
do $$ begin assert (select unread from my_friend_chats() limit 1) = 1, 'unread for Sipho'; end $$;
do $$ begin assert shared_post_card((select post_id from friend_messages limit 1))->>'title' is not null, 'Sipho sees the card'; end $$;
select read_friend_chat((select id from friend_chats limit 1));
do $$ begin assert (select unread from my_friend_chats() limit 1) = 0, 'read'; end $$;
select send_to_friend('00000000-0000-0000-0000-0000000000b1', 'Love it!');
reset role;
-- A stranger sees nothing of their chat, and no card.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3');
do $$ begin assert (select count(*) from friend_chats) = 0 and (select count(*) from friend_messages) = 0, 'strangers see no chats'; end $$;
do $$ begin assert shared_post_card((select id from posts where status = 'live' limit 1)) is null, 'strangers get no card'; end $$;
do $$ begin assert (select count(*) from people_follows) = 0, 'strangers do not see others'' follows'; end $$;
reset role;
-- Blocking unfriends both ways and stops messages.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
insert into blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_error($$select send_to_friend('00000000-0000-0000-0000-0000000000b2', 'hello?')$$, 'follow you back');
do $$ begin assert (select count(*) from people_follows) = 0, 'unfollowed both ways'; end $$;
do $$ begin assert person_page('sipho') is not null and (person_page('sipho')->>'blocked')::boolean, 'blocked shows'; end $$;
reset role;
-- A paused account can't follow anyone.
insert into suspensions (user_id, reason) values ('00000000-0000-0000-0000-0000000000b3', 'test');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3');
select pg_temp.expect_error($$select follow_person('00000000-0000-0000-0000-0000000000b1', true)$$, 'paused');
reset role;
select 'friends and sharing tests passed' as result;

-- ===== Cancelling paid orders (migration 0035) =====
select pg_temp.act_as_service();
-- Three paid orders from the same shop; each is cancelled a different way.
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents)
  select ('40000000-0000-0000-0000-00000000006' || i)::uuid, '00000000-0000-0000-0000-00000000000d', (select id from shops where handle = 'other.shop'),
    '40000000-0000-0000-0000-000000000001', 'buy_now', 30000, 'collect_cpt', 0, 1200, 31200, 1800, 28200 from generate_series(1, 4) i;
update products set stock = 10, status = 'live' where id = '40000000-0000-0000-0000-000000000001';
update orders set status = 'paid' where id::text like '40000000-0000-0000-0000-00000000006_';
do $$ begin assert not exists (select 1 from orders where id::text like '40000000-0000-0000-0000-00000000006_' and oversold), 'in stock, so not oversold'; end $$;
create temp table seller_points as select count(*) n from trust_events where user_id = (select owner_id from shops where handle = 'other.shop') and kind = 'not_shipped';
grant select on seller_points to authenticated, service_role;
-- The buyer cancels: no points lost, and the seller is told not to ship.
update orders set status = 'refunded', cancelled_by = 'buyer', cancel_reason = 'Ordered by mistake' where id = '40000000-0000-0000-0000-000000000061';
-- The seller cancels after the courier couldn't book: no points lost.
update orders set booking_failed_at = now() where id = '40000000-0000-0000-0000-000000000062';
update orders set status = 'refunded', cancelled_by = 'seller', cancel_reason = 'The courier couldn''t book it' where id = '40000000-0000-0000-0000-000000000062';
-- The seller cancels for no good reason: 5 points, like not shipping.
update orders set status = 'refunded', cancelled_by = 'seller', cancel_reason = 'It''s no longer available' where id = '40000000-0000-0000-0000-000000000063';
-- Not shipped in time (no one cancelled): 5 points.
update orders set status = 'refunded' where id = '40000000-0000-0000-0000-000000000064';
do $$ begin
  assert (select count(*) from trust_events where user_id = (select owner_id from shops where handle = 'other.shop') and kind = 'not_shipped') - (select n from seller_points) = 2,
    'only the seller''s own cancel and not shipping cost points';
  assert exists (select 1 from notifications where user_id = (select owner_id from shops where handle = 'other.shop') and title like 'Order cancelled:%' and body like 'The buyer cancelled%'), 'seller told the buyer cancelled';
  assert exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-00000000000d' and title like 'Order cancelled:%'), 'buyer told';
end $$;
select pg_temp.expect_error($$update orders set cancelled_by = 'nobody' where id = '40000000-0000-0000-0000-000000000061'$$, 'cancelled_by');
reset role;
-- People can't set who cancelled themselves (only our server functions change orders).
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$update orders set cancelled_by = 'buyer' where id = '40000000-0000-0000-0000-000000000063'$$, 'permission denied');
reset role;
select 'cancel tests passed' as result;

-- ===== Placeable text (migration 0037) =====
select pg_temp.act_as((select s.owner_id from posts p join shops s on s.id = p.shop_id where p.edit is not null limit 1));
select set_post_edit((select id from posts where edit is not null limit 1), jsonb_build_object(
  'clips', (select edit->'clips' from posts where edit is not null limit 1),
  'marks', jsonb_build_array(jsonb_build_object('kind', 'text', 'at', 0.5, 'until', 2, 'text', 'Size M', 'x', 0.4, 'y', 0.25, 'size', 1.6, 'rot', -12, 'style', 'box', 'color', '#22c55e')),
  'cover', 0));
do $$ declare m jsonb := (select edit->'marks'->0 from posts where edit is not null limit 1); begin
  assert (m->>'x')::numeric = 0.4 and (m->>'size')::numeric = 1.6 and (m->>'rot')::numeric = -12 and m->>'style' = 'box' and m->>'color' = '#22c55e', 'placed text is kept';
end $$;
select pg_temp.expect_error($$select set_post_edit((select id from posts where edit is not null limit 1), jsonb_build_object('clips', (select edit->'clips' from posts where edit is not null limit 1),
  'marks', jsonb_build_array(jsonb_build_object('kind', 'text', 'at', 0.5, 'text', 'Hi', 'style', 'neon')), 'cover', 0))$$, 'text style');
select pg_temp.expect_error($$select set_post_edit((select id from posts where edit is not null limit 1), jsonb_build_object('clips', (select edit->'clips' from posts where edit is not null limit 1),
  'marks', jsonb_build_array(jsonb_build_object('kind', 'text', 'at', 0.5, 'text', 'Hi', 'size', 9)), 'cover', 0))$$, 'wrong size');
reset role;
select 'placeable text tests passed' as result;

-- ===== Seller charges (migration 0038) =====
-- From the cancel tests above: the seller's own cancel (63) and not shipping (64) cost the seller TradeSafe's refund fee;
-- the buyer's cancel (61) and the courier failing (62) don't.
select pg_temp.act_as_service();
do $$ begin
  assert (select count(*) from seller_charges where order_id::text like '40000000-0000-0000-0000-00000000006_' and kind = 'refund_fee') = 2, 'two seller fault refunds charged';
  assert not exists (select 1 from seller_charges where order_id in ('40000000-0000-0000-0000-000000000061', '40000000-0000-0000-0000-000000000062')), 'no fee when not the seller''s fault';
  -- No payment method recorded: card rate, 2.5% of R312 plus VAT = R8.97.
  assert (select amount_cents from seller_charges where order_id = '40000000-0000-0000-0000-000000000064') = 897, 'card refund fee';
  assert refund_fee_cents('OZOW', 47200) = 815 and refund_fee_cents('EFT', 47200) = 863 and refund_fee_cents('CARD', 47200) = 1357, 'same as packages/core';
  assert exists (select 1 from notifications where user_id = (select owner_id from shops where handle = 'other.shop') and title = 'A refund fee comes off your next sale'), 'seller told';
end $$;
reset role;
-- The seller sees what they owe; others can't.
select pg_temp.act_as((select owner_id from shops where handle = 'other.shop'));
do $$ begin
  assert seller_owed((select id from shops where handle = 'other.shop')) = 1794, 'owes both fees';
  assert (select count(*) from seller_charges) = 2, 'sees own charges';
end $$;
select pg_temp.expect_error($$select team_add_seller_charge((select id from shops where handle = 'other.shop'), 'other', 100, 'nope')$$, 'Only our team');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select seller_owed((select id from shops where handle = 'other.shop'))$$, 'Not your shop');
do $$ begin assert (select count(*) from seller_charges) = 0, 'buyers see no charges'; end $$;
reset role;
-- Money taken from a sale lowers what's owed; if that sale is refunded, it's owed again.
select pg_temp.act_as_service();
insert into orders (id, buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, total_cents, seller_fee_cents, seller_payout_cents, charges_taken_cents)
  values ('40000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-00000000000d', (select id from shops where handle = 'other.shop'),
    '40000000-0000-0000-0000-000000000001', 'buy_now', 30000, 'collect_cpt', 0, 1200, 31200, 1800, 26406, 1794);
do $$ begin assert seller_owed((select id from shops where handle = 'other.shop')) = 0, 'taken from the next sale'; end $$;
update orders set status = 'cancelled' where id = '40000000-0000-0000-0000-000000000071';
do $$ begin assert seller_owed((select id from shops where handle = 'other.shop')) = 1794, 'owed again when that sale falls through'; end $$;
-- A courier extra becomes a charge.
update orders set courier_extra_cents = 4000 where id = '40000000-0000-0000-0000-000000000061';
do $$ begin assert exists (select 1 from seller_charges where order_id = '40000000-0000-0000-0000-000000000061' and kind = 'courier_extra' and amount_cents = 4000), 'courier extra charged'; end $$;
reset role;
select 'seller charges tests passed' as result;
-- Our team adds a chargeback and can take it away again while it hasn't been collected.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select team_add_seller_charge((select id from shops where handle = 'other.shop'), 'chargeback', 25000, 'Card payment reversed by the buyer''s bank, item never arrived');
do $$ begin
  assert seller_owed((select id from shops where handle = 'other.shop')) = 1794 + 4000 + 25000, 'chargeback owed';
  assert exists (select 1 from admin_actions where action like 'Added a charge%'), 'logged';
end $$;
select team_remove_seller_charge((select id from seller_charges where kind = 'chargeback'));
do $$ begin assert not exists (select 1 from seller_charges where kind = 'chargeback'), 'removed'; end $$;
reset role;
select 'team charges tests passed' as result;

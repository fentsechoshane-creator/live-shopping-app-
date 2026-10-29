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
reset role;

-- The feed is public.
select pg_temp.act_as_anon();
do $$ begin
  assert (select count(*) from feed()) = 1, 'feed shows the live post';
  assert (select tier from feed() limit 1) = 'standard', 'tier shown';
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
update orders set status = 'shipped', packing_media_id = (select id from media limit 1), tracking_ref = 'TCG123' where id = '10000000-0000-0000-0000-000000000001';
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
  -- 61 + 5 star (+1) + kept (+2)
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
-- Welcome credit top up: R349 tee, R50 credit, buyer pays R311, we top the seller up R17.06.
select pg_temp.act_as_service();
select pg_temp.expect_error($$insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, credit_cents, total_cents, seller_fee_cents, seller_payout_cents)
  values ('00000000-0000-0000-0000-00000000000b', (select id from shops where handle = 'other.shop'), (select id from products limit 1), 'buy_now', 34900, 'collect_cpt', 0, 1200, 5000, 31100, 2094, 32806)$$, 'orders_topup_exact');
insert into orders (buyer_id, shop_id, product_id, mode, item_price_cents, delivery, delivery_fee_cents, protection_fee_cents, credit_cents, total_cents, seller_fee_cents, seller_payout_cents, credit_topup_cents)
  values ('00000000-0000-0000-0000-00000000000b', (select id from shops where handle = 'other.shop'), (select id from products limit 1), 'buy_now', 34900, 'collect_cpt', 0, 1200, 5000, 31100, 2094, 32806, 1706);
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

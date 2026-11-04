-- Packing proof. Decided with Ofentse on 2026-11-04 (docs/LOG.md):
-- * Before any order ships or is handed over (courier, locker and collections), the seller uploads, in the app:
--   a video of 15 seconds to 2 minutes showing the order's packing code, the item from every side and the parcel being
--   sealed, and a photo of the sealed parcel with its label. No approval from us: the rules below check it automatically.
-- * The team spot checks some videos and reviews them in disputes. A video that doesn't follow the rules is a strike:
--   1st a warning, 2nd loses trust points, 3rd within 90 days pauses listing (the "sell" switch from 0021).
--   A missing or unclear video loses the seller a return dispute (Terms of Use).
-- * Kept for 6 months after delivery, longer while a return is open, then deleted by run-due.
-- * Buyers get it only on request by email: the team shares a link that expires in 7 days. Views and shares are logged.

-- ===== Orders =====
alter table orders add column packing_code text;
alter table orders alter column packing_code set default ('MH ' || lpad((floor(random() * 10000))::int::text, 4, '0'));
update orders set packing_code = 'MH ' || lpad((floor(random() * 10000))::int::text, 4, '0') where packing_code is null;
alter table orders add column packing_photo_media_id uuid references media (id) on delete set null;
alter table orders add column packing_review text check (packing_review in ('ok', 'strike'));
alter table orders add column packing_reviewed_at timestamptz;
alter table orders add column packing_purged_at timestamptz;

insert into trust_rules (kind, points) values ('packing_strike', -5) on conflict (kind) do nothing;

-- Shipping needs both proofs, uploaded by the seller after the buyer paid. Applies to everyone, the server included.
create function packing_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare seller uuid := shop_owner(new.shop_id); v media; ph media;
begin
  if not (new.status = 'shipped' and old.status = 'paid') then return new; end if;
  select * into v from media where id = new.packing_media_id;
  select * into ph from media where id = new.packing_photo_media_id;
  if v.id is null or ph.id is null then
    raise exception 'Add the packing video and the photo of the sealed parcel before shipping.' using errcode = 'check_violation';
  end if;
  if v.owner_id <> seller or ph.owner_id <> seller or v.kind <> 'video' or ph.kind <> 'image' then
    raise exception 'The packing video and photo must be your own, filmed in the app.' using errcode = 'check_violation';
  end if;
  if v.created_at < new.paid_at or ph.created_at < new.paid_at then
    raise exception 'Film the packing video and photo for this order, after it was paid.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger aa_orders_packing_guard before update on orders for each row execute function packing_guard();

-- ===== Fix: the private bucket refused videos =====
-- Packing videos go to the private bucket, which only allowed photos and PDFs up to 10 MB.
-- Now up to 100 MB [CONFIRM the Supabase plan allows files this big: the free plan stops at 50 MB].
do $do$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 104857600,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
                                 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']
      where id = 'private';
  end if;
end $do$;

-- ===== Strikes =====
create table packing_strikes (
  id bigint generated always as identity primary key,
  shop_id uuid not null references shops (id) on delete cascade,
  order_id uuid not null unique references orders (id) on delete cascade,
  note text not null check (length(note) between 1 and 300),
  by_admin uuid references profiles (id) on delete set null,
  at timestamptz not null default now()
);
create index packing_strikes_shop on packing_strikes (shop_id, at desc);
alter table packing_strikes enable row level security;
grant select on packing_strikes to authenticated;
create policy "sellers see their own strikes, the team sees all" on packing_strikes for select to authenticated
  using (shop_owner(shop_id) = auth.uid() or is_admin());

-- ===== The dashboard =====
-- One order's packing proof, for the team. Every look is logged.
create function admin_packing(p_order uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; out jsonb;
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  select * into o from orders where id = p_order;
  if o.id is null then raise exception 'Order not found.'; end if;
  select jsonb_build_object(
    'orderId', o.id, 'code', o.packing_code, 'shopId', o.shop_id, 'shippedAt', o.shipped_at,
    'video', (select storage_path from media where id = o.packing_media_id),
    'photo', (select storage_path from media where id = o.packing_photo_media_id),
    'review', o.packing_review, 'reviewedAt', o.packing_reviewed_at, 'purgedAt', o.packing_purged_at,
    'strikes90', (select count(*) from packing_strikes where shop_id = o.shop_id and at > now() - interval '90 days'))
  into out;
  if out ->> 'video' is not null then perform log_admin('Viewed packing proof', 'order', p_order, null); end if;
  return out;
end $$;

-- Logged when the team sends a buyer the 7 day link.
create function admin_packing_shared(p_order uuid, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only our team can do this.'; end if;
  perform log_admin('Shared packing proof (7 day link)', 'order', p_order, nullif(trim(coalesce(p_note, '')), ''));
end $$;

-- The team's verdict: fine, or a strike with a reason the seller sees.
create function admin_packing_review(p_order uuid, p_ok boolean, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare o orders; seller uuid; n int := 0; title text;
begin
  if not is_admin() then raise exception 'Only our team can do this.'; end if;
  select * into o from orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.packing_media_id is null then raise exception 'This order has no packing video.'; end if;
  seller := shop_owner(o.shop_id);
  select p.title into title from products p where p.id = o.product_id;
  if p_ok then
    update orders set packing_review = 'ok', packing_reviewed_at = now() where id = p_order;
    perform log_admin('Packing video OK', 'order', p_order, null);
    return 0;
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what was wrong. The seller sees it.'; end if;
  if exists (select 1 from packing_strikes where order_id = p_order) then raise exception 'This order already has a strike.'; end if;
  insert into packing_strikes (shop_id, order_id, note, by_admin) values (o.shop_id, p_order, left(trim(p_note), 300), auth.uid());
  update orders set packing_review = 'strike', packing_reviewed_at = now() where id = p_order;
  select count(*) into n from packing_strikes where shop_id = o.shop_id and at > now() - interval '90 days';
  if n = 1 then
    perform notify(seller, 'account', 'Packing warning: ' || title, trim(p_note) || ' Show the code, every side of the item and the sealing. 3 strikes in 90 days pauses your listings.', '/sell/orders/' || p_order);
  elsif n = 2 then
    perform add_trust_event(seller, 'packing_strike', p_order, left(trim(p_note), 200));
    perform notify(seller, 'account', 'Second packing strike: ' || title, trim(p_note) || ' You lost trust points. One more in 90 days pauses your listings.', '/sell/orders/' || p_order);
  else
    insert into account_features (user_id, feature, state, reason, by_admin)
      values (seller, 'sell', 'off', n || ' packing strikes in 90 days', auth.uid())
      on conflict (user_id, feature) do update set state = 'off', reason = excluded.reason, by_admin = excluded.by_admin, at = now();
    perform notify(seller, 'account', 'Listings paused: packing rules', trim(p_note) || ' That is ' || n || ' packing strikes in 90 days. Email help@myhaul.co.za to talk to us.', '/sell/orders/' || p_order);
  end if;
  perform log_admin('Packing strike ' || n || ' of 3', 'order', p_order, trim(p_note));
  return n;
end $$;

-- Spot checks: about 1 in 20 shipped orders from the last 14 days, not reviewed yet.
create function admin_packing_queue() returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  return query
    select jsonb_build_object('orderId', o.id, 'title', p.title, 'shopName', s.name, 'sellerId', s.owner_id, 'shippedAt', o.shipped_at, 'code', o.packing_code)
    from orders o join products p on p.id = o.product_id join shops s on s.id = o.shop_id
    where o.packing_media_id is not null and o.packing_review is null and o.packing_purged_at is null
      and o.shipped_at > now() - interval '14 days' and abs(hashtext(o.id::text)) % 20 = 0
    order by o.shipped_at desc limit 50;
end $$;

grant execute on function admin_packing(uuid), admin_packing_shared(uuid, text), admin_packing_review(uuid, boolean, text), admin_packing_queue() to authenticated;

-- ===== Deleting after 6 months =====
-- Orders whose packing proof can go: 6 months after delivery (or shipping), and no return open.
create function packing_due_purge() returns table (order_id uuid, paths text[]) language sql stable security definer set search_path = public as $$
  select o.id, array_remove(array[(select storage_path from media where id = o.packing_media_id), (select storage_path from media where id = o.packing_photo_media_id)], null)
  from orders o
  where o.packing_purged_at is null and (o.packing_media_id is not null or o.packing_photo_media_id is not null)
    and coalesce(o.delivered_at, o.shipped_at) < now() - interval '6 months'
    and o.status not in ('return_requested', 'return_in_transit')
  limit 200;
$$;
-- After run-due deleted the files: drop the media rows and mark the order.
create function packing_mark_purged(p_orders uuid[]) returns void language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  select array_agg(x) into ids from (select packing_media_id x from orders where id = any (p_orders) union all select packing_photo_media_id from orders where id = any (p_orders)) t where x is not null;
  update orders set packing_media_id = null, packing_photo_media_id = null, packing_purged_at = now() where id = any (p_orders);
  delete from media where id = any (coalesce(ids, '{}'));
end $$;
revoke execute on function packing_due_purge(), packing_mark_purged(uuid[]) from public, anon, authenticated;
grant execute on function packing_due_purge(), packing_mark_purged(uuid[]) to service_role;

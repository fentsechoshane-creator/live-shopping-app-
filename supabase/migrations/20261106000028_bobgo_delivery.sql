-- Delivery through Bob Go (decided with Ofentse, 6 Nov 2026).
-- myHaul books the courier or locker parcel once the seller has filmed the packing proof. The buyer's delivery
-- fee stays with us to pay Bob Go; it's priced by the parcel size the seller picks when listing, so big parcels
-- can't sink us. If a seller picks too small a size and the courier charges extra, the extra comes off that
-- seller's payout, and the team is alerted whenever a booking costs more than the buyer paid.

-- ===== Parcel size on listings =====
-- Small by default (most items here are clothes and beauty); the listing screen asks the seller to choose.
alter table products add column parcel_size text default 'small' check (parcel_size in ('small', 'medium', 'large'));
update products set parcel_size = 'small' where mode <> 'order_now' and parcel_size is null;
alter table products add constraint products_parcel_size_needed check (mode = 'order_now' or parcel_size is not null);
grant select (parcel_size) on products to anon, authenticated;
grant insert (parcel_size) on products to authenticated;
grant update (parcel_size) on products to authenticated;

-- ===== Orders: who keeps the delivery money, the parcel, the booking =====
alter table orders
  add column parcel_size text check (parcel_size in ('small', 'medium', 'large')),
  -- The part of the delivery fee we keep to pay Bob Go (courier and locker orders). Bakers who deliver keep theirs.
  add column delivery_kept_cents int not null default 0 check (delivery_kept_cents >= 0),
  -- The locker the buyer picked: Bob Go's pickup point id, name and address, saved at checkout.
  add column pickup_point jsonb check (pickup_point is null or octet_length(pickup_point::text) <= 2000),
  add column shipment_id text check (shipment_id is null or length(shipment_id) <= 80),
  add column courier_name text check (courier_name is null or length(courier_name) <= 80),
  -- What Bob Go charged us for the booking, and any extra a seller owes for picking too small a size.
  add column shipping_cost_cents int check (shipping_cost_cents is null or shipping_cost_cents >= 0),
  add column courier_extra_cents int not null default 0 check (courier_extra_cents >= 0),
  add column tracking_status text check (tracking_status is null or length(tracking_status) <= 60),
  add column booked_at timestamptz,
  add column tracking_checked_at timestamptz;

-- Old orders: the delivery fee went to the seller, so nothing was kept.
alter table orders drop constraint if exists orders_check1;
alter table orders add constraint orders_payout_exact
  check (seller_payout_cents = item_price_cents + delivery_fee_cents - delivery_kept_cents - seller_fee_cents);
alter table orders add constraint orders_kept_within_fee check (delivery_kept_cents <= delivery_fee_cents);
create unique index orders_shipment_once on orders (shipment_id) where shipment_id is not null;

-- Booking fields are only ever written by our server (service role), never by buyers or sellers.
-- (Orders have no update grant for app users already; this keeps it that way on purpose.)

-- ===== Where the courier collects from: the seller's pickup address (private) =====
create table shop_pickup (
  shop_id uuid primary key references shops (id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  phone text not null check (phone ~ '^[0-9 +()]{9,20}$'),
  street text not null check (length(street) between 3 and 120),
  suburb text not null check (length(suburb) between 2 and 80),
  city text not null check (length(city) between 2 and 80),
  province text not null check (province in ('EC', 'FS', 'GP', 'KZN', 'LP', 'MP', 'NC', 'NW', 'WC')),
  postal_code text not null check (postal_code ~ '^[0-9]{4}$'),
  updated_at timestamptz not null default now()
);
alter table shop_pickup enable row level security;
grant select, insert, update on shop_pickup to authenticated;
create policy "owner sees pickup address" on shop_pickup for select to authenticated
  using (is_admin() or exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()));
create policy "owner adds pickup address" on shop_pickup for insert to authenticated
  with check (exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()));
create policy "owner changes pickup address" on shop_pickup for update to authenticated
  using (exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from shops s where s.id = shop_id and s.owner_id = auth.uid()));
create function shop_pickup_touch() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end $$;
create trigger shop_pickup_touch before update on shop_pickup for each row execute function shop_pickup_touch();

-- ===== Buyers' saved addresses get the parts a courier needs =====
alter table delivery_details
  add column suburb text check (suburb is null or length(suburb) <= 80),
  add column city text check (city is null or length(city) <= 80),
  add column province text check (province is null or province in ('EC', 'FS', 'GP', 'KZN', 'LP', 'MP', 'NC', 'NW', 'WC')),
  add column postal_code text check (postal_code is null or postal_code ~ '^[0-9]{4}$'),
  add column pickup_point jsonb check (pickup_point is null or octet_length(pickup_point::text) <= 2000);

-- ===== Tracking events from Bob Go =====
create table shipment_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders (id) on delete cascade,
  happened_at timestamptz not null,
  status text not null check (length(status) <= 60),
  message text check (message is null or length(message) <= 300),
  location text check (location is null or length(location) <= 120),
  created_at timestamptz not null default now(),
  unique (order_id, happened_at, status)
);
alter table shipment_events enable row level security;
grant select on shipment_events to authenticated;
create policy "buyer, seller and team see tracking" on shipment_events for select to authenticated using (
  is_admin() or exists (select 1 from orders o where o.id = shipment_events.order_id
    and (o.buyer_id = auth.uid() or shop_owner(o.shop_id) = auth.uid())));

-- Our server (service role) writes bookings, pickup addresses for the team, and tracking.
grant all on shop_pickup, shipment_events to service_role;
grant usage, select on sequence shipment_events_id_seq to service_role;

-- ===== Team alert when a booking costs more than the buyer paid =====
create function shipping_cost_alert() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.shipping_cost_cents is not null and new.shipping_cost_cents is distinct from old.shipping_cost_cents
     and new.shipping_cost_cents > new.delivery_kept_cents then
    perform raise_alert('shipping_cost', 'normal',
      'Courier cost more than the buyer paid',
      format('Order %s: Bob Go charged R%s, the buyer paid R%s for %s delivery (%s parcel). Check the size the seller picked.',
        left(new.id::text, 8), to_char(new.shipping_cost_cents / 100.0, 'FM999990.00'),
        to_char(new.delivery_kept_cents / 100.0, 'FM999990.00'), new.delivery, coalesce(new.parcel_size, 'unknown')),
      '/team/orders', 'shipping_cost:' || new.id);
  end if;
  return new;
end $$;
revoke execute on function shipping_cost_alert() from public;
create trigger shipping_cost_alert after update of shipping_cost_cents on orders for each row execute function shipping_cost_alert();

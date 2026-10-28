-- Core tables for the live shopping app.
-- Money is stored in cents (integers). Times are timestamptz (UTC).
-- Business rules mirror packages/core. If you change a number here, change it there too.

-- ===== Types =====
create type shop_category as enum ('clothes', 'beauty', 'food', 'designer');
create type shop_status as enum ('onboarding', 'open', 'paused', 'banned');
create type review_status as enum ('not_started', 'pending', 'approved', 'rejected');
create type sale_mode as enum ('buy_now', 'auction', 'order_now');
create type listing_label as enum ('new', 'pre_loved', 'authentic_designer', 'unbranded_dupe');
create type item_condition as enum ('new', 'like_new', 'good', 'fair');
create type product_status as enum ('draft', 'live', 'sold_out', 'removed');
create type media_status as enum ('uploading', 'processing', 'ready', 'failed');
create type delivery_option as enum ('pudo_locker', 'courier', 'collect_cpt', 'collect_baker', 'baker_delivers');
create type order_status as enum (
  'pending_payment', 'paid', 'shipped', 'delivered', 'return_requested',
  'return_in_transit', 'refunded', 'completed', 'cancelled'
);
create type return_reason as enum ('changed_mind', 'not_as_described', 'wrong_item', 'faulty');
create type return_status as enum ('requested', 'in_transit', 'received', 'refunded', 'rejected');
create type payout_status as enum ('scheduled', 'held', 'released', 'cancelled');
create type trust_event_kind as enum (
  'order_kept', 'fast_ship_with_video', 'five_star_review', 'verified', 'clean_quarter',
  'not_as_described', 'flaw_not_shown', 'not_shipped', 'off_app_payment',
  'unpaid_auction_win', 'return_claim_rejected', 'fake_reviews_or_shill_bidding'
);

-- ===== People =====
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  handle text unique check (handle ~ '^[a-z0-9._]{3,30}$'),
  city text not null default 'Cape Town',
  role text not null default 'user' check (role in ('user', 'admin')),
  trust_score int not null default 50 check (trust_score between 0 and 100),
  welcome_credit_used boolean not null default false,
  created_at timestamptz not null default now()
);

-- Every new auth user gets a profile.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ===== Shops and seller checks =====
create table shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references profiles (id) on delete cascade,
  name text not null check (length(name) between 2 and 60),
  handle text not null unique check (handle ~ '^[a-z0-9._]{3,30}$'),
  category shop_category not null,
  bio text not null default '',
  city text not null default 'Cape Town',
  status shop_status not null default 'onboarding',
  founding_until timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now()
);

-- Private: only the owner and admins can read. Status columns are only changed by admins or server functions.
create table seller_checks (
  shop_id uuid primary key references shops (id) on delete cascade,
  phone text,
  id_status review_status not null default 'not_started',
  id_doc_path text,
  selfie_path text,
  bank_status review_status not null default 'not_started',
  bank_name text,
  bank_last4 text check (bank_last4 ~ '^[0-9]{4}$'),
  -- TradeSafe token for this seller. Bank account numbers are held by TradeSafe, never by us.
  escrow_token text,
  cert_status review_status not null default 'not_started',
  cert_path text,
  rules_accepted_at timestamptz,
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  notes text
);

create view seller_ready as
  select s.id as shop_id,
         (c.id_status = 'approved' and c.bank_status = 'approved' and c.rules_accepted_at is not null and s.status = 'open') as can_sell,
         c.cert_status = 'approved' as food_ok
  from shops s join seller_checks c on c.shop_id = s.id;

-- ===== Products, media and posts =====
create table products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  title text not null check (length(title) between 4 and 80),
  description text not null default '',
  price_cents int not null check (price_cents between 2000 and 5000000),
  mode sale_mode not null default 'buy_now',
  label listing_label not null default 'new',
  condition item_condition,
  sizes text[] not null default '{}',
  stock int not null default 1 check (stock >= 0),
  lead_days int check (lead_days between 0 and 30),
  allergens text,
  proof_path text,
  proof_status review_status not null default 'not_started',
  status product_status not null default 'draft',
  removed_reason text,
  created_at timestamptz not null default now()
);
create index products_shop_idx on products (shop_id);

create table media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('video', 'image')),
  -- Used when Mux is not set up: the file lives in Supabase Storage.
  storage_path text,
  mux_upload_id text unique,
  mux_asset_id text unique,
  mux_playback_id text,
  status media_status not null default 'uploading',
  created_at timestamptz not null default now()
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  media_id uuid not null references media (id) on delete restrict,
  caption text not null default '' check (length(caption) <= 300),
  views int not null default 0,
  status text not null default 'live' check (status in ('live', 'removed')),
  created_at timestamptz not null default now()
);
create index posts_created_idx on posts (created_at desc);

create table follows (
  user_id uuid not null references profiles (id) on delete cascade,
  shop_id uuid not null references shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, shop_id)
);

-- ===== Orders =====
create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references profiles (id),
  shop_id uuid not null references shops (id),
  product_id uuid not null references products (id),
  mode sale_mode not null,
  size text,
  item_price_cents int not null,
  delivery delivery_option not null,
  delivery_fee_cents int not null,
  protection_fee_cents int not null,
  credit_cents int not null default 0,
  total_cents int not null,
  seller_fee_cents int not null,
  seller_payout_cents int not null,
  -- Delivery details. Kept only as long as needed for the order (POPIA).
  delivery_details jsonb not null default '{}',
  food_date date,
  food_slot text,
  food_message text check (length(food_message) <= 60),
  status order_status not null default 'pending_payment',
  escrow_transaction_id text unique,
  escrow_allocation_id text,
  checkout_url text,
  paid_at timestamptz,
  ship_by timestamptz,
  shipped_at timestamptz,
  tracking_ref text,
  packing_media_id uuid references media (id),
  delivered_at timestamptz,
  releasable_at timestamptz,
  completed_at timestamptz,
  refunded_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (total_cents = item_price_cents + delivery_fee_cents + protection_fee_cents - credit_cents),
  check (seller_payout_cents = item_price_cents + delivery_fee_cents - seller_fee_cents),
  -- Escrow can only pay out what the buyer deposited.
  check (total_cents >= seller_payout_cents)
);
create index orders_buyer_idx on orders (buyer_id, created_at desc);
create index orders_shop_idx on orders (shop_id, created_at desc);
create index orders_due_idx on orders (status, releasable_at);

create table order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders (id) on delete cascade,
  from_status order_status,
  to_status order_status not null,
  actor_id uuid,
  note text,
  at timestamptz not null default now()
);

create table returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders (id) on delete cascade,
  reason return_reason not null,
  details text not null default '',
  status return_status not null default 'requested',
  postage_payer text not null check (postage_payer in ('buyer', 'seller')),
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table reviews (
  order_id uuid primary key references orders (id) on delete cascade,
  buyer_id uuid not null references profiles (id),
  shop_id uuid not null references shops (id),
  stars int not null check (stars between 1 and 5),
  body text not null default '' check (length(body) <= 500),
  created_at timestamptz not null default now()
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders (id),
  shop_id uuid not null references shops (id),
  amount_cents int not null,
  reserve_cents int not null default 0,
  reserve_until timestamptz,
  releasable_at timestamptz not null,
  pay_on date,
  status payout_status not null default 'scheduled',
  released_at timestamptz,
  created_at timestamptz not null default now()
);

-- ===== Trust =====
create table trust_rules (
  kind trust_event_kind primary key,
  points int not null
);
insert into trust_rules (kind, points) values
  ('order_kept', 2), ('fast_ship_with_video', 1), ('five_star_review', 1), ('verified', 10), ('clean_quarter', 5),
  ('not_as_described', -10), ('flaw_not_shown', -5), ('not_shipped', -5), ('off_app_payment', -10),
  ('unpaid_auction_win', -10), ('return_claim_rejected', -10), ('fake_reviews_or_shill_bidding', -20);

create table trust_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  kind trust_event_kind not null,
  points int not null,
  order_id uuid references orders (id),
  note text,
  created_at timestamptz not null default now()
);

create function apply_trust_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set trust_score = greatest(0, least(100, trust_score + new.points)) where id = new.user_id;
  return new;
end $$;
create trigger trust_event_applied after insert on trust_events
  for each row execute function apply_trust_event();

-- Adds a trust event using the points in trust_rules. Called by other functions, not by clients.
create function add_trust_event(p_user uuid, p_kind trust_event_kind, p_order uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into trust_events (user_id, kind, points, order_id, note)
  select p_user, p_kind, points, p_order, p_note from trust_rules where kind = p_kind;
end $$;
revoke execute on function add_trust_event(uuid, trust_event_kind, uuid, text) from public, anon, authenticated;

create function tier_for(score int) returns text language sql immutable as $$
  select case when score >= 90 then 'top' when score >= 70 then 'trusted' when score >= 40 then 'standard' else 'restricted' end;
$$;

-- ===== Notifications =====
create table notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);

create function notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link);
$$;
revoke execute on function notify(uuid, text, text, text, text) from public, anon, authenticated;

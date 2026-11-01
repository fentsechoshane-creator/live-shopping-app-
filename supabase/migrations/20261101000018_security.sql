-- Security hardening. Each part matches a row in docs/SECURITY.md.

-- ===== 2.2 Least privilege on tables =====
-- Supabase gives every new table full rights to signed out visitors and users. Row security stopped most of it,
-- but rights should match exactly what the app does. Nobody can truncate, add triggers or reference our tables.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke insert, update, delete on all tables in schema public from anon;
grant insert on app_errors to anon;                                   -- crash reports can come before sign in
revoke insert, update, delete on app_errors, bids, offers, reports, reserved_handles from authenticated;
grant insert on app_errors, reports to authenticated;
revoke update on blocks, comments, conversations, listing_photos, post_reactions from authenticated;
revoke delete on conversations from authenticated;
revoke update, delete on messages from authenticated;
-- 2.4 You can mark a message to you as read, and nothing else.
grant update (read_at) on messages to authenticated;

-- ===== 2.3 Reserved usernames are locked =====
alter table reserved_handles enable row level security;
revoke all on reserved_handles from anon, authenticated;

-- ===== 2.6 Account actions need a signed in user =====
revoke execute on function complete_account(text, text, boolean, boolean), hold_product(uuid, uuid, int), make_offer(uuid, uuid[], int, int),
  place_bid(uuid, int), set_username(text), my_blocks(), my_conversations() from anon, public;
revoke execute on function prune_app_errors() from anon, authenticated, public;
grant execute on function prune_app_errors() to service_role;

-- ===== 1. Money: welcome credit and self buying =====
create table app_limits (key text primary key, value bigint not null check (value >= 0), note text not null default '');
alter table app_limits enable row level security;
revoke all on app_limits from anon, authenticated;
insert into app_limits (key, value, note) values
  ('welcome_credit_budget_cents', 1500000, 'Total welcome credit we can give: R15,000 (300 buyers). Raise only with a new budget.'),
  ('welcome_credit_per_seller_30d', 5, 'Most credit orders one seller can receive in 30 days. Stops sellers farming top ups with fake buyers.');

-- 1.2 One welcome credit per account. A unique index can't be raced, even by two checkouts at the same moment.
create unique index orders_one_welcome_credit on orders (buyer_id) where credit_cents > 0 and status <> 'cancelled';

-- Can this buyer use the welcome credit on an order from this shop? Used by checkout, and again as a hard rule below.
create function welcome_credit_ok(p_buyer uuid, p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not p.welcome_credit_used
     and p.handle is not null and p.adult_confirmed_at is not null
     and not is_suspended(p.id)
     and not exists (select 1 from orders o where o.buyer_id = p.id and (o.credit_cents > 0 and o.status <> 'cancelled'
                     or o.status not in ('pending_payment', 'cancelled')))
     and (select coalesce(sum(credit_cents), 0) from orders where credit_cents > 0 and status not in ('cancelled'))
         + 5000 <= (select value from app_limits where key = 'welcome_credit_budget_cents')
     and (select count(*) from orders where shop_id = p_shop and credit_cents > 0 and status <> 'cancelled' and created_at > now() - interval '30 days')
         < (select value from app_limits where key = 'welcome_credit_per_seller_30d')
  from profiles p where p.id = p_buyer;
$$;
revoke execute on function welcome_credit_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function welcome_credit_ok(uuid, uuid) to service_role;

-- 1.3, 1.4, 1.5 Hard rules on every new order, whoever creates it.
create function orders_money_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.buyer_id = shop_owner(new.shop_id) then raise exception 'You cannot buy your own item.'; end if;
  if new.credit_cents > 0 then
    if new.credit_cents > 5000 then raise exception 'The welcome credit is at most R50.'; end if;
    if not welcome_credit_ok(new.buyer_id, new.shop_id) then
      raise exception 'The welcome credit can''t be used on this order.';
    end if;
  end if;
  return new;
end $$;
create trigger aa_orders_money_guard before insert on orders for each row execute function orders_money_guard();
-- (Order amounts, including credit, already can't change after the order is made: orders_before_update.)

-- 1.4 Top ups to pay, with warning signs for the team to check before sending money.
create function admin_topups() returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  return query
    select jsonb_build_object('payoutId', py.id, 'shopName', s.name, 'sellerId', s.owner_id, 'amountCents', py.topup_cents, 'payOn', py.pay_on,
      'bank', coalesce(c.bank_name || ' ending ' || c.bank_last4, ''), 'buyer', coalesce(b.handle, b.display_name), 'buyerId', o.buyer_id,
      'orderStatus', o.status,
      'flags', to_jsonb(array_remove(array[
        case when o.created_at - b.created_at < interval '48 hours' then 'Buyer account under 2 days old' end,
        case when nullif(regexp_replace(coalesce(o.delivery_details ->> 'phone', ''), '\D', '', 'g'), '') is not null
              and right(regexp_replace(o.delivery_details ->> 'phone', '\D', '', 'g'), 9) = right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9)
             then 'Buyer phone is the seller''s phone' end,
        case when o.delivery in ('collect_cpt', 'collect_baker') then 'Collected in person (no courier proof)' end,
        case when (select count(*) from orders x where x.shop_id = o.shop_id and x.credit_cents > 0 and x.status <> 'cancelled'
                   and x.created_at > now() - interval '30 days') >= 3 then 'Seller has 3 or more credit orders this month' end,
        case when o.status <> 'completed' then 'Order not finished yet' end
      ]::text[], null)))
    from payouts py join orders o on o.id = py.order_id join shops s on s.id = py.shop_id
    join profiles b on b.id = o.buyer_id left join seller_checks c on c.shop_id = s.id
    where py.topup_cents > 0 and py.topup_paid_at is null and py.status <> 'cancelled'
    order by py.pay_on nulls last;
end $$;
revoke execute on function admin_topups() from public, anon;
grant execute on function admin_topups() to authenticated;

-- ===== 1.9 A changed bank account needs our approval again =====
create function bank_change_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.escrow_token is not null and new.escrow_token is distinct from old.escrow_token and not is_admin() then
    new.bank_status := 'pending';
    perform notify(shop_owner(new.shop_id), 'shop', 'Bank account changed',
      'Your bank account was changed. Payouts wait until our team checks it. If this wasn''t you, email support now.', '/me?tab=selling');
  end if;
  return new;
end $$;
create trigger aa_bank_change_guard before update on seller_checks for each row execute function bank_change_guard();

-- ===== 7.1 Limits on how often people can do things =====
-- tg_argv: the column that holds the person, how many, and in what time.
create function rate_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare who uuid; n int;
begin
  who := (to_jsonb(new) ->> tg_argv[0])::uuid;
  execute format('select count(*) from %I where %s and created_at > now() - %L::interval', tg_table_name,
                 case when who is null then format('%I is null', tg_argv[0]) else format('%I = %L', tg_argv[0], who) end, tg_argv[2])
    into n;
  if n >= tg_argv[1]::int then raise exception 'Slow down a little. Try again in a moment.'; end if;
  return new;
end $$;
create trigger ab_rate_messages before insert on messages for each row execute function rate_limit('sender_id', '20', '1 minute');
create trigger ab_rate_comments before insert on comments for each row execute function rate_limit('user_id', '10', '1 minute');
create trigger ab_rate_reports before insert on reports for each row execute function rate_limit('reporter_id', '20', '1 day');
create trigger ab_rate_conversations before insert on conversations for each row execute function rate_limit('buyer_id', '30', '1 day');
create trigger ab_rate_bids before insert on bids for each row execute function rate_limit('bidder_id', '30', '1 minute');
create trigger ab_rate_offers before insert on offers for each row execute function rate_limit('shop_id', '60', '1 hour');
create trigger ab_rate_errors before insert on app_errors for each row execute function rate_limit('user_id', '30', '1 minute');
create index if not exists messages_sender_at on messages (sender_id, created_at desc);
create index if not exists comments_user_at on comments (user_id, created_at desc);
create index if not exists app_errors_user_at on app_errors (user_id, created_at desc);
alter table app_errors add constraint app_errors_sizes check (length(message) <= 500 and length(coalesce(stack, '')) <= 4000
  and length(coalesce(path, '')) <= 200 and length(coalesce(platform, '')) <= 40 and length(coalesce(version, '')) <= 40) not valid;

-- 6.3 Limits for paid services (the AI suggestions). Called by server functions only.
create table usage_events (id bigint generated always as identity primary key, user_id uuid not null references profiles (id) on delete cascade,
  kind text not null, created_at timestamptz not null default now());
create index usage_events_user on usage_events (user_id, kind, created_at desc);
alter table usage_events enable row level security;
revoke all on usage_events from anon, authenticated;
create function take_usage(p_user uuid, p_kind text, p_max int, p_window interval) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from usage_events where user_id = p_user and kind = p_kind and created_at > now() - p_window) >= p_max then return false; end if;
  insert into usage_events (user_id, kind) values (p_user, p_kind);
  return true;
end $$;
revoke execute on function take_usage(uuid, text, int, interval) from public, anon, authenticated;
grant execute on function take_usage(uuid, text, int, interval) to service_role;

-- ===== 5.1 Upload limits =====
-- (Skipped on the local test database, whose storage stub has no limit columns.)
do $do$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 104857600,
      allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
      where id = 'videos';
    update storage.buckets set file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
      where id = 'private';
    update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
      where id = 'avatars';
  end if;
end $do$;

-- ===== 2.5 New tables and functions start locked =====
-- From now on nothing is open by default: every migration must grant exactly what it needs (see docs/SECURITY.md).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Delivery perks (decided with Ofentse, 6 Nov 2026). See packages/core/src/fees.ts DELIVERY_PERKS.
-- Stamps: every Instant EFT (Ozow) order of R200 or more earns a stamp once its return window closes (completed).
-- 5 stamps = half price delivery (at most R45) on a courier or locker order. Big orders get half price delivery
-- from R1,000 and a free locker from R1,500. Perks don't stack, and they run inside a monthly budget.

alter table orders
  add column delivery_discount_cents int not null default 0 check (delivery_discount_cents >= 0),
  add column delivery_perk text check (delivery_perk in ('stamp', 'big_order')),
  -- How the buyer paid, as TradeSafe reports it (only our server writes it).
  add column payment_method text check (payment_method is null or length(payment_method) <= 40);

-- The total now takes off any delivery perk we fund.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%total_cents = %item_price_cents%' loop
    execute format('alter table orders drop constraint %I', c.conname);
  end loop;
end $$;
alter table orders add constraint orders_total_exact
  check (total_cents = item_price_cents + delivery_fee_cents - delivery_discount_cents + protection_fee_cents - credit_cents);
alter table orders add constraint orders_discount_within_fee check (delivery_discount_cents <= delivery_fee_cents);
alter table orders add constraint orders_perk_has_discount check ((delivery_perk is null) = (delivery_discount_cents = 0));

create table delivery_stamps (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  earned_order_id uuid not null unique references orders (id) on delete cascade,
  used_order_id uuid references orders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index delivery_stamps_unused on delivery_stamps (user_id) where used_order_id is null;
alter table delivery_stamps enable row level security;
grant select on delivery_stamps to authenticated;
grant all on delivery_stamps to service_role;
grant usage, select on sequence delivery_stamps_id_seq to service_role;
create policy "you see your stamps" on delivery_stamps for select to authenticated using (user_id = auth.uid() or is_admin());

-- Has this buyer got 5 unused stamps? (Server only.)
create function delivery_stamps_ready(p_buyer uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select count(*) >= 5 from delivery_stamps where user_id = p_buyer and used_order_id is null;
$$;
-- Is there perk budget left this month (South African time)? (Server only.)
create function delivery_perk_budget_ok() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(delivery_discount_cents), 0) < 1000000 from orders
  where status not in ('pending_payment', 'cancelled')
    and created_at >= date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
$$;
revoke execute on function delivery_stamps_ready(uuid), delivery_perk_budget_ok() from public, anon, authenticated;
grant execute on function delivery_stamps_ready(uuid), delivery_perk_budget_ok() to service_role;

-- Using stamps: an order with the stamp perk takes 5 unused stamps, or isn't saved at all.
create function delivery_stamps_use() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if new.delivery_perk = 'stamp' then
    with s as (select id from delivery_stamps where user_id = new.buyer_id and used_order_id is null order by created_at limit 5 for update)
    update delivery_stamps set used_order_id = new.id where id in (select id from s);
    get diagnostics n = row_count;
    if n < 5 then raise exception 'You need 5 delivery stamps for this.'; end if;
  end if;
  return new;
end $$;
create trigger delivery_stamps_use after insert on orders for each row execute function delivery_stamps_use();

-- Earning and giving back stamps as orders move.
create function delivery_stamps_follow() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare left_ int;
begin
  if new.status is distinct from old.status then
    -- Unpaid or refunded: stamps used on this order come back.
    if new.status in ('cancelled', 'refunded') then
      update delivery_stamps set used_order_id = null where used_order_id = new.id;
    end if;
    -- Return window closed on an Instant EFT order of R200 or more: one stamp.
    if new.status = 'completed' and new.payment_method ilike '%ozow%' and new.item_price_cents >= 20000 then
      insert into delivery_stamps (user_id, earned_order_id) values (new.buyer_id, new.id) on conflict (earned_order_id) do nothing;
      if found then
        select count(*) into left_ from delivery_stamps where user_id = new.buyer_id and used_order_id is null;
        perform notify(new.buyer_id, 'reward',
          case when left_ >= 5 then 'Half price delivery unlocked' else format('Delivery stamp %s of 5', left_) end,
          case when left_ >= 5 then 'You have 5 Instant EFT stamps. Your next courier or locker delivery is half price.'
               else format('Paying with Instant EFT earned you a stamp. %s more for half price delivery.', 5 - left_) end,
          '/inbox');
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger delivery_stamps_follow after update of status on orders for each row execute function delivery_stamps_follow();
revoke execute on function delivery_stamps_use(), delivery_stamps_follow() from public;

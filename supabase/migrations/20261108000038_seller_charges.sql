-- Who pays TradeSafe's costs (decided with Ofentse 8 Nov 2026, from the TradeSafe merchant agreement):
--   * The payment fee (1.5% Ozow, 2.5% card...): us. That's what the buyer protection fee is for.
--   * Refund fees: the seller when the refund is their fault (not shipped in time, cancelled for no good reason, an item
--     returned because it was faulty or not as described, or our team says so). Otherwise us: the law lets buyers
--     cancel within 7 days, charging only the return postage.
--   * The R5 bank fee on each payout: TradeSafe takes it from the seller's own payout. Sellers pick how often they're
--     paid (each sale, weekly or monthly, which has no fee). [CONFIRM with TradeSafe that it comes off the seller's payout.]
--   * Chargebacks and anything else a seller owes: our team adds them as a charge.
-- What a seller owes is taken from their next sale inside escrow (orders.charges_taken_cents, worked out at checkout
-- by orderTotals in packages/core). If that sale is refunded, the money taken counts as owed again.

alter table orders
  add column charges_taken_cents int not null default 0 check (charges_taken_cents >= 0),
  add column seller_at_fault boolean;
-- The payout rule from 0028, now less what was taken towards charges.
alter table orders drop constraint orders_payout_exact;
alter table orders add constraint orders_payout_exact
  check (seller_payout_cents = item_price_cents + delivery_fee_cents - delivery_kept_cents - seller_fee_cents - charges_taken_cents);

alter table seller_checks
  add column payout_schedule text not null default 'WEEKLY' check (payout_schedule in ('IMMEDIATE', 'WEEKLY', 'MONTHLY'));
-- Sellers who already linked a bank were set up with TradeSafe as "each sale".
update seller_checks set payout_schedule = 'IMMEDIATE' where escrow_token is not null;

create table seller_charges (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  order_id uuid references orders (id) on delete set null,
  kind text not null check (kind in ('refund_fee', 'courier_extra', 'chargeback', 'other')),
  amount_cents int not null check (amount_cents > 0 and amount_cents <= 5000000),
  note text not null check (length(note) between 3 and 300),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (order_id, kind)
);
create index seller_charges_shop on seller_charges (shop_id, created_at desc);
alter table seller_charges enable row level security;
create policy "sellers see their own charges, the team sees all" on seller_charges for select
  using (shop_owner(shop_id) = auth.uid() or is_admin());
-- Rows are only added by the triggers and team functions below.
grant select on seller_charges to authenticated;
grant select, insert, update, delete on seller_charges to service_role;

-- TradeSafe's refund fee, VAT included. Same numbers as refundFee() in packages/core/src/fees.ts.
create function refund_fee_cents(p_method text, p_total int) returns int
language sql immutable set search_path = public as $$
  select ceil(round((case
    when lower(coalesce(p_method, '')) ~ '(ozow|instant)' then p_total * 0.015
    when lower(coalesce(p_method, '')) ~ 'snap' then p_total * 0.035
    when lower(coalesce(p_method, '')) ~ '(pjn|payjustnow|wallet)' then 750
    when lower(coalesce(p_method, '')) ~ 'rcs' then p_total * 0.0275
    when lower(coalesce(p_method, '')) ~ 'eft' then 750
    else p_total * 0.025 end) * 1.15, 2))::int
$$;

-- What a seller still owes: their charges, less what was taken from sales that went through.
create function seller_owed(p_shop uuid) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not (coalesce(shop_owner(p_shop) = auth.uid(), false) or is_admin() or auth.role() = 'service_role') then
    raise exception 'Not your shop' using errcode = '42501';
  end if;
  return greatest(0,
    coalesce((select sum(amount_cents) from seller_charges where shop_id = p_shop), 0)
    - coalesce((select sum(charges_taken_cents) from orders where shop_id = p_shop and status not in ('cancelled', 'refunded')), 0))::int;
end $$;
grant execute on function seller_owed(uuid) to authenticated, service_role;
grant execute on function refund_fee_cents(text, int) to authenticated, service_role;

-- Refund fees the seller caused, and courier extras, become charges automatically.
create function seller_charges_from_orders() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fault boolean;
  fee int;
  ref text := upper(left(new.id::text, 4));
begin
  if new.status = 'refunded' and old.status is distinct from 'refunded' then
    fault := (old.status = 'paid' and not coalesce(new.oversold, false)
               and (new.cancelled_by is null
                    or (new.cancelled_by = 'seller' and new.booking_failed_at is null and new.cancel_requested_at is null)))
      or (new.cancelled_by = 'team' and coalesce(new.seller_at_fault, false))
      or (old.status = 'return_in_transit' and new.cancelled_by is null
          and exists (select 1 from returns r where r.order_id = new.id and r.postage_payer = 'seller'));
    if fault and new.total_cents > 0 then
      fee := refund_fee_cents(new.payment_method, new.total_cents);
      insert into seller_charges (shop_id, order_id, kind, amount_cents, note)
        values (new.shop_id, new.id, 'refund_fee', fee, 'TradeSafe''s fee for refunding order ' || ref)
        on conflict (order_id, kind) do nothing;
      if found then
        perform notify(shop_owner(new.shop_id), 'payout', 'A refund fee comes off your next sale',
          'TradeSafe charged R' || to_char(fee / 100.0, 'FM999990.00') || ' to refund order ' || ref || '. It comes off the payout of your next sale.',
          '/sell/payouts');
      end if;
    end if;
  end if;
  if coalesce(new.courier_extra_cents, 0) > 0 and coalesce(old.courier_extra_cents, 0) = 0 then
    insert into seller_charges (shop_id, order_id, kind, amount_cents, note)
      values (new.shop_id, new.id, 'courier_extra', new.courier_extra_cents, 'The courier charged more for order ' || ref || ': the parcel was bigger than the size picked')
      on conflict (order_id, kind) do nothing;
  end if;
  return new;
end $$;
create trigger orders_seller_charges after update on orders for each row execute function seller_charges_from_orders();

-- Our team adds a charge (a chargeback, say) or takes one away while it hasn't been collected yet.
create function team_add_seller_charge(p_shop uuid, p_kind text, p_amount int, p_note text, p_order uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not is_admin() then raise exception 'Only our team can do this' using errcode = '42501'; end if;
  if p_kind not in ('chargeback', 'other') then raise exception 'Pick chargeback or other'; end if;
  insert into seller_charges (shop_id, order_id, kind, amount_cents, note, created_by)
    values (p_shop, p_order, p_kind, p_amount, trim(p_note), auth.uid()) returning id into cid;
  perform log_admin('Added a charge of R' || to_char(p_amount / 100.0, 'FM999990.00'), 'shop', p_shop, trim(p_note));
  perform notify(shop_owner(p_shop), 'payout', 'A charge comes off your next sale',
    trim(p_note) || ' (R' || to_char(p_amount / 100.0, 'FM999990.00') || '). It comes off the payout of your next sale.', '/sell/payouts');
  return cid;
end $$;

create function team_remove_seller_charge(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c seller_charges;
begin
  if not is_admin() then raise exception 'Only our team can do this' using errcode = '42501'; end if;
  select * into c from seller_charges where id = p_id;
  if c.id is null then raise exception 'That charge is gone'; end if;
  if seller_owed(c.shop_id) < c.amount_cents then raise exception 'Already taken from a sale, so it can''t be removed here'; end if;
  delete from seller_charges where id = p_id;
  perform log_admin('Removed a charge of R' || to_char(c.amount_cents / 100.0, 'FM999990.00'), 'shop', c.shop_id, c.note);
end $$;
grant execute on function team_add_seller_charge(uuid, text, int, text, uuid), team_remove_seller_charge(uuid) to authenticated;

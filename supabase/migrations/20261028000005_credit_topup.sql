-- Welcome credit top ups. The welcome credit is a discount we fund from our budget. Escrow holds what the buyer
-- paid, so when the credit is bigger than our cut on an order, we pay the seller the difference ourselves.
alter table orders add column credit_topup_cents int not null default 0;

do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%total_cents >= seller_payout_cents%';
  if c is not null then execute format('alter table orders drop constraint %I', c); end if;
end $$;
alter table orders add constraint orders_topup_exact check (credit_topup_cents = greatest(0, seller_payout_cents - total_cents));

alter table payouts add column topup_cents int not null default 0;
alter table payouts add column topup_paid_at timestamptz;

-- Our team marks a top up as paid once the EFT from our account has gone through.
create function admin_mark_topup_paid(p_payout uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update payouts set topup_paid_at = now() where id = p_payout and topup_cents > 0 and topup_paid_at is null;
end $$;
revoke execute on function admin_mark_topup_paid(uuid) from public, anon;
grant execute on function admin_mark_topup_paid(uuid) to authenticated, service_role;

-- Hardening from the Supabase security advisor.
alter view seller_ready set (security_invoker = on);
alter function orders_before_update() set search_path = public;
alter function order_transition_allowed(order_status, order_status) set search_path = public;
alter function return_window(sale_mode) set search_path = public;
alter function looks_counterfeit(text) set search_path = public;
alter function mentions_brand(text) set search_path = public;
alter function tier_for(int) set search_path = public;

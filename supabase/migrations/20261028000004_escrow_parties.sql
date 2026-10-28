-- TradeSafe token per user (buyer side). Server only: no client access at all.
create table escrow_parties (
  user_id uuid primary key references profiles (id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now()
);
alter table escrow_parties enable row level security;
revoke all on escrow_parties from anon, authenticated;
grant all on escrow_parties to service_role;

-- Orders the scheduled job must act on.
create view due_orders as
  select o.id, o.status, o.mode, o.escrow_transaction_id, o.escrow_allocation_id, o.shop_id, o.seller_payout_cents,
         o.releasable_at, o.ship_by,
         case
           when o.status = 'paid' and o.ship_by < now() then 'refund_unshipped'
           when o.status = 'delivered' and o.releasable_at <= now() then 'release'
         end as action
  from orders o
  where (o.status = 'paid' and o.ship_by < now()) or (o.status = 'delivered' and o.releasable_at <= now());
revoke all on due_orders from anon, authenticated;
grant select on due_orders to service_role;

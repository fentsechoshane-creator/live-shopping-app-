-- Surprise rewards replace the welcome credit. Decided with Ofentse on 2026-11-04 (docs/LOG.md):
-- * No credit at sign up: that rewards making accounts, which gets farmed. The first order is full price.
-- * R50 the first time each of these is delivered: a Buy now (or made to order) order you bought, an auction you won,
--   and a sale you made. Never advertised: it arrives as a surprise when the order is delivered.
-- * Usable once that order's return window closes ('pending' then 'ready'). If the order is refunded, it's forfeited.
-- * One reward comes off an order of R200 or more (packages/core fees.ts). Credit is used by itself at checkout.
-- * The R15,000 budget (app_limits welcome_credit_budget_cents) caps rewards given. Team switch "welcome_credit" off: none.
-- * Same rules for sellers: their reward is credit to shop with.
-- Abuse guards: the earning order must be R100 or more [CONFIRM amount]; a shop can only receive 5 reward orders
-- in 30 days (welcome_credit_per_seller_30d); suspended accounts get nothing; one reward per order.

create table rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('first_buy', 'first_auction', 'first_sale')),
  amount_cents int not null check (amount_cents > 0 and amount_cents <= 5000),
  earned_order_id uuid references orders (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'used', 'forfeited')),
  usable_from timestamptz,
  used_order_id uuid references orders (id) on delete set null,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, kind)
);
create index rewards_user on rewards (user_id, status);
alter table rewards enable row level security;
grant select on rewards to authenticated;
grant update (seen_at) on rewards to authenticated;
create policy "you see your own rewards, the team sees all" on rewards for select to authenticated using (user_id = auth.uid() or is_admin());
create policy "you mark your own rewards seen" on rewards for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on rewards to service_role;

alter table orders add column reward_id uuid references rewards (id) on delete set null;
-- The old rule (one credit order per person, ever) is replaced by one order per reward.
drop index if exists orders_one_welcome_credit;
create unique index orders_one_per_reward on orders (reward_id) where reward_id is not null and status <> 'cancelled';

-- Gives a reward once, if the rules allow. Silent when they don't: it's a surprise, not a promise.
create function grant_reward(p_user uuid, p_kind text, p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare o orders; budget bigint;
begin
  select * into o from orders where id = p_order;
  if p_user is null or is_suspended(p_user) or feature_state(p_user, 'welcome_credit') = 'off' then return; end if;
  if exists (select 1 from rewards where user_id = p_user and kind = p_kind) then return; end if;
  if o.item_price_cents < 10000 then return; end if;
  select value into budget from app_limits where key = 'welcome_credit_budget_cents';
  if (select coalesce(sum(amount_cents), 0) from rewards where status <> 'forfeited') + 5000 > coalesce(budget, 0) then return; end if;
  insert into rewards (user_id, kind, amount_cents, earned_order_id, usable_from)
    values (p_user, p_kind, 5000, p_order, coalesce(o.releasable_at, now() + interval '7 days'))
    on conflict (user_id, kind) do nothing;
  if found then
    perform notify(p_user, 'reward', 'Surprise! You earned R50',
      case p_kind when 'first_buy' then 'A thank you for your first order.' when 'first_auction' then 'A thank you for your first auction win.'
                  else 'A thank you for your first sale.' end
      || ' It''s yours to spend once the return window closes. One reward comes off an order of R200 or more.', '/me');
  end if;
end $$;
revoke execute on function grant_reward(uuid, text, uuid) from public, anon, authenticated;

-- Delivered: give the surprises. Finished: ready to use. Refunded: forfeited (and any reward used on it comes back).
create function rewards_on_order() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'delivered' then
    perform grant_reward(new.buyer_id, case when new.mode = 'auction' then 'first_auction' else 'first_buy' end, new.id);
    perform grant_reward(shop_owner(new.shop_id), 'first_sale', new.id);
  elsif new.status = 'completed' then
    perform notify(user_id, 'reward', 'Your R50 is ready', 'It comes off your next order of R200 or more, by itself.', '/me')
      from rewards where earned_order_id = new.id and status = 'pending';
    update rewards set status = 'ready' where earned_order_id = new.id and status = 'pending';
  elsif new.status in ('refunded', 'cancelled') then
    update rewards set status = 'forfeited' where earned_order_id = new.id and status in ('pending', 'ready');
    if new.reward_id is not null then
      update rewards set status = 'ready', used_order_id = null where id = new.reward_id and status = 'used';
    end if;
  end if;
  return new;
end $$;
create trigger zz_rewards_on_order after update on orders for each row execute function rewards_on_order();

-- Paying with a reward: the database picks the oldest ready one, so the app can't choose or reuse one.
create function reward_attach() returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid; amt int;
begin
  if new.credit_cents <= 0 then new.reward_id := null; return new; end if;
  select id, amount_cents into rid, amt from rewards where user_id = new.buyer_id and status = 'ready' order by created_at limit 1 for update;
  if rid is null then raise exception 'There''s no reward to use on this order.'; end if;
  if new.credit_cents > amt then raise exception 'The reward is at most R%.', amt / 100; end if;
  new.reward_id := rid;
  return new;
end $$;
create trigger ab_orders_reward before insert on orders for each row execute function reward_attach();
-- Marked used once the order exists. Two checkouts racing for the same reward: orders_one_per_reward stops the second.
create function reward_mark_used() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reward_id is not null then update rewards set status = 'used', used_order_id = new.id where id = new.reward_id; end if;
  return new;
end $$;
create trigger zz_orders_reward_used after insert on orders for each row execute function reward_mark_used();

-- Can this buyer use a reward on an order from this shop? Used by checkout, and again by orders_money_guard.
create or replace function welcome_credit_ok(p_buyer uuid, p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p.handle is not null and p.adult_confirmed_at is not null
     and not is_suspended(p.id)
     and feature_state(p.id, 'welcome_credit') <> 'off'
     and exists (select 1 from rewards r where r.user_id = p.id and r.status = 'ready')
     and (select count(*) from orders where shop_id = p_shop and credit_cents > 0 and status <> 'cancelled' and created_at > now() - interval '30 days')
         < (select value from app_limits where key = 'welcome_credit_per_seller_30d')
  from profiles p where p.id = p_buyer;
$$;

-- Your rewards, for the wallet and the surprise.
create function my_rewards() returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'kind', r.kind, 'amountCents', r.amount_cents, 'status', r.status, 'usableFrom', r.usable_from,
           'createdAt', r.created_at, 'seen', r.seen_at is not null, 'orderTitle', (select p.title from orders o join products p on p.id = o.product_id where o.id = r.earned_order_id))
  from rewards r where r.user_id = auth.uid() order by r.created_at desc;
$$;
grant execute on function my_rewards() to authenticated;

-- The team: someone's rewards on their account page.
create function admin_rewards(p_user uuid) returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  return query select jsonb_build_object('kind', r.kind, 'amountCents', r.amount_cents, 'status', r.status, 'usableFrom', r.usable_from, 'createdAt', r.created_at)
    from rewards r where r.user_id = p_user order by r.created_at desc;
end $$;
grant execute on function admin_rewards(uuid) to authenticated;

-- Alerts: the budget now counts rewards given, not credit spent.
create or replace function check_alerts() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; budget bigint; used bigint;
begin
  -- New reports: app stores want an answer within 24 hours.
  for r in select id, reason, target_kind from reports where status = 'open' loop
    n := n + raise_alert('report', 'urgent', 'New report: ' || replace(r.reason, '_', ' '), 'Someone reported a ' || r.target_kind || '. Answer within 24 hours.', '/team/reports', 'report:' || r.id)::int;
  end loop;
  -- Seller checks waiting.
  for r in select s.id, s.name, c.id_status, c.cert_status, c.bank_status from seller_checks c join shops s on s.id = c.shop_id
           where c.id_status = 'pending' or c.cert_status = 'pending' or c.bank_status = 'pending' loop
    n := n + raise_alert('check', 'normal', 'Seller check waiting: ' || r.name,
      case when r.bank_status = 'pending' then 'Their bank account changed. Check it before payouts.' else 'Check their ID or certificate.' end,
      '/team/checks', 'check:' || r.id || ':' || r.id_status || r.cert_status || r.bank_status)::int;
  end loop;
  -- Orders past their ship by date.
  for r in select o.id, s.name, p.title from orders o join shops s on s.id = o.shop_id join products p on p.id = o.product_id
           where o.status = 'paid' and o.ship_by < now() loop
    n := n + raise_alert('late', 'urgent', 'Late to ship: ' || r.title, r.name || ' hasn''t shipped. Remind them, or it refunds automatically.', '/team/orders?f=late', 'late:' || r.id)::int;
  end loop;
  -- Returns the seller disputed.
  for r in select o.id, p.title from orders o join products p on p.id = o.product_id where o.status = 'return_requested'
           and exists (select 1 from returns x where x.order_id = o.id and x.status = 'requested' and x.created_at < now() - interval '3 days') loop
    n := n + raise_alert('return', 'normal', 'Return waiting: ' || r.title, 'Decide who is right.', '/team/returns', 'return:' || r.id)::int;
  end loop;
  -- Welcome credit: budget nearly used, or a sudden burst of credit orders.
  select value into budget from app_limits where key = 'welcome_credit_budget_cents';
  select coalesce(sum(amount_cents), 0) into used from rewards where status <> 'forfeited';
  if budget > 0 and used >= budget * 0.8 then
    n := n + raise_alert('credit', 'urgent', 'Reward budget 80% used', 'R' || (used / 100) || ' of R' || (budget / 100) || ' given as surprise rewards. New rewards stop when the budget runs out.', '/team/money', 'budget80:' || budget)::int;
  end if;
  if (select count(*) from orders where credit_cents > 0 and created_at > now() - interval '1 hour') >= 10 then
    n := n + raise_alert('credit', 'urgent', 'Unusual credit use', '10 or more welcome credit orders in the last hour. Check for fake accounts.', '/team/money',
      'creditburst:' || to_char(now(), 'YYYY-MM-DD HH24'))::int;
  end if;
  for r in select s.id, s.name, count(*) c from orders o join shops s on s.id = o.shop_id
           where o.credit_cents > 0 and o.status <> 'cancelled' and o.created_at > now() - interval '30 days' group by s.id, s.name having count(*) >= 3 loop
    n := n + raise_alert('credit', 'normal', 'Many credit orders: ' || r.name, r.c || ' welcome credit orders this month. Check the buyers before paying top ups.', '/team/money',
      'creditshop:' || r.id || ':' || to_char(now(), 'YYYY-MM'))::int;
  end loop;
  -- Top ups due in the next 2 days.
  if exists (select 1 from payouts where topup_cents > 0 and topup_paid_at is null and status <> 'cancelled' and pay_on <= current_date + 2) then
    n := n + raise_alert('topup', 'normal', 'Top ups to pay soon', 'Welcome credit top ups are due within 2 days.', '/team/money', 'topup:' || current_date)::int;
  end if;
  -- App errors: a burst usually means something broke.
  if (select count(*) from app_errors where created_at > now() - interval '1 hour') >= 20 then
    n := n + raise_alert('errors', 'urgent', 'Many app errors', '20 or more errors in the last hour. Something may be broken.', '/team/errors',
      'errors:' || to_char(now(), 'YYYY-MM-DD HH24'))::int;
  end if;
  return n;
end $$;

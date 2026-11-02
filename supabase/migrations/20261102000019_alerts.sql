-- Team alerts and AI reviews. The scheduled job (run-due) calls check_alerts() every few minutes; new alerts show in the
-- dashboard, arrive as notifications for every team member, and go out by email or Telegram when those are set up.
-- The AI reviewer (team-review) writes suggestions to ai_reviews. It only suggests: people decide.

create table team_alerts (
  id bigint generated always as identity primary key,
  kind text not null,
  severity text not null default 'normal' check (severity in ('urgent', 'normal')),
  title text not null,
  body text not null default '',
  link text check (link is null or link like '/team%'),
  dedupe text not null unique,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  sent_at timestamptz
);
create index team_alerts_recent on team_alerts (created_at desc);
alter table team_alerts enable row level security;
grant select on team_alerts to authenticated;
grant update (seen_at) on team_alerts to authenticated;
create policy "the team reads alerts" on team_alerts for select to authenticated using (is_admin());
create policy "the team marks alerts seen" on team_alerts for update to authenticated using (is_admin()) with check (is_admin());

-- Adds an alert once (the dedupe key stops repeats) and tells every team member in the app.
create function raise_alert(p_kind text, p_severity text, p_title text, p_body text, p_link text, p_dedupe text)
returns boolean language plpgsql security definer set search_path = public as $$
declare a record;
begin
  insert into team_alerts (kind, severity, title, body, link, dedupe) values (p_kind, p_severity, p_title, p_body, p_link, p_dedupe)
  on conflict (dedupe) do nothing;
  if not found then return false; end if;
  for a in select id from profiles where role = 'admin' loop
    perform notify(a.id, 'team', p_title, p_body, p_link);
  end loop;
  return true;
end $$;
revoke execute on function raise_alert(text, text, text, text, text, text) from public, anon, authenticated;

-- What needs the team right now. Safe to run often: each alert is raised once.
create function check_alerts() returns int language plpgsql security definer set search_path = public as $$
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
  select coalesce(sum(credit_cents), 0) into used from orders where credit_cents > 0 and status <> 'cancelled';
  if budget > 0 and used >= budget * 0.8 then
    n := n + raise_alert('credit', 'urgent', 'Welcome credit 80% used', 'R' || (used / 100) || ' of R' || (budget / 100) || ' given. It stops when the budget runs out.', '/team/money', 'budget80:' || budget)::int;
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
  -- High risk AI reviews (see below).
  for r in select id, summary from ai_reviews where risk = 'high' and created_at > now() - interval '1 day' loop
    n := n + raise_alert('ai', 'urgent', 'AI flagged something high risk', left(r.summary, 200), '/team/reports', 'ai:' || r.id)::int;
  end loop;
  return n;
end $$;

-- ===== AI reviews =====
create table ai_reviews (
  id bigint generated always as identity primary key,
  target_kind text not null check (target_kind in ('report', 'topup')),
  target_id uuid not null,
  risk text not null check (risk in ('low', 'medium', 'high')),
  summary text not null check (length(summary) <= 600),
  suggestion text not null check (length(suggestion) <= 600),
  model text not null,
  created_at timestamptz not null default now(),
  unique (target_kind, target_id)
);
alter table ai_reviews enable row level security;
grant select on ai_reviews to authenticated;
create policy "the team reads AI reviews" on ai_reviews for select to authenticated using (is_admin());

revoke execute on function check_alerts() from public, anon, authenticated;
grant execute on function check_alerts() to service_role;
grant select, insert, update on team_alerts, ai_reviews to service_role;
grant usage on all sequences in schema public to service_role;

-- The app needs these to show the AI review next to a report.
grant execute on function raise_alert(text, text, text, text, text, text) to service_role;

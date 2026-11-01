-- Team dashboard: one place for our team to see and run the whole app.
-- Adds suspended accounts, a log of every team action, and the read and write functions the dashboard uses.
-- Every function here checks is_admin() first.

-- ===== Suspended accounts =====
-- A suspended person can still sign in and see their orders, but can't buy, sell, bid, post, comment or message.
-- Kept in its own table: profiles are readable by everyone signed in, and the reason is private.
create table suspensions (
  user_id uuid primary key references profiles (id) on delete cascade,
  reason text not null check (length(reason) between 1 and 300),
  by_admin uuid references profiles (id) on delete set null,
  at timestamptz not null default now()
);
alter table suspensions enable row level security;
grant select on suspensions to authenticated;
create policy "you see your own suspension, the team sees all" on suspensions for select to authenticated using (user_id = auth.uid() or is_admin());

create function is_suspended(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from suspensions where user_id = p_user);
$$;

create function block_suspended() returns trigger language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if tg_argv[0] = 'shop_id' then who := shop_owner((to_jsonb(new) ->> 'shop_id')::uuid);
  else who := (to_jsonb(new) ->> tg_argv[0])::uuid; end if;
  if is_suspended(who) then
    raise exception 'This account is suspended. Email support if you think this is a mistake.';
  end if;
  return new;
end $$;
create trigger aa_orders_not_suspended before insert on orders for each row execute function block_suspended('buyer_id');
create trigger aa_bids_not_suspended before insert on bids for each row execute function block_suspended('bidder_id');
create trigger aa_messages_not_suspended before insert on messages for each row execute function block_suspended('sender_id');
create trigger aa_comments_not_suspended before insert on comments for each row execute function block_suspended('user_id');
create trigger aa_conversations_not_suspended before insert on conversations for each row execute function block_suspended('buyer_id');
create trigger aa_offers_not_suspended before insert on offers for each row execute function block_suspended('shop_id');
create trigger aa_products_not_suspended before insert on products for each row execute function block_suspended('shop_id');
create trigger aa_posts_not_suspended before insert on posts for each row execute function block_suspended('shop_id');

-- ===== Team action log =====
create table admin_actions (
  id bigint generated always as identity primary key,
  admin_id uuid references profiles (id) on delete set null,
  action text not null,
  target_kind text not null check (target_kind in ('user', 'shop', 'product', 'post', 'comment', 'report', 'order', 'payout', 'message')),
  target_id uuid,
  note text,
  at timestamptz not null default now()
);
create index admin_actions_at on admin_actions (at desc);
create index admin_actions_target on admin_actions (target_id);
alter table admin_actions enable row level security;
grant select on admin_actions to authenticated;
create policy "the team reads the action log" on admin_actions for select to authenticated using (is_admin());

create function log_admin(p_action text, p_kind text, p_target uuid, p_note text default null, p_admin uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into admin_actions (admin_id, action, target_kind, target_id, note) values (coalesce(p_admin, auth.uid()), p_action, p_kind, p_target, p_note);
$$;
revoke execute on function log_admin(text, text, uuid, text, uuid) from public, anon, authenticated;

-- Log the team actions that already existed (approving checks, reports, listings, top ups, return decisions).
create function log_team_changes() returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb := to_jsonb(old); n jsonb := to_jsonb(new); c text;
begin
  -- Tables differ, so read the rows as JSON (PL/pgSQL checks every column reference against the row type).
  if tg_table_name = 'returns' then
    if o ->> 'decided_by' is null and n ->> 'decided_by' is not null
       and exists (select 1 from profiles where id = (n ->> 'decided_by')::uuid and role = 'admin')
       and (n ->> 'decided_by')::uuid <> shop_owner((select shop_id from orders where id = (n ->> 'order_id')::uuid)) then
      perform log_admin(case when n ->> 'status' = 'rejected' then 'Return: seller is right' else 'Return: buyer is right' end,
        'order', (n ->> 'order_id')::uuid, n ->> 'reason', (n ->> 'decided_by')::uuid);
    end if;
    return new;
  end if;
  if not is_admin() then return new; end if;
  if tg_table_name = 'seller_checks' then
    foreach c in array array['id', 'bank', 'cert'] loop
      if (o ->> (c || '_status')) is distinct from (n ->> (c || '_status')) and (n ->> (c || '_status')) in ('approved', 'rejected') then
        perform log_admin(case when n ->> (c || '_status') = 'approved' then 'Approved ' else 'Rejected ' end
          || case c when 'id' then 'ID check' when 'bank' then 'bank details' else 'food certificate' end, 'shop', (n ->> 'shop_id')::uuid, n ->> 'notes');
      end if;
    end loop;
  elsif tg_table_name = 'reports' then
    if o ->> 'status' = 'open' and n ->> 'status' <> 'open' then
      perform log_admin(case when n ->> 'status' = 'actioned' then 'Acted on report' else 'Dismissed report' end, 'report', (n ->> 'id')::uuid,
        (n ->> 'reason') || ' on a ' || (n ->> 'target_kind'));
    end if;
  elsif tg_table_name = 'products' then
    if n ->> 'status' = 'removed' and o ->> 'status' <> 'removed' then
      perform log_admin('Removed listing', 'product', (n ->> 'id')::uuid, n ->> 'removed_reason');
    end if;
  elsif tg_table_name = 'payouts' then
    if o ->> 'topup_paid_at' is null and n ->> 'topup_paid_at' is not null then
      perform log_admin('Marked top up paid', 'payout', (n ->> 'id')::uuid, 'R' || ((n ->> 'topup_cents')::int / 100));
    end if;
  end if;
  return new;
end $$;
create trigger zz_log_team after update on seller_checks for each row execute function log_team_changes();
create trigger zz_log_team after update on reports for each row execute function log_team_changes();
create trigger zz_log_team after update on products for each row execute function log_team_changes();
create trigger zz_log_team after update on payouts for each row execute function log_team_changes();
create trigger zz_log_team after update on returns for each row execute function log_team_changes();

-- ===== Overview =====
create function admin_overview() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  with paid as (
    select * from orders where paid_at is not null and status not in ('cancelled', 'refunded')
  ), days as (
    select generate_series((now() at time zone 'Africa/Johannesburg')::date - 13, (now() at time zone 'Africa/Johannesburg')::date, interval '1 day')::date as d
  )
  select jsonb_build_object(
    'people', (select count(*) from profiles),
    'peopleNew7', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'suspended', (select count(*) from suspensions),
    'shopsOpen', (select count(*) from shops where status = 'open'),
    'shopsOnboarding', (select count(*) from shops where status = 'onboarding'),
    'shopsClosed', (select count(*) from shops where status in ('paused', 'banned')),
    'checksWaiting', (select count(*) from seller_checks where id_status = 'pending') + (select count(*) from seller_checks where cert_status = 'pending'),
    'reportsOpen', (select count(*) from reports where status = 'open'),
    'returnsWaiting', (select count(*) from orders where status = 'return_requested'),
    'topUpsDue', (select count(*) from payouts where topup_cents > 0 and topup_paid_at is null and status <> 'cancelled'),
    'topUpsDueCents', (select coalesce(sum(topup_cents), 0) from payouts where topup_cents > 0 and topup_paid_at is null and status <> 'cancelled'),
    'errors7', (select count(*) from app_errors where created_at > now() - interval '7 days'),
    'liveListings', (select count(*) from products where status = 'live'),
    'auctionsOpen', (select count(*) from products where mode = 'auction' and auction_state = 'open'),
    'ordersToday', (select count(*) from paid where paid_at > date_trunc('day', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg'),
    'orders30', (select count(*) from paid where paid_at > now() - interval '30 days'),
    'sales30Cents', (select coalesce(sum(total_cents), 0) from paid where paid_at > now() - interval '30 days'),
    'fees30Cents', (select coalesce(sum(seller_fee_cents + protection_fee_cents), 0) from paid where paid_at > now() - interval '30 days'),
    'credit30Cents', (select coalesce(sum(credit_cents), 0) from paid where paid_at > now() - interval '30 days'),
    'toShip', (select count(*) from orders where status = 'paid'),
    'late', (select count(*) from orders where status = 'paid' and ship_by < now()),
    'byStatus', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from orders group by status) x),
    'daily', (select jsonb_agg(jsonb_build_object('day', d, 'orders', coalesce(o.n, 0), 'salesCents', coalesce(o.s, 0)) order by d)
              from days left join (select (paid_at at time zone 'Africa/Johannesburg')::date as day, count(*) n, sum(total_cents) s from paid group by 1) o on o.day = days.d)
  ) into out;
  return out;
end $$;

-- ===== People =====
create function admin_person_row(p profiles) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.display_name, 'handle', p.handle, 'email', (select email from auth.users where id = p.id),
    'role', p.role, 'trust', p.trust_score, 'tier', tier_for(p.trust_score), 'createdAt', p.created_at,
    'avatarPath', p.avatar_path,
    'suspendedAt', (select at from suspensions where user_id = p.id), 'suspendedReason', (select reason from suspensions where user_id = p.id), 'setUp', p.handle is not null and p.adult_confirmed_at is not null,
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name, 'handle', s.handle, 'status', s.status, 'category', s.category,
               'idStatus', c.id_status, 'bankStatus', c.bank_status, 'certStatus', c.cert_status)
             from shops s left join seller_checks c on c.shop_id = s.id where s.owner_id = p.id),
    'ordersBought', (select count(*) from orders where buyer_id = p.id and paid_at is not null),
    'ordersSold', (select count(*) from orders o join shops s on s.id = o.shop_id where s.owner_id = p.id and o.paid_at is not null),
    'reportsAgainst', (select count(*) from reports r where r.status = 'open' and (r.target_id = p.id
                       or r.target_id in (select id from shops where owner_id = p.id)
                       or r.target_id in (select po.id from posts po join shops s on s.id = po.shop_id where s.owner_id = p.id)
                       or r.target_id in (select id from comments where user_id = p.id))));
$$;
revoke execute on function admin_person_row(profiles) from public, anon, authenticated;

-- Search everyone. Filter: all, sellers, buyers, waiting (seller checks to do), suspended, team.
create function admin_people(p_q text default '', p_filter text default 'all', p_limit int default 50, p_offset int default 0)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(trim(coalesce(p_q, ''))) || '%';
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  return query
    select admin_person_row(p) from profiles p
    left join auth.users u on u.id = p.id
    left join shops s on s.owner_id = p.id
    left join seller_checks c on c.shop_id = s.id
    where (q = '%%' or lower(p.display_name) like q or lower(coalesce(p.handle, '')) like q or lower(coalesce(u.email, '')) like q
           or lower(coalesce(s.name, '')) like q or lower(coalesce(s.handle, '')) like q)
      and case p_filter
        when 'sellers' then s.id is not null
        when 'buyers' then s.id is null
        when 'waiting' then c.id_status = 'pending' or c.cert_status = 'pending'
        when 'suspended' then is_suspended(p.id)
        when 'team' then p.role = 'admin'
        else true end
    order by p.created_at desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

-- One person in full: account, shop and checks, orders, trust history, reports and what the team did.
create function admin_person(p_user uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p profiles; sid uuid; out jsonb;
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  select * into p from profiles where id = p_user;
  if p.id is null then raise exception 'Account not found.'; end if;
  select id into sid from shops where owner_id = p.id;
  out := admin_person_row(p) || jsonb_build_object(
    'bio', p.bio, 'city', p.city, 'adultConfirmedAt', p.adult_confirmed_at, 'termsAcceptedAt', p.terms_accepted_at,
    'phone', (select phone from seller_checks where shop_id = sid),
    'bank', (select case when bank_name is null then null else bank_name || ' ending ' || bank_last4 end from seller_checks where shop_id = sid),
    'idFiles', (select jsonb_build_object('id', id_doc_path, 'selfie', selfie_path, 'cert', cert_path) from seller_checks where shop_id = sid),
    'liveListings', (select count(*) from products where shop_id = sid and status = 'live'),
    'orders', coalesce((select jsonb_agg(x order by x ->> 'createdAt' desc) from (
        select jsonb_build_object('id', o.id, 'createdAt', o.created_at, 'status', o.status, 'title', pr.title, 'totalCents', o.total_cents,
                 'side', case when o.buyer_id = p.id then 'bought' else 'sold' end, 'other', case when o.buyer_id = p.id then s.name else coalesce(b.handle, b.display_name) end) as x
        from orders o join products pr on pr.id = o.product_id join shops s on s.id = o.shop_id join profiles b on b.id = o.buyer_id
        where o.buyer_id = p.id or o.shop_id = sid order by o.created_at desc limit 20) t), '[]'::jsonb),
    'trustEvents', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'points', points, 'note', note, 'at', created_at) order by created_at desc)
        from (select * from trust_events where user_id = p.id order by created_at desc limit 20) t), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'targetKind', r.target_kind, 'details', r.details,
          'status', r.status, 'createdAt', r.created_at) order by r.created_at desc)
        from reports r where r.target_id = p.id or r.target_id = sid
          or r.target_id in (select po.id from posts po where po.shop_id = sid)
          or r.target_id in (select id from comments where user_id = p.id)), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'note', a.note, 'at', a.at, 'by', coalesce(ad.handle, ad.display_name)) order by a.at desc)
        from admin_actions a left join profiles ad on ad.id = a.admin_id where a.target_id in (p.id, sid)), '[]'::jsonb));
  return out;
end $$;

-- ===== Account and shop actions =====
create function admin_suspend(p_user uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only our team can do this.'; end if;
  if p_user = auth.uid() then raise exception 'You can''t suspend your own account.'; end if;
  if (select role from profiles where id = p_user) = 'admin' then raise exception 'Remove them from the team first.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Add a reason. The person sees it.'; end if;
  if is_suspended(p_user) then raise exception 'This account is already suspended.'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'Account not found.'; end if;
  insert into suspensions (user_id, reason, by_admin) values (p_user, left(trim(p_reason), 300), auth.uid());
  update shops set status = 'paused' where owner_id = p_user and status = 'open';
  perform notify(p_user, 'account', 'Your account is suspended', trim(p_reason) || ' You can still see your orders. Email support if you think this is a mistake.', null);
  perform log_admin('Suspended account', 'user', p_user, trim(p_reason));
end $$;

create function admin_unsuspend(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only our team can do this.'; end if;
  delete from suspensions where user_id = p_user;
  if not found then raise exception 'This account isn''t suspended.'; end if;
  update shops set status = 'open' where owner_id = p_user and status = 'paused';
  perform notify(p_user, 'account', 'Your account is active again', 'You can buy, sell and chat again.', null);
  perform log_admin('Lifted suspension', 'user', p_user, null);
end $$;

-- Open, pause or close a shop. Opening needs the ID and bank checks approved.
create function admin_set_shop_status(p_shop uuid, p_status shop_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s shops;
begin
  if not is_admin() then raise exception 'Only our team can do this.'; end if;
  select * into s from shops where id = p_shop for update;
  if s.id is null then raise exception 'Shop not found.'; end if;
  if p_status = 'onboarding' then raise exception 'Choose open, paused or closed.'; end if;
  if p_status = 'open' and not exists (select 1 from seller_checks where shop_id = p_shop and id_status = 'approved' and bank_status = 'approved') then
    raise exception 'Approve the ID and bank checks first.';
  end if;
  if p_status = 'open' and is_suspended(s.owner_id) then
    raise exception 'Lift the owner''s suspension first.';
  end if;
  if p_status <> 'open' and coalesce(trim(p_reason), '') = '' then raise exception 'Add a reason. The seller sees it.'; end if;
  update shops set status = p_status, opened_at = coalesce(opened_at, case when p_status = 'open' then now() end) where id = p_shop;
  if p_status = 'banned' then update products set status = 'removed', removed_reason = coalesce(removed_reason, 'Shop closed by our team') where shop_id = p_shop and status = 'live'; end if;
  perform notify(s.owner_id, 'shop',
    case p_status when 'open' then 'Your shop is open' when 'paused' then 'Your shop is paused' else 'Your shop is closed' end,
    coalesce(trim(p_reason), 'You can sell again.'), '/me?tab=selling');
  perform log_admin(case p_status when 'open' then 'Opened shop' when 'paused' then 'Paused shop' else 'Closed shop' end, 'shop', p_shop, p_reason);
end $$;

-- Add someone to the team or take them off. You can't change your own role, and the last team member stays.
create function admin_set_role(p_user uuid, p_role text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only our team can do this.'; end if;
  if p_role not in ('user', 'admin') then raise exception 'Unknown role.'; end if;
  if p_user = auth.uid() then raise exception 'Someone else on the team has to change your role.'; end if;
  if p_role = 'admin' and is_suspended(p_user) then raise exception 'Lift the suspension first.'; end if;
  update profiles set role = p_role where id = p_user and role <> p_role;
  if not found then return; end if;
  perform log_admin(case when p_role = 'admin' then 'Added to the team' else 'Removed from the team' end, 'user', p_user, null);
end $$;

-- ===== Orders =====
-- Filter: all, to_ship, late, returns, open (not finished), done.
create function admin_orders(p_q text default '', p_filter text default 'all', p_limit int default 50, p_offset int default 0)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(trim(coalesce(p_q, ''))) || '%';
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  return query
    select jsonb_build_object('id', o.id, 'createdAt', o.created_at, 'paidAt', o.paid_at, 'status', o.status, 'mode', o.mode,
      'title', pr.title, 'shopName', s.name, 'shopHandle', s.handle, 'sellerId', s.owner_id,
      'buyerId', o.buyer_id, 'buyer', coalesce(b.handle, b.display_name), 'totalCents', o.total_cents,
      'feeCents', o.seller_fee_cents + o.protection_fee_cents, 'creditCents', o.credit_cents, 'payoutCents', o.seller_payout_cents,
      'shipBy', o.ship_by, 'late', o.status = 'paid' and o.ship_by < now(), 'trackingRef', o.tracking_ref,
      'payoutStatus', (select status from payouts where order_id = o.id), 'payOn', (select pay_on from payouts where order_id = o.id),
      'returnReason', (select reason from returns where order_id = o.id), 'returnDetails', (select details from returns where order_id = o.id))
    from orders o join products pr on pr.id = o.product_id join shops s on s.id = o.shop_id join profiles b on b.id = o.buyer_id
    where (q = '%%' or lower(pr.title) like q or lower(s.name) like q or lower(coalesce(b.handle, '')) like q or o.id::text like q)
      and case p_filter
        when 'to_ship' then o.status = 'paid'
        when 'late' then o.status = 'paid' and o.ship_by < now()
        when 'returns' then o.status in ('return_requested', 'return_in_transit')
        when 'open' then o.status in ('paid', 'shipped', 'delivered', 'return_requested', 'return_in_transit')
        when 'done' then o.status in ('completed', 'refunded', 'cancelled')
        else o.status <> 'pending_payment' end
    order by o.created_at desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

-- ===== Listings =====
-- Filter: live, auctions, removed, proof (designer proof to check).
create function admin_listings(p_q text default '', p_filter text default 'live', p_limit int default 50, p_offset int default 0)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(trim(coalesce(p_q, ''))) || '%';
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  return query
    select jsonb_build_object('id', pr.id, 'title', pr.title, 'priceCents', pr.price_cents, 'mode', pr.mode, 'label', pr.label,
      'status', pr.status, 'stock', pr.stock, 'createdAt', pr.created_at, 'removedReason', pr.removed_reason, 'proofStatus', pr.proof_status,
      'shopId', s.id, 'shopName', s.name, 'shopHandle', s.handle, 'sellerId', s.owner_id, 'auctionState', pr.auction_state, 'auctionEndsAt', pr.auction_ends_at,
      'reports', (select count(*) from reports r where r.status = 'open' and r.target_id in (select id from posts where product_id = pr.id)))
    from products pr join shops s on s.id = pr.shop_id
    where (q = '%%' or lower(pr.title) like q or lower(s.name) like q or lower(s.handle) like q)
      and case p_filter
        when 'auctions' then pr.mode = 'auction' and pr.status in ('live', 'sold_out')
        when 'removed' then pr.status = 'removed'
        when 'proof' then pr.proof_status = 'pending'
        else pr.status = 'live' end
    order by pr.created_at desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

-- ===== Action log =====
create function admin_log(p_limit int default 100) returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only our team can see this.'; end if;
  return query
    select jsonb_build_object('id', a.id, 'action', a.action, 'targetKind', a.target_kind, 'targetId', a.target_id, 'note', a.note, 'at', a.at,
      'by', coalesce(ad.handle, ad.display_name, 'Team'),
      'target', case a.target_kind
        when 'user' then (select coalesce('@' || handle, display_name) from profiles where id = a.target_id)
        when 'shop' then (select name from shops where id = a.target_id)
        when 'product' then (select title from products where id = a.target_id)
        when 'order' then (select pr.title from orders o join products pr on pr.id = o.product_id where o.id = a.target_id)
        else null end)
    from admin_actions a left join profiles ad on ad.id = a.admin_id
    order by a.at desc limit least(greatest(p_limit, 1), 500);
end $$;

revoke execute on function admin_overview(), admin_people(text, text, int, int), admin_person(uuid), admin_suspend(uuid, text), admin_unsuspend(uuid),
  admin_set_shop_status(uuid, shop_status, text), admin_set_role(uuid, text), admin_orders(text, text, int, int), admin_listings(text, text, int, int), admin_log(int)
  from public, anon;
grant execute on function admin_overview(), admin_people(text, text, int, int), admin_person(uuid), admin_suspend(uuid, text), admin_unsuspend(uuid),
  admin_set_shop_status(uuid, shop_status, text), admin_set_role(uuid, text), admin_orders(text, text, int, int), admin_listings(text, text, int, int), admin_log(int)
  to authenticated;

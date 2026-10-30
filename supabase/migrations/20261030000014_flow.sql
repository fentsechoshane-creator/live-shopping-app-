-- Faster checkout, a better first feed, and error reports.

-- ===== Saved delivery details =====
-- Kept in their own table (not on profiles) because profiles are readable by other signed in users.
create table delivery_details (
  user_id uuid primary key references profiles (id) on delete cascade,
  delivery text check (delivery is null or length(delivery) <= 40),
  locker text check (locker is null or length(locker) <= 120),
  name text check (name is null or length(name) <= 80),
  phone text check (phone is null or length(phone) <= 20),
  address text check (address is null or length(address) <= 300),
  updated_at timestamptz not null default now()
);
alter table delivery_details enable row level security;
grant select, insert, update, delete on delivery_details to authenticated;
create policy "only you see your delivery details" on delivery_details for select to authenticated using (user_id = auth.uid());
create policy "only you save your delivery details" on delivery_details for insert to authenticated with check (user_id = auth.uid());
create policy "only you change your delivery details" on delivery_details for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "only you remove your delivery details" on delivery_details for delete to authenticated using (user_id = auth.uid());

-- ===== Interests picked on the welcome screens (used to order the first For You feed) =====
alter table profiles add column interests text[] not null default '{}'
  check (interests <@ array['clothes', 'beauty', 'food', 'designer']::text[]);
grant update (interests) on profiles to authenticated;

-- ===== Error reports from the app =====
-- Anyone can send one (even before signing in). Only the team can read them.
create table app_errors (
  id bigint generated always as identity primary key,
  user_id uuid references profiles (id) on delete set null default auth.uid(),
  message text not null check (length(message) between 1 and 500),
  stack text check (stack is null or length(stack) <= 4000),
  path text check (path is null or length(path) <= 200),
  platform text check (platform is null or length(platform) <= 20),
  version text check (version is null or length(version) <= 40),
  created_at timestamptz not null default now()
);
create index app_errors_created_idx on app_errors (created_at desc);
alter table app_errors enable row level security;
grant insert on app_errors to anon, authenticated;
grant select on app_errors to authenticated;
create policy "anyone can send an error report" on app_errors for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
create policy "the team reads error reports" on app_errors for select to authenticated using (is_admin());

-- Keep 30 days of error reports.
create function prune_app_errors() returns void language sql security definer set search_path = public as $$
  delete from app_errors where created_at < now() - interval '30 days';
$$;

-- Deleting an account also forgets its devices, saved delivery details and interests.
create or replace function forget_devices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.display_name = 'Deleted user' and old.display_name is distinct from 'Deleted user' then
    delete from device_tokens where user_id = new.id;
    delete from delivery_details where user_id = new.id;
    new.interests := '{}';
  end if;
  return new;
end $$;
drop trigger profiles_forget_devices on profiles;
create trigger profiles_forget_devices before update on profiles for each row execute function forget_devices();

-- ===== Link previews =====
-- What WhatsApp and others show when someone shares an item: title, price, shop and a picture.
-- Only items that are on sale (or just sold out) from open shops.
create function share_card(p_product uuid)
returns table (title text, price_cents int, shop_handle text, shop_name text, mux_playback_id text, image_path text)
language sql stable security definer set search_path = public as $$
  select p.title, p.price_cents, s.handle, s.name,
    (select m.mux_playback_id from posts po join media m on m.id = po.media_id
       where po.product_id = p.id and po.status = 'live' order by po.created_at desc limit 1),
    coalesce(
      (select m.storage_path from posts po join media m on m.id = po.media_id
         where po.product_id = p.id and po.status = 'live' and m.kind = 'image' order by po.created_at desc limit 1),
      (select lp.storage_path from listing_photos lp where lp.product_id = p.id order by lp.position limit 1))
  from products p join shops s on s.id = p.shop_id
  where p.id = p_product and p.status in ('live', 'sold_out') and s.status = 'open';
$$;
grant execute on function share_card(uuid) to anon, authenticated;

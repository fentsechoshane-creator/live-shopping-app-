-- Phone app push notifications: each signed in device registers its token here.
-- Sending happens in a server function once Apple (APNs) and Google (Firebase) keys are added. [Lehloma]
create table device_tokens (
  token text primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index device_tokens_user on device_tokens (user_id);
alter table device_tokens enable row level security;
grant select, insert, update, delete on device_tokens to authenticated;
create policy "own devices" on device_tokens for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Deleting an account also forgets its devices.
create or replace function forget_devices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.display_name = 'Deleted user' and old.display_name is distinct from 'Deleted user' then
    delete from device_tokens where user_id = new.id;
  end if;
  return new;
end $$;
create trigger profiles_forget_devices after update on profiles for each row execute function forget_devices();

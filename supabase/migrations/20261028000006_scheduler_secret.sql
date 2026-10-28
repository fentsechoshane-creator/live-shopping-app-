-- Secret for the scheduled job, kept in Supabase Vault so nobody has to copy it around.
-- pg_cron sends it in a header, and the run-due function checks it with cron_secret_ok().
do $$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_cron or pg_net not available here (fine for local tests)';
end $$;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'run_due_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'run_due_secret');
  end if;
end $$;

create function cron_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'run_due_secret' and decrypted_secret = p_secret);
$$;
revoke execute on function cron_secret_ok(text) from public, anon, authenticated;
grant execute on function cron_secret_ok(text) to service_role;

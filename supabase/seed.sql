-- Seed data for local development (runs after migrations on `supabase db reset`).
-- Test users are easiest to create by signing up in the app. Then make yourself an admin:
--   update profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
select 1;

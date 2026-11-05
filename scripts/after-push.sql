-- Paste into Supabase > SQL Editor AFTER `npm run push:live` has finished. Safe to run more than once.
-- 1. Schedules: team alerts every 5 minutes, phone notifications every minute (same secret as run-due, kept in the vault).
select cron.unschedule(jobname) from cron.job where jobname in ('team-alerts', 'push-notifications');
select cron.schedule('team-alerts', '*/5 * * * *', $$
  select net.http_post(url := 'https://gingqryoycwtzbfvfbln.supabase.co/functions/v1/team-alerts',
    headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'run_due_secret'), 'content-type', 'application/json'),
    body := '{}'::jsonb);
$$);
select cron.schedule('push-notifications', '* * * * *', $$
  select net.http_post(url := 'https://gingqryoycwtzbfvfbln.supabase.co/functions/v1/push-notifications',
    headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'run_due_secret'), 'content-type', 'application/json'),
    body := '{}'::jsonb);
$$);
-- 2. Make yourself a team member (change the email to the one you signed up with in the app).
update profiles set role = 'admin' where id = (select id from auth.users where email = 'YOUR-EMAIL-HERE');
-- 3. Check: should list run-due, team-alerts and push-notifications, and your account as admin.
select jobname, schedule from cron.job order by jobname;
select u.email, p.role from profiles p join auth.users u on u.id = p.id where p.role = 'admin';

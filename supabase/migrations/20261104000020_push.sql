-- Phone notifications: the push-notifications job (every minute) sends new in-app notifications to people's phones
-- and marks them pushed, so each one goes out once. Team alerts are pushed by team-alerts instead.
alter table notifications add column pushed_at timestamptz;
create index notifications_to_push on notifications (created_at) where pushed_at is null;
-- Nothing older than an hour is pushed (for example everything from before this was switched on).
update notifications set pushed_at = created_at where pushed_at is null;

-- A short bio on every profile, shown under the name. Owners can edit it.
alter table profiles add column bio text not null default '' check (length(bio) <= 150);
grant update (bio) on profiles to authenticated;

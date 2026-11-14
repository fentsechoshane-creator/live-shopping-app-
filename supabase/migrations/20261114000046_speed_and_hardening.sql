-- Speed and hardening before launch (14 Nov 2026), from Supabase's own performance and security checks.
-- Nothing here changes what anyone can see or do; it makes the same rules cheaper and tidier.

-- 1. Security rules asked "who is this user?" once per row. Wrapping auth.uid() / auth.role() / auth.jwt() in a
--    sub-select makes Postgres ask once per query. Same rule, much less work on big tables (58 rules).
do $$
declare
  r record;
  q text;
  c text;
  fix constant text := '\m(auth\.(uid|role|jwt))\(\)';
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := r.qual; c := r.with_check;
    if q is not null and q ~ fix and q !~* 'select auth\.(uid|role|jwt)\(\)' then
      q := regexp_replace(q, fix, '(select \1())', 'g');
      execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, q);
    end if;
    if c is not null and c ~ fix and c !~* 'select auth\.(uid|role|jwt)\(\)' then
      c := regexp_replace(c, fix, '(select \1())', 'g');
      execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, c);
    end if;
  end loop;
end $$;

-- 2. An index for every foreign key that has none (46), so lookups like "posts by shop", "orders for an item",
--    "followers of a shop" and "reviews of a shop" stay fast as tables grow, and deletes don't scan whole tables.
do $$
declare r record; name text;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conrelid as relid, c.conkey,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
           (select string_agg(a.attname, '_' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as colnames,
           (select relname from pg_class where oid = c.conrelid) as relname
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)
  loop
    name := left(r.relname || '_' || r.colnames || '_fk', 63);
    execute format('create index if not exists %I on %s (%s)', name, r.tbl, r.cols);
  end loop;
end $$;

-- 3. Background check functions (triggers) can't be called directly, but they were still listed as callable.
--    Take that away so the security check is clean.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prorettype = 'trigger'::regtype loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;
end $$;

-- 4. A small helper had no fixed search path.
alter function max_reply_seconds() set search_path = public;

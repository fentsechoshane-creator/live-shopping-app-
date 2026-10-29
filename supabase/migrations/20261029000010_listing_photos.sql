-- Extra photos on a listing (up to 10). The post's video or photo stays the cover; these show in the item sheet.
create table listing_photos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  storage_path text not null,
  position int not null default 0 check (position between 0 and 9),
  created_at timestamptz not null default now()
);
create index listing_photos_product on listing_photos (product_id, position);

alter table listing_photos enable row level security;
grant select on listing_photos to anon, authenticated;
grant insert, delete on listing_photos to authenticated;

create function owns_product(p_product uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from products p join shops s on s.id = p.shop_id where p.id = p_product and s.owner_id = auth.uid());
$$;
create function product_is_live(p_product uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from products where id = p_product and status = 'live');
$$;
create function listing_photo_count(p_product uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from listing_photos where product_id = p_product;
$$;

create policy "photos of live items are public" on listing_photos for select to anon, authenticated
  using (product_is_live(product_id) or owns_product(product_id));
create policy "sellers add photos to their own items" on listing_photos for insert to authenticated
  with check (owns_product(product_id) and storage_path like auth.uid()::text || '/%' and listing_photo_count(product_id) < 10);
create policy "sellers remove their own photos" on listing_photos for delete to authenticated using (owns_product(product_id));

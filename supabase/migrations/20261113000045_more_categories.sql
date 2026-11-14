-- More categories (Ofentse, 13 Nov 2026). Thrift becomes Fashion (new and pre loved). New: Perfume and fragrance, and
-- Home and furniture. Beauty covers makeup, skincare and hair. Second hand electronics stay out (stolen phones).
-- Order now (made to order) opens to Home and furniture and to Beauty as well as Food. Only Food needs the food
-- certificate; the others ship by courier like Buy now.
-- Appliances (anything that plugs in or takes batteries) must be new and sealed, with a receipt or warranty card that
-- our team checks first, the same way as designer proof.
-- Big furniture gets an Extra large courier size.

alter type shop_category add value if not exists 'fragrance';
alter type shop_category add value if not exists 'home';

-- Welcome screen interests.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%interests%' loop
    execute format('alter table profiles drop constraint %I', c);
  end loop;
end $$;
alter table profiles add constraint profiles_interests_check
  check (interests <@ array['clothes', 'beauty', 'food', 'designer', 'fragrance', 'home']::text[]);

-- Extra large parcels, on listings and on orders.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'products'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%parcel_size = ANY%' loop
    execute format('alter table products drop constraint %I', c);
  end loop;
  for c in select conname from pg_constraint where conrelid = 'orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%parcel_size = ANY%' loop
    execute format('alter table orders drop constraint %I', c);
  end loop;
end $$;
alter table products add constraint products_parcel_size_check check (parcel_size in ('small', 'medium', 'large', 'xl'));
alter table orders add constraint orders_parcel_size_check check (parcel_size in ('small', 'medium', 'large', 'xl'));

-- Appliances: new only, and the receipt or warranty is checked before going live.
alter table products add column appliance boolean not null default false;
alter table products add constraint products_appliance_new check (not appliance or label = 'new');
grant select (appliance) on products to anon, authenticated;
grant insert (appliance) on products to authenticated;
grant update (appliance) on products to authenticated;

create or replace function products_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ready record;
  cat text;
  admin boolean := is_admin() or auth.role() = 'service_role';
begin
  if not admin then
    if tg_op = 'INSERT' and new.proof_status not in ('not_started', 'pending') then
      raise exception 'Proof status is set by our team';
    end if;
    if tg_op = 'UPDATE' then
      if new.proof_status is distinct from old.proof_status and new.proof_status not in ('pending') then
        raise exception 'Proof status is set by our team';
      end if;
      if old.status = 'removed' and old.removed_reason is not null then
        raise exception 'This listing was removed by our team';
      end if;
      if new.removed_reason is distinct from old.removed_reason then
        raise exception 'Only our team can set a removal reason';
      end if;
      -- Marking a listing as an appliance later needs its own receipt check, even if other proof was approved.
      if new.appliance and not old.appliance and new.proof_status = 'approved' then
        new.proof_status := 'not_started';
      end if;
    end if;
  end if;

  -- Content checks run when a listing is created or its words change.
  if (tg_op = 'INSERT' or new.title is distinct from old.title or new.description is distinct from old.description
      or new.label is distinct from old.label) and looks_counterfeit(new.title || ' ' || new.description) then
    raise exception 'Replicas and fakes are not allowed. Selling counterfeit goods is an offence under the Counterfeit Goods Act.'
      using errcode = 'check_violation';
  end if;
  if new.label = 'unbranded_dupe' and mentions_brand(new.title || ' ' || new.description) then
    raise exception 'Unbranded dupes cannot mention a brand name.' using errcode = 'check_violation';
  end if;
  if new.label = 'pre_loved' and new.condition is null then
    raise exception 'Pick a condition for pre loved items.' using errcode = 'check_violation';
  end if;
  -- No second hand phones, laptops, tablets or consoles: an easy way to sell stolen goods. Same words as packages/core.
  if (tg_op = 'INSERT' or new.title is distinct from old.title or new.description is distinct from old.description
      or new.label is distinct from old.label) and new.label <> 'new'
     and (' ' || lower(new.title || ' ' || coalesce(new.description, ''))) ~ ' (iphone|samsung galaxy|cellphone|cell phone|smartphone|laptop|macbook|ipad|tablet|playstation|ps5|ps4|xbox|nintendo switch|airpods|smartwatch|apple watch)s?(?! ?(bag|sleeve|case|cover|stand|pouch|strap))' then
    raise exception 'Second hand phones, laptops, tablets and consoles are not allowed on myHaul.' using errcode = 'check_violation';
  end if;
  if new.appliance and new.label <> 'new' then
    raise exception 'Appliances must be new and sealed. Second hand appliances and electronics are not allowed.' using errcode = 'check_violation';
  end if;

  -- Going live checks run when a listing goes live or changes how it sells. Stock updates from orders
  -- (run by the server) must never fail, or a payment could not be recorded.
  if new.status = 'live' and not admin
     and (tg_op = 'INSERT' or old.status <> 'live' or new.mode <> old.mode or new.label <> old.label or new.appliance <> old.appliance) then
    select * into ready from seller_ready where shop_id = new.shop_id;
    select category::text into cat from shops where id = new.shop_id;
    if not coalesce(ready.can_sell, false) then
      raise exception 'Your shop goes live once your ID and bank account are checked.' using errcode = 'check_violation';
    end if;
    if new.mode = 'order_now' then
      if cat not in ('food', 'home', 'beauty') then
        raise exception 'Order now is for food, home and furniture, and beauty shops.' using errcode = 'check_violation';
      end if;
      if cat = 'food' and not ready.food_ok then
        raise exception 'Order now needs an approved Certificate of Acceptability.' using errcode = 'check_violation';
      end if;
    end if;
    if new.mode = 'auction' and feature_state(shop_owner(new.shop_id), 'auctions') <> 'on' and good_orders(new.shop_id) < 5 then
      raise exception 'Auctions unlock after 5 delivered orders with good ratings.' using errcode = 'check_violation';
    end if;
    if new.label = 'authentic_designer' and new.proof_status <> 'approved' then
      raise exception 'Designer items go live once we have checked the proof.' using errcode = 'check_violation';
    end if;
    if new.appliance and new.proof_status <> 'approved' then
      raise exception 'Appliances go live once we have checked the receipt or warranty card.' using errcode = 'check_violation';
    end if;
    if (select trust_score from profiles p join shops s on s.owner_id = p.id where s.id = new.shop_id) < 40 then
      raise exception 'Your account is under review.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- The blocked list shows each person's profile photo too (14 Nov: every account shows its photo).
drop function my_blocks();
create function my_blocks() returns table (user_id uuid, name text, shop_id uuid, shop_handle text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select b.blocked_id, coalesce(nullif(p.display_name, ''), 'User'), s.id, s.handle, p.avatar_path
  from blocks b join profiles p on p.id = b.blocked_id left join shops s on s.owner_id = b.blocked_id
  where b.blocker_id = auth.uid() order by b.created_at desc;
$$;
revoke execute on function my_blocks() from public, anon;
grant execute on function my_blocks() to authenticated;

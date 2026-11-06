-- Delivery stamps: TradeSafe reports Instant EFT as either OZOW or INSTANT_EFT (both are in its DepositMethod list,
-- seen in the live health check on 6 Nov 2026). Both clear straight away and cost us the same, so both earn a stamp.
create or replace function delivery_stamps_follow() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare left_ int;
begin
  if new.status is distinct from old.status then
    -- Unpaid or refunded: stamps used on this order come back.
    if new.status in ('cancelled', 'refunded') then
      update delivery_stamps set used_order_id = null where used_order_id = new.id;
    end if;
    -- Return window closed on an Instant EFT order of R200 or more: one stamp.
    if new.status = 'completed' and (new.payment_method ilike '%ozow%' or new.payment_method ilike '%instant%eft%')
       and new.item_price_cents >= 20000 then
      insert into delivery_stamps (user_id, earned_order_id) values (new.buyer_id, new.id) on conflict (earned_order_id) do nothing;
      if found then
        select count(*) into left_ from delivery_stamps where user_id = new.buyer_id and used_order_id is null;
        perform notify(new.buyer_id, 'reward',
          case when left_ >= 5 then 'Half price delivery unlocked' else format('Delivery stamp %s of 5', left_) end,
          case when left_ >= 5 then 'You have 5 Instant EFT stamps. Your next courier or locker delivery is half price.'
               else format('Paying with Instant EFT earned you a stamp. %s more for half price delivery.', 5 - left_) end,
          '/inbox');
      end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function delivery_stamps_follow() from public;

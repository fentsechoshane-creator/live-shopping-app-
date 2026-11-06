-- Cancelling paid orders (decided with Ofentse 7 Nov 2026).
-- Buyers: free within 1 hour of paying while not shipped; after that they ask, and the seller has 24 hours to accept
--   (no answer means cancelled; shipping it means declined). No trust points lost either way.
-- Sellers: can cancel before shipping; they lose 5 trust points (same as not shipping), unless it wasn't their fault:
--   the courier couldn't book (booking_failed_at) or the buyer had asked to cancel.
-- Our team: can cancel and refund any order, even after shipping, with a reason. Logged.
-- The refund itself happens in the order-action function (TradeSafe); these columns record who and why.
alter table orders add column cancelled_by text check (cancelled_by in ('buyer', 'seller', 'team', 'auto')),
  add column cancel_reason text check (length(cancel_reason) <= 300),
  add column cancel_requested_at timestamptz;

-- Same trigger as migration 0025, with who cancelled deciding the trust points and the messages.
create or replace function orders_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  seller uuid;
  title text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select s.owner_id into seller from shops s where s.id = new.shop_id;
  select p.title into title from products p where p.id = new.product_id;
  insert into order_events (order_id, from_status, to_status, actor_id) values (new.id, old.status, new.status, auth.uid());

  if new.status = 'paid' and new.oversold then
    -- Sold out before this payment cleared: no stock change, no "ship it" message. run-due refunds it, with no trust penalty.
    perform notify(new.buyer_id, 'order', 'Sorry, ' || title || ' sold out', 'Someone paid a moment before you. Your money is coming back in full.', '/orders/' || new.id);
  elsif new.status = 'paid' then
    update products set stock = greatest(stock - 1, 0),
      status = case when stock - 1 <= 0 and mode <> 'order_now' then 'sold_out'::product_status else status end
      where id = new.product_id;
    if new.credit_cents > 0 then update profiles set welcome_credit_used = true where id = new.buyer_id; end if;
    perform notify(seller, 'order', 'New order: ' || title, 'Ship within 2 days. The money is held safely until the return window closes.', '/sell/orders/' || new.id);
    perform notify(new.buyer_id, 'order', 'Payment received', 'Your money is held safely. We will tell you when ' || title || ' ships.', '/orders/' || new.id);
  elsif new.status = 'shipped' then
    if new.packing_media_id is not null and new.shipped_at - new.paid_at <= interval '48 hours' then
      perform add_trust_event(seller, 'fast_ship_with_video', new.id);
    end if;
    perform notify(new.buyer_id, 'order', 'On the way: ' || title, coalesce('Tracking: ' || new.tracking_ref, 'The seller has sent your order.'), '/orders/' || new.id);
  elsif new.status = 'delivered' then
    perform notify(new.buyer_id, 'order', 'Delivered: ' || title,
      case when new.mode = 'buy_now' then 'You have 7 days to return it if you change your mind.' else 'Tell us within the check period if something is wrong.' end,
      '/orders/' || new.id);
  elsif new.status = 'completed' then
    perform add_trust_event(seller, 'order_kept', new.id);
  elsif new.status = 'refunded' then
    if old.status = 'paid' and not new.oversold then
      -- Trust points only when it's the seller's doing: not shipped in time, or the seller cancelled for no good reason.
      -- No loss when the buyer cancelled (or asked and the seller agreed), our team cancelled, or the courier couldn't book.
      if new.cancelled_by is null or (new.cancelled_by = 'seller' and new.booking_failed_at is null and new.cancel_requested_at is null) then
        perform add_trust_event(seller, 'not_shipped', new.id, case when new.cancelled_by = 'seller' then 'Seller cancelled' else 'Refunded before shipping' end);
      end if;
      update products set stock = stock + 1, status = case when status = 'sold_out' then 'live'::product_status else status end
        where id = new.product_id;
    end if;
    perform notify(new.buyer_id, 'order', case when new.cancelled_by is not null then 'Order cancelled: ' || title else 'Refund on the way' end,
      'Your money is going back to your card or account.', '/orders/' || new.id);
    if new.cancelled_by in ('buyer', 'auto', 'team') then
      perform notify(seller, 'order', 'Order cancelled: ' || title,
        case new.cancelled_by when 'team' then 'Our team cancelled this order and refunded the buyer. Don''t ship it.'
          else 'The buyer cancelled before you shipped, so don''t ship it. No trust points lost.' end, '/sell/orders/' || new.id);
    end if;
  end if;
  return new;
end $$;

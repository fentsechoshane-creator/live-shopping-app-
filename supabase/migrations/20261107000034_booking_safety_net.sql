-- Courier booking safety net (decided with Ofentse 7 Nov 2026). When Bob Go refuses a booking as the seller ships, the
-- first time the seller gets 2 more days (ship_by moves, so no automatic refund or lost trust points) and our team is
-- alerted. booking_failed_at records that this happened, so the extra time is only given once.
alter table orders add column booking_failed_at timestamptz;

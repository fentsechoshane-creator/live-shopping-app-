import type { Cents } from "./money.ts";
import type { SellerTier } from "./trust.ts";

export type SaleMode = "buy_now" | "auction" | "order_now";

/**
 * How long after delivery (or handover for food) the buyer can still return or claim.
 * Buy now: 7 days, the ECT Act s44 cooling off period, which starts on delivery.
 * Auction: 2 day check for wrong or faulty items (auctions are excluded from s44 by s42(2)(b)).
 * Order now: 24 hour check (made to order or perishable goods are excluded by s42(2)(f)).
 */
export const RETURN_WINDOW_HOURS: Record<SaleMode, number> = {
  buy_now: 7 * 24,
  auction: 2 * 24,
  order_now: 24,
};

/** Seller must ship within this many hours of payment, or the order is refunded automatically. */
export const SHIP_DEADLINE_HOURS = 72;

const HOUR = 3600 * 1000;

/** When the money becomes releasable, if no claim is open. */
export function releasableAt(mode: SaleMode, deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + RETURN_WINDOW_HOURS[mode] * HOUR);
}

export function shipBy(paidAt: Date): Date {
  return new Date(paidAt.getTime() + SHIP_DEADLINE_HOURS * HOUR);
}

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** Adds working days (Monday to Friday). Public holidays are not handled yet. */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 8, 0, 0));
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) added++;
  }
  return d;
}

/** Next Friday on or after the given date (weekly payout run). */
export function nextFriday(from: Date): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 8, 0, 0));
  while (d.getUTCDay() !== 5 || d.getTime() < from.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * When the seller is paid. Trust tier only changes speed AFTER the return window closes, never before.
 * Returns null for restricted sellers: their payouts are held for manual review.
 */
export function payoutDate(tier: SellerTier, releasable: Date): Date | null {
  switch (tier) {
    case "top":
      return addWorkingDays(releasable, 1);
    case "trusted":
      return addWorkingDays(releasable, 2);
    case "standard":
      return nextFriday(releasable);
    case "restricted":
      return null;
  }
}

/** New sellers: 10% of each of their first 10 payouts is kept for 30 days as a reserve for late claims. */
export const RESERVE_RATE = 0.1;
export const RESERVE_PAYOUT_COUNT = 10;
export const RESERVE_DAYS = 30;

export function reserveFor(previousPayouts: number, amount: Cents): Cents {
  return previousPayouts < RESERVE_PAYOUT_COUNT ? Math.round(amount * RESERVE_RATE) : 0;
}

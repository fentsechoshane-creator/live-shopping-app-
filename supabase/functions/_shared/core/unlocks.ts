// GENERATED from packages/core/src by npm run sync-core. Do not edit here.
import { tierFor } from "./trust.ts";

export type Feature = "buy_now" | "order_now" | "videos" | "chat" | "timed_auction" | "go_live" | "live_auction";

export interface SellerState {
  verified: boolean;
  /** Delivered orders that were kept and not rated below 4 stars. */
  goodOrders: number;
  trustScore: number;
  category: "clothes" | "beauty" | "food" | "designer";
  foodCertApproved?: boolean;
}

export const GOOD_ORDERS_FOR_AUCTIONS = 5;

export function canUse(feature: Feature, s: SellerState): { ok: boolean; reason?: string } {
  if (!s.verified) return { ok: false, reason: "Verify your ID and bank account first." };
  if (tierFor(s.trustScore) === "restricted" && feature !== "chat")
    return { ok: false, reason: "Your account is under review." };
  switch (feature) {
    case "buy_now":
    case "videos":
    case "chat":
      return { ok: true };
    case "order_now":
      if (s.category !== "food") return { ok: false, reason: "Order now is for food sellers." };
      return s.foodCertApproved ? { ok: true } : { ok: false, reason: "Upload your Certificate of Acceptability. We check it within 2 working days." };
    case "timed_auction":
    case "go_live":
      return s.goodOrders >= GOOD_ORDERS_FOR_AUCTIONS
        ? { ok: true }
        : { ok: false, reason: `Unlocks after ${GOOD_ORDERS_FOR_AUCTIONS} delivered orders with good ratings (${s.goodOrders} so far).` };
    case "live_auction":
      if (s.goodOrders < GOOD_ORDERS_FOR_AUCTIONS)
        return { ok: false, reason: `Unlocks after ${GOOD_ORDERS_FOR_AUCTIONS} good orders and a trust score of 70.` };
      return s.trustScore >= 70 ? { ok: true } : { ok: false, reason: "Unlocks at a trust score of 70." };
  }
}

/** You need at least this much stock to go live: 5 items, or 5 of one item. */
export const MIN_LIVE_STOCK = 5;

/** Units a seller can sell on a live: the stock of their live Buy now listings. Made to order items do not count. */
export function liveStock(products: { status: string; mode: string; stock: number }[]): number {
  return products.filter((p) => p.status === "live" && p.mode === "buy_now").reduce((n, p) => n + Math.max(0, p.stock), 0);
}

/** Everything that stops a seller going live, stock first. Empty means they can go live. */
export function goLiveBlockers(s: SellerState, stock: number): string[] {
  const out: string[] = [];
  if (stock < MIN_LIVE_STOCK)
    out.push(`You can't go live without stock. Have at least ${MIN_LIVE_STOCK} items in stock, or ${MIN_LIVE_STOCK} of one item (you have ${stock}).`);
  const rule = canUse("go_live", s);
  if (!rule.ok && rule.reason) out.push(rule.reason);
  return out;
}

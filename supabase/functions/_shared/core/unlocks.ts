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

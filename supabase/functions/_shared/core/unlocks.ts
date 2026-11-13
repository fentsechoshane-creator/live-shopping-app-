// GENERATED from packages/core/src by npm run sync-core. Do not edit here.
import { tierFor } from "./trust.ts";
import { featureOffMessage, type AccountFeature, type FeatureState } from "./accountFeatures.ts";

export type Feature = "buy_now" | "order_now" | "videos" | "chat" | "timed_auction" | "go_live" | "live_auction";

export interface SellerState {
  verified: boolean;
  /** Delivered orders that were kept and not rated below 4 stars. */
  goodOrders: number;
  trustScore: number;
  category: "clothes" | "beauty" | "food" | "designer" | "fragrance" | "home";
  foodCertApproved?: boolean;
  /** Switches the team set for this account on the dashboard. Missing means auto. */
  overrides?: Partial<Record<AccountFeature, FeatureState>>;
}

/** Which team switch controls each seller feature. */
const SWITCH: Record<Feature, AccountFeature[]> = {
  buy_now: ["sell"], order_now: ["sell"], videos: ["sell"], chat: ["message"],
  timed_auction: ["sell", "auctions"], go_live: ["sell", "live"], live_auction: ["sell", "live", "auctions"],
};

export const GOOD_ORDERS_FOR_AUCTIONS = 5;
export const ORDER_NOW_CATEGORIES: SellerState["category"][] = ["food", "home", "beauty"];

export function canUse(feature: Feature, s: SellerState): { ok: boolean; reason?: string } {
  const off = SWITCH[feature].find((k) => s.overrides?.[k] === "off");
  if (off) return { ok: false, reason: featureOffMessage(off) };
  if (!s.verified) return { ok: false, reason: "Verify your ID and bank account first." };
  if (tierFor(s.trustScore) === "restricted" && feature !== "chat")
    return { ok: false, reason: "Your account is under review." };
  switch (feature) {
    case "buy_now":
    case "videos":
    case "chat":
      return { ok: true };
    case "order_now":
      // Made to order (13 Nov): food (needs the certificate), home and furniture, and beauty.
      if (!ORDER_NOW_CATEGORIES.includes(s.category)) return { ok: false, reason: "Order now is for food, home and furniture, and beauty shops." };
      if (s.category !== "food") return { ok: true };
      return s.foodCertApproved ? { ok: true } : { ok: false, reason: "Upload your Certificate of Acceptability. We check it within 2 working days." };
    case "timed_auction":
    case "go_live":
      // The team can switch on auctions or Live early. That skips the 5 orders milestone, never the checks above.
      if (s.overrides?.[feature === "timed_auction" ? "auctions" : "live"] === "on") return { ok: true };
      return s.goodOrders >= GOOD_ORDERS_FOR_AUCTIONS
        ? { ok: true }
        : { ok: false, reason: `Unlocks after ${GOOD_ORDERS_FOR_AUCTIONS} delivered orders with good ratings (${s.goodOrders} so far).` };
    case "live_auction":
      if (s.overrides?.live === "on" && s.overrides?.auctions === "on") return { ok: true };
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

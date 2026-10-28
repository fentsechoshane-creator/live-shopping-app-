// GENERATED from packages/core/src by npm run sync-core. Do not edit here.
export const TRUST_START = 50;
export const TRUST_MIN = 0;
export const TRUST_MAX = 100;

export type TrustEventKind =
  | "order_kept"
  | "fast_ship_with_video"
  | "five_star_review"
  | "verified"
  | "clean_quarter"
  | "not_as_described"
  | "flaw_not_shown"
  | "not_shipped"
  | "off_app_payment"
  | "unpaid_auction_win"
  | "return_claim_rejected"
  | "fake_reviews_or_shill_bidding";

/** Points for each event. Starting values, to be tuned during the Cape Town pilot. */
export const TRUST_POINTS: Record<TrustEventKind, number> = {
  order_kept: 2,
  fast_ship_with_video: 1,
  five_star_review: 1,
  verified: 10,
  clean_quarter: 5,
  not_as_described: -10,
  flaw_not_shown: -5,
  not_shipped: -5,
  off_app_payment: -10,
  unpaid_auction_win: -10,
  return_claim_rejected: -10,
  fake_reviews_or_shill_bidding: -20,
};

/** Counterfeit goods are not points: the listing is removed and the seller is banned. */
export const COUNTERFEIT_IS_BAN = true;

export const clampTrust = (n: number) => Math.max(TRUST_MIN, Math.min(TRUST_MAX, n));

export function scoreFrom(events: TrustEventKind[]): number {
  return events.reduce((s, e) => clampTrust(s + TRUST_POINTS[e]), TRUST_START);
}

export type SellerTier = "top" | "trusted" | "standard" | "restricted";

export function tierFor(score: number): SellerTier {
  if (score >= 90) return "top";
  if (score >= 70) return "trusted";
  if (score >= 40) return "standard";
  return "restricted";
}

export const TIER_INFO: Record<SellerTier, { label: string; range: string; perks: string }> = {
  top: { label: "Top seller", range: "90 to 100", perks: "Badge, featured in Explore, paid the next working day after returns close" },
  trusted: { label: "Trusted", range: "70 to 89", perks: "Auctions and lives, ranking boost, paid within 2 working days of returns closing" },
  standard: { label: "Standard", range: "40 to 69", perks: "Buy now and Order now, normal ranking, weekly payouts" },
  restricted: { label: "Restricted", range: "0 to 39", perks: "Hidden from the feed, payouts held for review, no auctions" },
};

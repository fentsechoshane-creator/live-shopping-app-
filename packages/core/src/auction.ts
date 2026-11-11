// Timed auctions. The database (migration 0016) uses the same numbers; keep them in step.

/** How long an auction can run, in days. */
export const AUCTION_DAYS = [1, 3, 5, 7] as const;
/** The winner has this long to pay. */
export const AUCTION_PAY_HOURS = 2;
/** A bid in the last 60 seconds resets the clock to 60 seconds (like eBay), so nobody wins by sniping. Decided 11 Nov 2026. */
export const AUCTION_EXTEND_SECONDS = 60;
/** Live auctions (in a show): a bid in the last 10 seconds resets the clock to 10, unless the seller picked sudden death. */
export const LIVE_AUCTION_EXTEND_SECONDS = 10;
/** How long a live auction can run, in seconds. */
export const LIVE_AUCTION_SECONDS = [15, 30, 60] as const;

/** The smallest raise over the current bid: R10 under R500, R20 under R2,000, then R50. */
export function bidStep(currentCents: number): number {
  if (currentCents < 50_000) return 1_000;
  if (currentCents < 200_000) return 2_000;
  return 5_000;
}

/** The lowest bid that will be accepted now. The first bid can be the starting price. */
export function nextMinBid(startCents: number, currentCents: number | null): number {
  return currentCents == null ? startCents : currentCents + bidStep(currentCents);
}

/** Checks a reserve against the starting price. Returns a problem, or null. */
export function reserveProblem(startCents: number, reserveCents: number | null): string | null {
  if (reserveCents == null) return null;
  if (reserveCents < startCents) return "The reserve can't be lower than the starting bid.";
  if (reserveCents > startCents * 10) return "Keep the reserve within 10 times the starting bid.";
  return null;
}

/** "2d 4h", "3h 12m", "4m 05s", or "Ended". */
export function timeLeft(ms: number): string {
  if (ms <= 0) return "Ended";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

/** Bidders are shown as t***a so people can see there's competition without seeing who. */
export function maskHandle(handle: string | null | undefined): string {
  if (!handle) return "Bidder";
  return handle.length <= 2 ? `${handle[0]}*` : `${handle[0]}***${handle[handle.length - 1]}`;
}

/** Someone's max bid: we bid for them, one step at a time, only when they're outbid, up to this. Nobody else sees it. */
export interface MaxBid { bidderId: string; maxCents: number; setAt: string }
export interface PlacedBid { bidderId: string; amountCents: number }

/**
 * The bids the app places for people with a max, after the top bid changes. Same steps as max_bid_replies in
 * migration 0039; keep them in step.
 * - A challenger whose max beats the next step takes the lead at the lowest amount that does it.
 * - Two people with a max: the higher max wins, at one step over the other max (or at its own max if that's less).
 *   On an equal max, whoever set theirs first wins.
 * - Someone outbid on their max shows a bid at their max, so the bid list makes sense.
 */
export function maxBidReplies(top: PlacedBid, maxes: MaxBid[]): PlacedBid[] {
  const out: PlacedBid[] = [];
  let t = top;
  // Each round knocks out at least one max, so this always ends; 100 is a safety limit.
  for (let i = 0; i < 100; i++) {
    const need = t.amountCents + bidStep(t.amountCents);
    const ch = maxes
      .filter((m) => m.bidderId !== t.bidderId && m.maxCents >= need)
      .sort((a, b) => b.maxCents - a.maxCents || a.setAt.localeCompare(b.setAt))[0];
    if (!ch) break;
    const mine = maxes.find((m) => m.bidderId === t.bidderId);
    const leaderMax = Math.max(t.amountCents, mine?.maxCents ?? 0);
    const leaderHolds = leaderMax > ch.maxCents || (leaderMax === ch.maxCents && !!mine && mine.setAt <= ch.setAt);
    if (leaderHolds) {
      // The leader's max holds.
      if (leaderMax > ch.maxCents) out.push({ bidderId: ch.bidderId, amountCents: ch.maxCents });
      out.push({ bidderId: t.bidderId, amountCents: Math.min(leaderMax, ch.maxCents + bidStep(ch.maxCents)) });
    } else {
      // The challenger takes over. Show the old leader's max first, if they had one above their bid.
      // (On an equal max the old leader's max isn't shown: two bids of the same amount would look like a tie.)
      if (leaderMax > t.amountCents && leaderMax < ch.maxCents) out.push({ bidderId: t.bidderId, amountCents: leaderMax });
      out.push({ bidderId: ch.bidderId, amountCents: Math.min(ch.maxCents, leaderMax + bidStep(leaderMax)) });
    }
    t = out[out.length - 1];
  }
  return out;
}

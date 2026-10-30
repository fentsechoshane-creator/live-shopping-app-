// Timed auctions. The database (migration 0016) uses the same numbers; keep them in step.

/** How long an auction can run, in days. */
export const AUCTION_DAYS = [1, 3, 5, 7] as const;
/** The winner has this long to pay. */
export const AUCTION_PAY_HOURS = 2;
/** A bid in the last 2 minutes adds 2 minutes, so nobody wins by sniping at the last second. */
export const AUCTION_EXTEND_MINUTES = 2;

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

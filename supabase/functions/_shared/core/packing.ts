// GENERATED from packages/core/src by npm run sync-core. Do not edit here.
// Packing proof: what a seller records before an order ships or is handed over. Same numbers as migration 0023.
// Decided with Ofentse on 2026-11-04 (docs/LOG.md).

/** The packing video must be at least this long, and at most PACKING_VIDEO_MAX_S. */
export const PACKING_VIDEO_MIN_S = 15;
export const PACKING_VIDEO_MAX_S = 120;
/** Strikes in this many days: 1 warning, 2 trust points lost, 3 listings paused. */
export const PACKING_STRIKE_DAYS = 90;
export const PACKING_STRIKES_TO_PAUSE = 3;
/** Kept this long after delivery (faulty item claims under the Consumer Protection Act), longer while a return is open. */
export const PACKING_KEEP_MONTHS = 6;
/** Links the team sends buyers expire after this many days. */
export const PACKING_SHARE_DAYS = 7;

/** What the video must show, in order, in one take. Shown to sellers before they film. */
export const PACKING_STEPS = [
  "Show the packing code (write it on the parcel or a slip)",
  "Show the item from every side, with any flaws, tags and size label",
  "Put the item in the bag or box",
  "Seal it, with the code still visible",
] as const;

/** Problems with a packing video before upload. Empty means fine. */
export function packingVideoProblems(seconds: number | null, bytes: number, maxBytes = 100 * 1024 * 1024): string[] {
  const out: string[] = [];
  if (seconds != null && seconds < PACKING_VIDEO_MIN_S) out.push(`The packing video is too short. Film at least ${PACKING_VIDEO_MIN_S} seconds.`);
  if (seconds != null && seconds > PACKING_VIDEO_MAX_S) out.push(`The packing video is too long. Keep it under ${PACKING_VIDEO_MAX_S / 60} minutes.`);
  if (bytes > maxBytes) out.push("The video file is too big. Film a shorter video, or set your camera to 1080p.");
  return out;
}

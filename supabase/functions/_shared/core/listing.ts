// GENERATED from packages/core/src by npm run sync-core. Do not edit here.
import type { Cents } from "./money.ts";
import { rand } from "./money.ts";

export type ListingLabel = "new" | "pre_loved" | "authentic_designer" | "unbranded_dupe";
export type Condition = "new" | "like_new" | "good" | "fair";

export const LISTING_LABELS: Record<ListingLabel, { label: string; help: string }> = {
  new: { label: "New", help: "Unused, with tags" },
  pre_loved: { label: "Pre loved", help: "Pick a condition and show every flaw on video" },
  authentic_designer: { label: "Authentic designer", help: "Upload a receipt, tags or other proof. We check it before the listing goes live." },
  unbranded_dupe: { label: "Unbranded dupe", help: "Similar style only. No brand names or logos anywhere." },
};

/**
 * Brand words that may not appear in an unbranded dupe listing.
 * Copies with brand marks are counterfeit goods (Counterfeit Goods Act 37 of 1997), even if called "reps".
 * [CONFIRM] extend this list and add image checks later.
 */
export const BLOCKED_BRAND_WORDS = [
  "nike", "adidas", "jordan", "gucci", "louis vuitton", "lv", "prada", "balenciaga", "dior", "chanel",
  "yeezy", "off white", "supreme", "puma", "new balance", "zara", "versace", "fendi", "burberry", "hermes",
];
const COUNTERFEIT_WORDS = ["replica", "reps", "rep ", "fake", "1:1", "aaa grade", "mirror quality", "inspired by"];

export interface ListingInput {
  title: string;
  description?: string;
  price: Cents;
  label: ListingLabel;
  condition?: Condition;
  hasProof?: boolean;
  mode: "buy_now" | "order_now" | "auction";
  /** Plugs in or takes batteries (13 Nov): new and sealed only, with a receipt or warranty card we check. */
  appliance?: boolean;
}

/** Second hand electronics are not allowed: an easy way to sell stolen phones (Ofentse, 13 Nov). */
export const BANNED_ELECTRONICS_WORDS = ["iphone", "samsung galaxy", "cellphone", "cell phone", "smartphone", "laptop", "macbook",
  "ipad", "tablet", "playstation", "ps5", "ps4", "xbox", "nintendo switch", "airpods", "smartwatch", "apple watch"];

// TradeSafe refuses payments under about R49 (R42.61 before VAT, seen live on 6 Nov 2026), so nothing on myHaul
// sells for less than R50. Checkout checks the final amount too (offers and bundles can be lower than a listing).
export const MIN_PRICE = rand(50);
export const MAX_PRICE = rand(50000);

export function validateListing(l: ListingInput): string[] {
  const errors: string[] = [];
  const text = ` ${(l.title + " " + (l.description ?? "")).toLowerCase()} `;
  if (l.title.trim().length < 4) errors.push("Add a title of at least 4 characters.");
  if (l.price < MIN_PRICE) errors.push("The lowest price is R50.");
  if (l.price > MAX_PRICE) errors.push("The highest price is R50,000.");
  if (COUNTERFEIT_WORDS.some((w) => text.includes(w)))
    errors.push("Replicas and fakes are not allowed. Selling counterfeit goods is an offence under the Counterfeit Goods Act.");
  if (l.label === "unbranded_dupe" && BLOCKED_BRAND_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(text)))
    errors.push("Unbranded dupes cannot mention a brand name.");
  if (l.label === "pre_loved" && !l.condition) errors.push("Pick a condition for pre loved items.");
  if (l.label === "authentic_designer" && !l.hasProof) errors.push("Upload proof that the item is authentic.");
  if (l.appliance && l.label !== "new") errors.push("Appliances must be new and sealed. Second hand appliances are not allowed.");
  if (l.appliance && !l.hasProof) errors.push("Add a photo of the receipt or warranty card.");
  // Bags, cases and sleeves for them are fine.
  if (l.label !== "new" && BANNED_ELECTRONICS_WORDS.some((w) => new RegExp(` ${w}s?(?! ?(bag|sleeve|case|cover|stand|pouch|strap))`).test(text)))
    errors.push("Second hand phones, laptops, tablets and consoles are not allowed on myHaul.");
  return errors;
}

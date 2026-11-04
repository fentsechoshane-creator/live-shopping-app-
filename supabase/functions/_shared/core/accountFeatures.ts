// GENERATED from packages/core/src by npm run sync-core. Do not edit here.
// Per account switches the team sets on the dashboard. Each feature is "auto" (the normal rules and milestones decide),
// "on" or "off". The database enforces every switch (migration 0021); the app only reads them to show the right screens.
//
// "On" only skips a milestone (like 5 good orders for auctions). It never skips a legal or safety check:
// ID and bank checks, the food certificate, designer proof, adult confirmation and suspensions always apply.
// That's why some features can only be turned off.

export type AccountFeature =
  | "buy" | "bid" | "comment" | "message" | "welcome_credit"
  | "sell" | "auctions" | "live" | "offers" | "in_feed" | "payouts";

export type FeatureState = "auto" | "on" | "off";

export interface AccountFeatureInfo {
  key: AccountFeature;
  side: "buying" | "selling";
  label: string;
  /** What "auto" means: the normal rule. */
  auto: string;
  /** What "on" does, when the team may force it on. Null means it can only be turned off. */
  on: string | null;
  /** What "off" does. */
  off: string;
}

export const ACCOUNT_FEATURES: AccountFeatureInfo[] = [
  { key: "buy", side: "buying", label: "Buying", auto: "Anyone signed in and set up can buy.", on: null, off: "Can't place orders." },
  { key: "bid", side: "buying", label: "Bidding", auto: "Anyone signed in and set up can bid.", on: null, off: "Can't bid on auctions." },
  { key: "comment", side: "buying", label: "Comments", auto: "Anyone signed in can comment.", on: null, off: "Can't comment." },
  { key: "message", side: "buying", label: "Messages", auto: "Anyone signed in can message shops.", on: null, off: "Can't start chats or send messages." },
  { key: "welcome_credit", side: "buying", label: "Surprise rewards", auto: "R50 after a first delivered order, auction win and sale.", on: null, off: "Gets no rewards and can't use any." },
  { key: "sell", side: "selling", label: "Listing items", auto: "After the ID and bank checks.", on: null, off: "Can't put items or videos live." },
  { key: "auctions", side: "selling", label: "Auctions", auto: "After 5 delivered orders with good ratings.", on: "Can run auctions now, before 5 orders.", off: "Can't start auctions." },
  { key: "live", side: "selling", label: "Live selling", auto: "After 5 good orders, once Live is released.", on: "Early access, even before Live is released to everyone.", off: "Can't go live." },
  { key: "offers", side: "selling", label: "Special prices in chat", auto: "Every open shop.", on: null, off: "Can't send special prices or bundles." },
  { key: "in_feed", side: "selling", label: "Shown in the feed", auto: "Trust score of 40 or more.", on: "Shown even with a low trust score.", off: "Hidden from the feed. The shop page still works." },
  { key: "payouts", side: "selling", label: "Payouts", auto: "Paid by trust tier after the return window. Restricted sellers are held.", on: "Paid on time even when Restricted.", off: "All payouts held until turned back." },
];

export const ACCOUNT_FEATURE_KEYS = ACCOUNT_FEATURES.map((f) => f.key);

export function canForceOn(key: AccountFeature): boolean {
  return ACCOUNT_FEATURES.find((f) => f.key === key)?.on != null;
}

/** The message people see when the team has turned something off for them. */
export function featureOffMessage(key: AccountFeature, contact = "help@myhaul.co.za"): string {
  const f = ACCOUNT_FEATURES.find((x) => x.key === key);
  return `${f?.label ?? "This"} is turned off for your account. Email ${contact} if you think this is a mistake.`;
}

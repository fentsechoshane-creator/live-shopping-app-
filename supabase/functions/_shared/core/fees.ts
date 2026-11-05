// GENERATED from packages/core/src by npm run sync-core. Do not edit here.
import { type Cents, rand, roundToRand } from "./money.ts";

/** Our cut of each sale, paid by the seller. */
export const SELLER_FEE_RATE = 0.06;
/** Founding sellers pay no seller fee for this many days after their shop opens. */
export const FOUNDING_FREE_DAYS = 90;

/**
 * Buyer protection fee, paid by the buyer on top of the item price.
 * R5 under R150, R12 from R150 to R500, 3.5% above R500 (rounded to whole rand).
 */
export function protectionFee(itemPrice: Cents): Cents {
  if (itemPrice < rand(150)) return rand(5);
  if (itemPrice <= rand(500)) return rand(12);
  return roundToRand(itemPrice * 0.035);
}

export function sellerFee(itemPrice: Cents, opts: { foundingUntil?: Date | null; at?: Date } = {}): Cents {
  const at = opts.at ?? new Date();
  if (opts.foundingUntil && at < opts.foundingUntil) return 0;
  return Math.round(itemPrice * SELLER_FEE_RATE);
}

/** Reward credit: R50 off an order of R200 or more, one reward per order. Rewards are surprises after a first
 * delivered order, auction win or sale (migration 0024), not given at sign up. The names stay for history. */
export const WELCOME_CREDIT: Cents = rand(50);
export const WELCOME_CREDIT_MIN_ORDER: Cents = rand(200);

export type DeliveryOption = "pudo_locker" | "courier" | "collect_cpt" | "baker_delivers" | "collect_baker";

/** Parcel sizes the seller picks when listing. Delivery is priced by size (decided with Ofentse, 6 Nov 2026), so
 * big parcels can't sink us. Anything bigger than Large is collection only. */
export type ParcelSize = "small" | "medium" | "large";
export const PARCEL_SIZES: Record<ParcelSize, { label: string; hint: string; maxKg: number; door: Cents; locker: Cents | null;
  /** What we book with the courier (centimetres). */ box: { length: number; width: number; height: number } }> = {
  small: { label: "Small", hint: "Clothes, shoes, beauty. Fits a shoe box, up to 2 kg.", maxKg: 2, door: rand(90), locker: rand(60), box: { length: 35, width: 25, height: 12 } },
  medium: { label: "Medium", hint: "Boots, a bag, a few items. Up to 5 kg.", maxKg: 5, door: rand(120), locker: rand(80), box: { length: 45, width: 35, height: 20 } },
  large: { label: "Large", hint: "Small appliance or decor. Up to 15 kg. Too big for lockers.", maxKg: 15, door: rand(180), locker: null, box: { length: 60, width: 45, height: 40 } },
};
export const PARCEL_SIZE_IDS = Object.keys(PARCEL_SIZES) as ParcelSize[];

/** The parcel size for an order: the biggest item, and at least Medium for 3 or more items in a bundle. */
export function orderParcelSize(sizes: (ParcelSize | null | undefined)[]): ParcelSize {
  const rank: ParcelSize[] = ["small", "medium", "large"];
  let r = Math.max(0, ...sizes.map((s) => rank.indexOf(s ?? "small")));
  if (sizes.length >= 3) r = Math.max(r, 1);
  return rank[r];
}

/** Deliveries we book through Bob Go. The buyer's delivery fee stays with us to pay the courier. */
export const BOOKED_BY_US: DeliveryOption[] = ["courier", "pudo_locker"];
export const bookedByUs = (d: DeliveryOption) => BOOKED_BY_US.includes(d);

/** Price of a delivery option for a parcel size. Null when the option can't take that size. */
export function deliveryFee(delivery: DeliveryOption, parcel: ParcelSize = "small"): Cents | null {
  if (delivery === "courier") return PARCEL_SIZES[parcel].door;
  if (delivery === "pudo_locker") return PARCEL_SIZES[parcel].locker;
  return DELIVERY_OPTIONS[delivery].fee;
}

export const DELIVERY_OPTIONS: Record<DeliveryOption, { label: string; fee: Cents; days: string; foodOnly?: boolean }> = {
  // Courier and locker fees here are the Small prices; use deliveryFee() for the real price by size.
  pudo_locker: { label: "PUDO locker", fee: rand(60), days: "2 to 4 days" },
  courier: { label: "Courier to your door", fee: rand(90), days: "2 to 4 days" },
  collect_cpt: { label: "Free collection, Cape Town", fee: 0, days: "2 to 3 days" },
  collect_baker: { label: "Collect from the baker", fee: 0, days: "On your date", foodOnly: true },
  baker_delivers: { label: "Baker delivers", fee: rand(40), days: "On your date", foodOnly: true },
};

export interface OrderTotalsInput {
  itemPrice: Cents;
  delivery: DeliveryOption;
  /** The item's parcel size (courier and locker prices depend on it). Small if not given. */
  parcelSize?: ParcelSize;
  /** True when the buyer has a reward ready to use. */
  welcomeCreditAvailable?: boolean;
  foundingUntil?: Date | null;
  at?: Date;
}

export interface OrderTotals {
  itemPrice: Cents;
  deliveryFee: Cents;
  protectionFee: Cents;
  creditUsed: Cents;
  /** What the buyer pays. */
  total: Cents;
  sellerFee: Cents;
  /** What the seller is paid out once the return window closes: item - seller fee, plus the delivery fee only when
   * the seller delivers themselves (baker delivers). Courier and locker fees stay with us to pay Bob Go. */
  sellerPayout: Cents;
  /** The part of the delivery fee we keep to pay the courier (courier and locker orders). */
  deliveryKept: Cents;
  /** What we keep before escrow and payment costs (seller fee + protection fee - welcome credit). Can be negative. */
  platformRevenue: Cents;
  /** Our fee taken inside escrow (never below zero). */
  escrowAgentFee: Cents;
  /** When the welcome credit is bigger than our cut, we pay the seller this difference ourselves, from the credit budget. */
  creditTopUp: Cents;
}

export function orderTotals(input: OrderTotalsInput): OrderTotals {
  const fee0 = deliveryFee(input.delivery, input.parcelSize);
  if (fee0 === null) throw new Error("That delivery option can't take this parcel size.");
  const deliveryFeeCents = fee0;
  const deliveryKept = bookedByUs(input.delivery) ? deliveryFeeCents : 0;
  const protect = protectionFee(input.itemPrice);
  const fee = sellerFee(input.itemPrice, { foundingUntil: input.foundingUntil, at: input.at });
  // The welcome credit is a discount we fund. Escrow holds what the buyer paid, so if the credit is bigger
  // than our cut on the order, we pay the seller the difference ourselves (creditTopUp).
  const creditUsed = input.welcomeCreditAvailable && input.itemPrice >= WELCOME_CREDIT_MIN_ORDER ? WELCOME_CREDIT : 0;
  const total = input.itemPrice + deliveryFeeCents + protect - creditUsed;
  // Inside escrow our share is our fees plus the courier money; the seller gets the rest.
  const ours = fee + protect + deliveryKept;
  return {
    itemPrice: input.itemPrice,
    deliveryFee: deliveryFeeCents,
    protectionFee: protect,
    creditUsed,
    total,
    sellerFee: fee,
    sellerPayout: input.itemPrice + deliveryFeeCents - deliveryKept - fee,
    deliveryKept,
    platformRevenue: fee + protect - creditUsed,
    escrowAgentFee: Math.max(0, ours - creditUsed),
    creditTopUp: Math.max(0, creditUsed - ours),
  };
}

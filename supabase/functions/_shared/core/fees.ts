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

/** Welcome credit: R50 off a buyer's first order of R200 or more. */
export const WELCOME_CREDIT: Cents = rand(50);
export const WELCOME_CREDIT_MIN_ORDER: Cents = rand(200);

export type DeliveryOption = "pudo_locker" | "courier" | "collect_cpt" | "baker_delivers" | "collect_baker";

export const DELIVERY_OPTIONS: Record<DeliveryOption, { label: string; fee: Cents; days: string; foodOnly?: boolean }> = {
  pudo_locker: { label: "PUDO locker", fee: rand(60), days: "2 to 4 days" },
  courier: { label: "The Courier Guy to your door", fee: rand(90), days: "2 to 4 days" },
  collect_cpt: { label: "Free collection, Cape Town", fee: 0, days: "2 to 3 days" },
  collect_baker: { label: "Collect from the baker", fee: 0, days: "On your date", foodOnly: true },
  baker_delivers: { label: "Baker delivers", fee: rand(40), days: "On your date", foodOnly: true },
};

export interface OrderTotalsInput {
  itemPrice: Cents;
  delivery: DeliveryOption;
  /** True if this is the buyer's first paid order and they have not used the welcome credit. */
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
  /** What the seller is paid out once the return window closes (item + delivery - seller fee). */
  sellerPayout: Cents;
  /** What we keep before escrow and payment costs (seller fee + protection fee - credit we fund). */
  platformRevenue: Cents;
}

export function orderTotals(input: OrderTotalsInput): OrderTotals {
  const deliveryFee = DELIVERY_OPTIONS[input.delivery].fee;
  const protect = protectionFee(input.itemPrice);
  const fee = sellerFee(input.itemPrice, { foundingUntil: input.foundingUntil, at: input.at });
  // The credit is funded from our own cut, because escrow can only pay out what the buyer deposited.
  // So it can never be more than the seller fee plus protection fee on that order. [CONFIRM] keep this cap,
  // or top up sellers from our own account so the full R50 always applies.
  const creditUsed =
    input.welcomeCreditAvailable && input.itemPrice >= WELCOME_CREDIT_MIN_ORDER
      ? Math.min(WELCOME_CREDIT, Math.floor((fee + protect) / 100) * 100) // whole rand, so totals stay tidy
      : 0;
  const total = input.itemPrice + deliveryFee + protect - creditUsed;
  return {
    itemPrice: input.itemPrice,
    deliveryFee,
    protectionFee: protect,
    creditUsed,
    total,
    sellerFee: fee,
    sellerPayout: input.itemPrice + deliveryFee - fee,
    platformRevenue: fee + protect - creditUsed,
  };
}

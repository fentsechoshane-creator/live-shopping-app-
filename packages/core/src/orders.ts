export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "shipped"
  | "delivered"
  | "return_requested"
  | "return_in_transit"
  | "refunded"
  | "completed"
  | "cancelled";

/** Allowed status changes. The database enforces the same table (see supabase/migrations). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["shipped", "refunded", "cancelled"],
  shipped: ["delivered", "refunded"],
  delivered: ["return_requested", "completed", "refunded"],
  return_requested: ["return_in_transit", "completed", "refunded"],
  return_in_transit: ["refunded", "completed"],
  refunded: [],
  completed: [],
  cancelled: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus) => ORDER_TRANSITIONS[from].includes(to);

export const ORDER_STATUS_TEXT: Record<OrderStatus, { buyer: string; seller: string }> = {
  pending_payment: { buyer: "Waiting for payment", seller: "Waiting for payment" },
  paid: { buyer: "Paid, money held safely", seller: "Ship within 2 days" },
  shipped: { buyer: "On the way", seller: "Shipped" },
  delivered: { buyer: "Delivered. Return window open", seller: "Delivered. Paid when returns close" },
  return_requested: { buyer: "Return requested", seller: "Buyer asked to return" },
  return_in_transit: { buyer: "Return on the way", seller: "Return on the way to you" },
  refunded: { buyer: "Refunded", seller: "Refunded to buyer" },
  completed: { buyer: "Complete", seller: "Payout scheduled" },
  cancelled: { buyer: "Cancelled", seller: "Cancelled" },
};

export type ReturnReason = "changed_mind" | "not_as_described" | "wrong_item" | "faulty";

/** Who pays the return postage. Change of mind: the buyer (ECT Act s44 allows only the direct return cost). */
export const RETURN_POSTAGE_PAYER: Record<ReturnReason, "buyer" | "seller"> = {
  changed_mind: "buyer",
  not_as_described: "seller",
  wrong_item: "seller",
  faulty: "seller",
};

/** Change of mind is only allowed for Buy now. Auctions and made to order food are excluded by ECT Act s42(2). */
export function returnReasonsFor(mode: "buy_now" | "auction" | "order_now"): ReturnReason[] {
  return mode === "buy_now" ? ["changed_mind", "not_as_described", "wrong_item", "faulty"] : ["not_as_described", "wrong_item", "faulty"];
}

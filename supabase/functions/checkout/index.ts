// Creates an order and an escrow transaction, and returns the payment link.
// Prices are always worked out here on the server, never trusted from the app.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser, must } from "../_shared/supabase.ts";
import { escrow, ESCROW_DAYS } from "../_shared/escrow.ts";
import { orderTotals, DELIVERY_OPTIONS, type DeliveryOption } from "../_shared/core/index.ts";

const NON_FOOD: DeliveryOption[] = ["pudo_locker", "courier", "collect_cpt"];
const FOOD: DeliveryOption[] = ["collect_baker", "baker_delivers"];

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const uid = await requireUser(req, db);
  const { productId, size, delivery, deliveryDetails = {}, foodDate, foodSlot, foodMessage } = body ?? {};
  if (!productId) throw new UserError("Pick an item first.");
  if (!(delivery in DELIVERY_OPTIONS)) throw new UserError("Pick a delivery option.");

  const product = must(
    await db.from("products")
      .select("id, title, price_cents, mode, sizes, stock, status, lead_days, shop_id, shops!inner(id, owner_id, status, name, founding_until, seller_checks(escrow_token))")
      .eq("id", productId).single(),
    "load product",
  ) as any;
  const shop = product.shops;
  if (product.status !== "live" || shop.status !== "open") throw new UserError("This item is no longer available.");
  if (shop.owner_id === uid) throw new UserError("You cannot buy your own item.");
  if (product.mode === "auction") throw new UserError("Auctions are not open yet.");
  if (product.mode === "buy_now" && product.stock < 1) throw new UserError("Sold out.");
  if (product.sizes?.length && !product.sizes.includes(size)) throw new UserError("Pick a size.");
  const allowed = product.mode === "order_now" ? FOOD : NON_FOOD;
  if (!allowed.includes(delivery)) throw new UserError("That delivery option is not available for this item.");
  if (delivery === "pudo_locker" && !deliveryDetails.locker) throw new UserError("Pick a PUDO locker.");
  if (delivery === "courier" && !(deliveryDetails.address && deliveryDetails.name && deliveryDetails.phone))
    throw new UserError("Add your name, phone and address for the courier.");
  if (product.mode === "order_now") {
    const earliest = new Date(Date.now() + (product.lead_days ?? 2) * 86400_000).toISOString().slice(0, 10);
    if (!foodDate || foodDate < earliest) throw new UserError(`Pick a date from ${earliest}.`);
    if (!foodSlot) throw new UserError("Pick a time slot.");
  }
  const sellerToken = shop.seller_checks?.escrow_token;
  if (!sellerToken) throw new UserError("This seller cannot take payments yet.");

  // Welcome credit: first paid order only.
  const profile = must(await db.from("profiles").select("welcome_credit_used").eq("id", uid).single(), "load profile") as any;
  const { count: paidBefore } = await db.from("orders").select("id", { count: "exact", head: true })
    .eq("buyer_id", uid).not("status", "in", "(pending_payment,cancelled)");

  const t = orderTotals({
    itemPrice: product.price_cents,
    delivery,
    welcomeCreditAvailable: !profile.welcome_credit_used && (paidBefore ?? 0) === 0,
    foundingUntil: shop.founding_until ? new Date(shop.founding_until) : null,
  });

  const es = escrow();
  // Buyer's escrow token, created once.
  let buyerToken = (await db.from("escrow_parties").select("token").eq("user_id", uid).maybeSingle()).data?.token as string | undefined;
  if (!buyerToken) {
    const { data: u } = await db.auth.admin.getUserById(uid);
    const name = (deliveryDetails.name ?? u.user?.user_metadata?.display_name ?? "Buyer").trim().split(/\s+/);
    buyerToken = await es.createParty({
      givenName: name[0], familyName: name.slice(1).join(" ") || name[0],
      email: u.user?.email ?? "", mobile: deliveryDetails.phone ?? u.user?.phone ?? "",
    });
    must(await db.from("escrow_parties").insert({ user_id: uid, token: buyerToken }), "save buyer token");
  }

  const orderId = crypto.randomUUID();
  must(await db.from("orders").insert({
    id: orderId, buyer_id: uid, shop_id: shop.id, product_id: product.id, mode: product.mode, size: size ?? null,
    item_price_cents: t.itemPrice, delivery, delivery_fee_cents: t.deliveryFee, protection_fee_cents: t.protectionFee,
    credit_cents: t.creditUsed, total_cents: t.total, seller_fee_cents: t.sellerFee, seller_payout_cents: t.sellerPayout,
    delivery_details: deliveryDetails, food_date: foodDate ?? null, food_slot: foodSlot ?? null, food_message: foodMessage ?? null,
  }), "create order");

  const days = ESCROW_DAYS[product.mode as keyof typeof ESCROW_DAYS];
  const tx = await es.createTransaction({
    reference: orderId,
    title: product.title.slice(0, 60),
    description: `${product.title} from ${shop.name}`,
    buyerToken, sellerToken,
    amountCents: t.total,
    agentFeeCents: t.total - t.sellerPayout,
    daysToDeliver: days.deliver, daysToInspect: days.inspect,
  });
  const checkoutUrl = await es.checkoutUrl(tx.transactionId, orderId);
  must(await db.from("orders").update({
    escrow_transaction_id: tx.transactionId, escrow_allocation_id: tx.allocationId, checkout_url: checkoutUrl,
  }).eq("id", orderId), "save escrow ids");

  return json({ orderId, checkoutUrl, totals: t, mode: es.mode });
}));

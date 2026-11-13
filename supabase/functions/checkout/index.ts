// Creates an order and an escrow transaction, and returns the payment link.
// Prices are always worked out here on the server, never trusted from the app.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser, must } from "../_shared/supabase.ts";
import { escrow, ESCROW_DAYS } from "../_shared/escrow.ts";
import { orderTotals, MIN_PRICE, DELIVERY_OPTIONS, bookedByUs, deliveryFee, PARCEL_SIZES, type DeliveryOption } from "../_shared/core/index.ts";
import { cleanAddress, orderParcelSize, requireDelivery } from "../_shared/bobgo.ts";
import { checkRoute } from "../_shared/route.ts";

const NON_FOOD: DeliveryOption[] = ["pudo_locker", "courier", "collect_cpt"];
const FOOD: DeliveryOption[] = ["collect_baker", "baker_delivers"];

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const uid = await requireUser(req, db);
  const { productId, size, delivery, deliveryDetails = {}, foodDate, foodSlot, foodMessage, offerId, pickupPoint } = body ?? {};
  if (!productId || typeof productId !== "string") throw new UserError("Pick an item first.");
  // Sizes and types of everything the app sends, so odd input can't break or bloat an order.
  if (typeof deliveryDetails !== "object" || Array.isArray(deliveryDetails) || JSON.stringify(deliveryDetails).length > 2000
      || Object.values(deliveryDetails).some((v) => typeof v !== "string")) throw new UserError("Check your delivery details.");
  if ((size != null && (typeof size !== "string" || size.length > 20)) || (foodMessage != null && String(foodMessage).length > 300)
      || (foodSlot != null && String(foodSlot).length > 40) || (foodDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(foodDate))))
    throw new UserError("Check your order details.");
  // At most 10 checkouts an hour per person: stops scripts filling a shop with unpaid orders.
  const { data: underLimit } = await db.rpc("take_usage", { p_user: uid, p_kind: "checkout", p_max: 10, p_window: "1 hour" });
  if (underLimit !== true) throw new UserError("Too many checkouts in a short time. Try again in a while.", 429);
  if (!(delivery in DELIVERY_OPTIONS)) throw new UserError("Pick a delivery option.");

  const product = must(
    await db.from("products")
      .select("id, title, price_cents, mode, sizes, stock, status, lead_days, shop_id, parcel_size, held_for, held_until, auction_state, auction_winner, auction_price_cents, auction_pay_by, shops!inner(id, owner_id, status, name, category, founding_until, seller_checks(escrow_token, bank_status))")
      .eq("id", productId).single(),
    "load product",
  ) as any;
  const shop = product.shops;
  // Food made to order is collected or delivered by the baker on a date. Other made to order items (home, beauty, 13 Nov)
  // ship by courier like Buy now once they're made.
  const food = product.mode === "order_now" && shop.category === "food";
  // Auctions: only the winner can pay, at the winning bid, within 2 hours of the end.
  const auction = product.mode === "auction";
  if (auction) {
    await db.rpc("settle_auction", { p_product: product.id });
    const fresh = must(await db.from("products").select("auction_state, auction_winner, auction_price_cents, auction_pay_by").eq("id", product.id).single(), "load auction") as any;
    if (fresh.auction_state !== "won" || fresh.auction_winner !== uid) throw new UserError("Only the winner can pay for this auction.");
    if (new Date(fresh.auction_pay_by) < new Date()) throw new UserError("The 2 hours to pay have passed.");
    if (offerId) throw new UserError("Offers don't apply to auctions.");
    product.auction_price_cents = fresh.auction_price_cents;
  } else if (product.status !== "live") throw new UserError("This item is no longer available.");
  if (shop.status !== "open") throw new UserError("This item is no longer available.");
  if (shop.owner_id === uid) throw new UserError("You cannot buy your own item.");
  if (product.mode === "buy_now" && product.stock < 1) throw new UserError("Sold out.");
  if (!auction && product.held_for && product.held_for !== uid && new Date(product.held_until) > new Date())
    throw new UserError("The seller is holding this item for someone else right now.");

  // A special price from the seller in chat, for this item or a bundle.
  let itemPrice = (auction ? product.auction_price_cents : product.price_cents) as number;
  let bundleIds: string[] = [];
  let bundleSizes: (string | null)[] = [];
  let title = product.title as string;
  if (offerId) {
    const offer = must(await db.from("offers").select("*").eq("id", offerId).single(), "load offer") as any;
    if (offer.buyer_id !== uid) throw new UserError("This offer is for someone else.");
    if (offer.status !== "open" || new Date(offer.expires_at) < new Date()) throw new UserError("This offer has ended.");
    if (offer.product_ids[0] !== product.id) throw new UserError("This offer is for a different item.");
    bundleIds = offer.product_ids.slice(1);
    if (bundleIds.length) {
      const extras = must(await db.from("products").select("id, status, stock, mode, shop_id, held_for, held_until, parcel_size").in("id", bundleIds), "load bundle") as any[];
      bundleSizes = extras.map((x) => x.parcel_size);
      if (extras.length !== bundleIds.length || extras.some((x) => x.status !== "live" || x.shop_id !== product.shop_id || (x.mode === "buy_now" && x.stock < 1)
        || (x.held_for && x.held_for !== uid && new Date(x.held_until) > new Date())))
        throw new UserError("Something in this bundle is no longer available.");
      title = `Bundle: ${product.title} + ${bundleIds.length} more`;
    }
    itemPrice = offer.price_cents;
  }
  if (product.sizes?.length && !product.sizes.includes(size)) throw new UserError("Pick a size.");
  const allowed = food ? FOOD : NON_FOOD;
  if (!allowed.includes(delivery)) throw new UserError("That delivery option is not available for this item.");
  // Courier and lockers are booked by us through Bob Go, priced by parcel size (migration 0028).
  const parcelSize = orderParcelSize([product.parcel_size, ...bundleSizes] as any);
  if (bookedByUs(delivery) && deliveryFee(delivery, parcelSize) === null)
    throw new UserError(`This parcel is ${PARCEL_SIZES[parcelSize].label.toLowerCase()}, too big for a locker. Pick courier or collection.`);
  let savedPoint: Record<string, unknown> | null = null;
  let quotedDeliveryCents: number | null = null; // Bob Go's real price for this route, when it gave one
  if (bookedByUs(delivery)) {
    const dl = requireDelivery();
    if (!(deliveryDetails.name?.trim() && (deliveryDetails.phone ?? "").replace(/\D/g, "").length >= 9))
      throw new UserError("Add your name and cell number for the courier.");
    if (delivery === "courier") {
      const a = cleanAddress(deliveryDetails, "delivery address");
      Object.assign(deliveryDetails, { street: a.street, suburb: a.suburb, city: a.city, province: a.province, postalCode: a.postalCode });
    } else {
      const id = Number(pickupPoint?.id), provider = String(pickupPoint?.provider ?? "");
      if (!Number.isInteger(id) || !/^[a-z0-9_-]{2,30}$/.test(provider)) throw new UserError("Pick a locker.");
      const point = await dl.pickupPoint(id, provider);
      if (!point) throw new UserError("That locker isn't available any more. Pick another one.");
      savedPoint = { id: point.id, provider: point.provider, name: point.name, address: point.address };
      deliveryDetails.locker = point.name;
    }
    // Only take the order if Bob Go can book this exact route and parcel (the app checks first; this is the real check).
    const route = await checkRoute(db, dl, { shopId: shop.id, parcel: parcelSize, declaredValueCents: itemPrice,
      ...(delivery === "courier" ? { to: cleanAddress(deliveryDetails, "delivery address") } : { toPoint: { id: Number(savedPoint!.id), provider: String(savedPoint!.provider) } }) });
    if (!route.ok) throw new UserError(route.message ?? "That delivery option isn't available. Pick another one.", 409);
    quotedDeliveryCents = route.quoteCents ?? null;
  }
  if (food) {
    const earliest = new Date(Date.now() + (product.lead_days ?? 2) * 86400_000).toISOString().slice(0, 10);
    if (!foodDate || foodDate < earliest) throw new UserError(`Pick a date from ${earliest}.`);
    if (!foodSlot) throw new UserError("Pick a time slot.");
  }
  const sellerToken = shop.seller_checks?.escrow_token;
  // A changed payout account waits for our team's check before the shop takes new orders (0025).
  if (!sellerToken || shop.seller_checks?.bank_status !== "approved") throw new UserError("This seller cannot take payments right now.");

  // Rewards (migration 0024): a surprise R50 earned after a first delivered order, auction win or sale, usable after the return window.
  // The database checks the same rules again when the order is saved, so this can't be raced or skipped.
  const { data: creditOk } = await db.rpc("welcome_credit_ok", { p_buyer: uid, p_shop: shop.id });
  // Delivery perks (0029): 5 Instant EFT stamps, or a big order. The database checks the stamps again on save.
  const { data: perksOn } = bookedByUs(delivery) ? await db.rpc("delivery_perk_budget_ok") : { data: false };
  const { data: stampsReady } = perksOn === true ? await db.rpc("delivery_stamps_ready", { p_buyer: uid }) : { data: false };
  // What the seller owes us (refund fees they caused, courier extras, chargebacks) comes off this sale's payout (0038).
  const { data: owed } = await db.rpc("seller_owed", { p_shop: shop.id });

  const t = orderTotals({
    itemPrice,
    delivery,
    parcelSize,
    welcomeCreditAvailable: creditOk === true,
    stampsReady: stampsReady === true,
    perksOn: perksOn === true,
    quotedDeliveryCents,
    sellerOwedCents: typeof owed === "number" ? owed : 0,
    foundingUntil: shop.founding_until ? new Date(shop.founding_until) : null,
  });

  // TradeSafe's smallest payment is about R49, so an order (after any special price or reward) must be R50 or more.
  if (t.total < MIN_PRICE) throw new UserError("Orders on myHaul start at R50. Our payment partner can't take smaller amounts.");

  const es = escrow(); // refuses if payments aren't switched on
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
    credit_cents: t.creditUsed, credit_topup_cents: t.creditTopUp, total_cents: t.total, seller_fee_cents: t.sellerFee, seller_payout_cents: t.sellerPayout,
    delivery_details: deliveryDetails, food_date: food ? foodDate ?? null : null, food_slot: food ? foodSlot ?? null : null, food_message: food ? foodMessage ?? null : null,
    bundle_product_ids: bundleIds, offer_id: offerId ?? null,
    parcel_size: food ? null : parcelSize, delivery_kept_cents: t.deliveryKept, pickup_point: savedPoint,
    delivery_discount_cents: t.deliveryDiscount, delivery_perk: t.deliveryPerk, charges_taken_cents: t.chargesTaken,
  }), "create order");

  const days = ESCROW_DAYS[product.mode as keyof typeof ESCROW_DAYS];
  // If TradeSafe turns the order down, cancel it straight away so it doesn't sit there unpaid.
  const cancelOrder = () => db.from("orders").update({ status: "cancelled" }).eq("id", orderId).eq("status", "pending_payment");
  let tx: { transactionId: string; allocationId: string }, checkoutUrl: string;
  try {
    tx = await es.createTransaction({
      reference: orderId,
      title: title.slice(0, 60),
      description: `${title} from ${shop.name}`,
      buyerToken, sellerToken,
      amountCents: t.total,
      // Our cut inside escrow: our fees plus the courier money for Bob Go. If the reward is bigger, it is 0 and we
      // top the seller up ourselves.
      agentFeeCents: t.escrowAgentFee,
      daysToDeliver: days.deliver, daysToInspect: days.inspect,
    });
    checkoutUrl = await es.checkoutUrl(tx.transactionId, orderId);
  } catch (e) {
    await cancelOrder();
    throw e;
  }
  must(await db.from("orders").update({
    escrow_transaction_id: tx.transactionId, escrow_allocation_id: tx.allocationId, checkout_url: checkoutUrl,
  }).eq("id", orderId), "save escrow ids");

  return json({ orderId, checkoutUrl, totals: t, mode: es.mode });
}));

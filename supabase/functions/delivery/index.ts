// Delivery helpers for the app. Signed in only, and rate limited.
// { lat, lng } or { city }: lockers and pickup points near the buyer, for checkout.
// { check: "route", productId, delivery, pickupPoint | address }: can this item reach this locker or address? Asked while
//   the buyer picks, so checkout only offers what Bob Go can book (decided with Ofentse 7 Nov 2026).
// { check: "pickup", address }: can couriers collect from a seller's pickup address? Asked when the seller saves it.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import { cleanAddress, requireDelivery } from "../_shared/bobgo.ts";
import { checkRoute } from "../_shared/route.ts";
import { deliveryFee, type ParcelSize } from "../_shared/core/index.ts";

// The middle of each big city, for people who don't share their location.
const CITIES: Record<string, [number, number]> = {
  "Cape Town": [-33.9249, 18.4241], "Johannesburg": [-26.2041, 28.0473], "Pretoria": [-25.7479, 28.2293],
  "Durban": [-29.8587, 31.0218], "Gqeberha": [-33.9608, 25.6022], "Bloemfontein": [-29.0852, 26.1596],
  "East London": [-33.0153, 27.9116], "Polokwane": [-23.9045, 29.4689], "Mbombela": [-25.4753, 30.9694], "Kimberley": [-28.7282, 24.7499],
};
// Where we test a seller's pickup address against: a central, well known address in each region's big city.
const TEST_DROP = { street: "5 Long Street", suburb: "Cape Town City Centre", city: "Cape Town", province: "WC" as const, postalCode: "8001" };
const TEST_DROP_GP = { street: "24 Rothesay Avenue", suburb: "Craighall Park", city: "Johannesburg", province: "GP" as const, postalCode: "2196" };

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const uid = await requireUser(req, db);
  const kind = body?.check === "route" || body?.check === "pickup" ? "delivery_check" : "pickup_points";
  const { data: ok } = await db.rpc("take_usage", { p_user: uid, p_kind: kind, p_max: kind === "delivery_check" ? 40 : 60, p_window: "1 hour" });
  if (ok !== true) throw new UserError("Too many checks. Try again in a while.", 429);
  const dl = requireDelivery();

  if (body?.check === "route") {
    const { data: product } = await db.from("products").select("id, shop_id, price_cents, parcel_size, mode, status").eq("id", String(body.productId ?? "")).maybeSingle();
    if (!product || product.status !== "live" || (product.mode === "order_now" && !product.parcel_size)) throw new UserError("That item isn't available.");
    const parcel = (product.parcel_size ?? "small") as ParcelSize;
    if (body.delivery === "pudo_locker") {
      if (deliveryFee("pudo_locker", parcel) === null) return json({ ok: false, message: "This parcel is too big for a locker. Pick courier or collection." });
      const id = Number(body.pickupPoint?.id), provider = String(body.pickupPoint?.provider ?? "");
      if (!Number.isInteger(id) || !/^[a-z0-9_-]{2,30}$/.test(provider)) throw new UserError("Pick a locker.");
      const r = await checkRoute(db, dl, { shopId: product.shop_id, parcel, declaredValueCents: product.price_cents, toPoint: { id, provider } });
      return json({ ok: r.ok, message: r.message, quoteCents: r.quoteCents ?? null });
    }
    if (body.delivery === "courier") {
      const r = await checkRoute(db, dl, { shopId: product.shop_id, parcel, declaredValueCents: product.price_cents, to: cleanAddress(body.address, "delivery address") });
      return json({ ok: r.ok, message: r.message, quoteCents: r.quoteCents ?? null });
    }
    throw new UserError("Pick courier or locker.");
  }

  if (body?.check === "pickup") {
    const from = cleanAddress(body.address, "pickup address");
    const to = from.province === "WC" ? TEST_DROP_GP : TEST_DROP; // a long trip, which every courier we use covers
    let q;
    try { q = await dl.quote({ parcel: "small", declaredValueCents: 30000, from, to, description: "Address check" }, 12000); }
    catch (e) { console.error("pickup check", e); return json({ ok: true, unsure: true }); }
    if (q.verdict === "ok" || q.verdict === "try_later" || q.verdict === "low_balance") return json({ ok: true, unsure: q.verdict !== "ok" });
    return json({ ok: false, message: "Couriers can't find this address. Check the street, suburb and postal code." });
  }

  let lat = Number(body?.lat), lng = Number(body?.lng);
  if (typeof body?.city === "string" && CITIES[body.city]) [lat, lng] = CITIES[body.city];
  // South Africa only.
  if (!(lat >= -35.5 && lat <= -21.5 && lng >= 16 && lng <= 33.5)) throw new UserError("Pick a city or share your location.");
  const points = await dl.pickupPoints(lat, lng);
  return json({ points: points.slice(0, 20), cities: Object.keys(CITIES) });
}));

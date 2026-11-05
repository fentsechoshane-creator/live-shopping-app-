// Tracking updates from Bob Go. Signed by Bob Go (HMAC), then confirmed by asking Bob Go directly, so a forged
// call can never mark an order delivered. Always answers quickly; Bob Go retries on errors.
import { json } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { applyTracking, delivery, webhookSignatureOk } from "../_shared/bobgo.ts";
import { PARCEL_SIZES, type ParcelSize } from "../_shared/core/index.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const raw = await req.text();
  if (raw.length > 500_000 || !(await webhookSignatureOk(raw, req.headers.get("bobgo-webhook-signature")))) return json({ error: "forbidden" }, 403);
  let evt: any;
  try { evt = JSON.parse(raw); } catch { return json({ ok: true, ignored: "not json" }); }
  const ref = String(evt?.shipment_tracking_reference ?? evt?.tracking_reference ?? "");
  if (!/^[A-Za-z0-9-]{4,80}$/.test(ref)) return json({ ok: true, ignored: "no reference" });
  const db = adminClient();
  const { data: order } = await db.from("orders").select("id, status, parcel_size, delivery_kept_cents").eq("shipment_id", ref).maybeSingle();
  if (!order) return json({ ok: true, ignored: "unknown shipment" });
  const dl = delivery();
  if (!dl || dl.mode === "mock") return json({ ok: true, ignored: "deliveries off" });
  try {
    // Don't trust the payload: fetch the shipment's real tracking from Bob Go.
    await applyTracking(db, order.id, await dl.tracking(ref));
    // What Bob Go finally charged (and weighed). Shown to the team; the trigger alerts if it's over what the buyer paid.
    if (typeof evt?.charged_amount === "number") {
      const cost = Math.round(evt.charged_amount * 100);
      // The seller picked too small a size (the courier weighed more than that size allows): the extra comes off
      // their payout, as the seller rules say. Other price changes (like distance) are ours to carry.
      const size = PARCEL_SIZES[(order.parcel_size ?? "small") as ParcelSize];
      const tooHeavy = typeof evt?.charged_weight_kg === "number" && evt.charged_weight_kg > size.maxKg;
      const extra = tooHeavy ? Math.max(0, cost - order.delivery_kept_cents) : 0;
      await db.from("orders").update({ shipping_cost_cents: cost, ...(tooHeavy ? { courier_extra_cents: extra } : {}) }).eq("id", order.id);
    }
  } catch (e) {
    console.error("bobgo webhook", ref, e);
    return json({ error: "try again" }, 500);
  }
  return json({ ok: true });
});

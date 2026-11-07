// Can this seller's parcel reach this buyer? Asked before the buyer pays (checkout and the delivery picker), with the
// same details a booking uses, so courier and locker are only offered when Bob Go can actually book them.
// Decided with Ofentse 7 Nov 2026: limit options up front instead of failing when the seller ships.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import type { Address, Delivery, QuoteVerdict } from "./bobgo.ts";
import type { ParcelSize } from "./core/index.ts";

export interface RouteCheck {
  /** ok: offer it. blocked: don't (message says why and what to pick instead). */
  ok: boolean;
  verdict: QuoteVerdict | "no_pickup";
  message: string | null;
  /** Bob Go's price for this route in cents, when it gave one. The buyer pays this rounded up to R5. */
  quoteCents?: number | null;
}

export async function checkRoute(db: SupabaseClient, dl: Delivery, r: {
  shopId: string; parcel: ParcelSize; declaredValueCents: number; to?: Address; toPoint?: { id: number; provider: string };
}): Promise<RouteCheck> {
  const { data: p } = await db.from("shop_pickup").select("street, suburb, city, province, postal_code").eq("shop_id", r.shopId).maybeSingle();
  // No pickup address yet (new sellers add it when they first ship): we can't quote, so allow it. The address is checked
  // with Bob Go when they save it, and the shipping safety net covers the rest.
  if (!p) return { ok: true, verdict: "no_pickup", message: null };
  const from: Address = { street: p.street, suburb: p.suburb, city: p.city, province: p.province, postalCode: p.postal_code };
  let q;
  try {
    q = await dl.quote({ parcel: r.parcel, declaredValueCents: r.declaredValueCents, from, to: r.to, toPoint: r.toPoint, description: "myHaul order" }, 12000);
  } catch (e) {
    // Bob Go itself is down: don't block the sale. The seller books later, with the safety net when shipping.
    console.error("route check", e);
    return { ok: true, verdict: "try_later", message: null };
  }
  const locker = !!r.toPoint;
  switch (q.verdict) {
    case "ok": return { ok: true, verdict: "ok", message: null, quoteCents: q.cheapest ? Math.round(q.cheapest.amount * 100) : null };
    case "try_later": return { ok: true, verdict: "try_later", message: null };
    case "low_balance":
      // Our Bob Go account needs topping up. Never the buyer's problem: take the order and tell the team now.
      await db.rpc("raise_alert", { p_kind: "bobgo_balance", p_severity: "urgent", p_title: "Bob Go balance is too low to book couriers",
        p_body: "Top up the Bob Go account so sellers can ship. Orders are still being taken.", p_link: "/team", p_dedupe: `bobgo_balance:${new Date().toISOString().slice(0, 10)}` });
      return { ok: true, verdict: "low_balance", message: null };
    case "too_big": return { ok: false, verdict: "too_big", message: locker
      ? "This parcel won't fit in that locker. Pick another locker, or courier to your door."
      : "This parcel is too big for couriers on this route. Pick collection, or message the seller." };
    default: return { ok: false, verdict: "no_route", message: locker
      ? "Couriers can't reach that locker from this seller right now. Pick another locker, or courier to your door."
      : "Couriers can't deliver to this address from this seller right now. Check the address, or pick a locker." };
  }
}

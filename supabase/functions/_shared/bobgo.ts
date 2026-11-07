// Delivery through Bob Go (couriers and lockers). Docs: https://developer.bobgo.co.za
// BOBGO_MODE: "mock" (no key, fake bookings for testing), "sandbox" (Bob Go's test platform), "live".
// Keys go in Supabase Edge Function secrets, never in the app: BOBGO_API_KEY, BOBGO_WEBHOOK_SECRET.
import { env, UserError } from "./http.ts";
import { PARCEL_SIZES, type ParcelSize } from "./core/index.ts";
export { orderParcelSize } from "./core/index.ts";

export type Province = "EC" | "FS" | "GP" | "KZN" | "LP" | "MP" | "NC" | "NW" | "WC";
export const PROVINCES: Province[] = ["EC", "FS", "GP", "KZN", "LP", "MP", "NC", "NW", "WC"];

export interface Address { street: string; suburb: string; city: string; province: Province; postalCode: string; business?: boolean; company?: string }
export interface Contact { name: string; phone: string; email?: string }
export interface PickupPoint { id: number; provider: string; name: string; address: string; lat: number; lng: number; type: string; hours?: string }

export interface BookingInput {
  orderRef: string;
  parcel: ParcelSize;
  declaredValueCents: number;
  from: Address; fromContact: Contact;
  /** Door delivery address, or a pickup point for lockers. */
  to?: Address; toPoint?: { id: number; provider: string }; toContact: Contact;
  description: string;
}
export interface Booking { shipmentRef: string; courierName: string; costCents: number }
/** What a quote needs: the same route and parcel a booking would use, without contacts. */
export type QuoteInput = Pick<BookingInput, "parcel" | "declaredValueCents" | "from" | "to" | "toPoint" | "description">;
/**
 * Bob Go's answer boiled down (statuses from https://developer.bobgo.co.za/rates/rates/):
 * ok: bookable. no_route: success-no-rates, unimplemented or refused for another reason. too_big: over a weight, size or
 * locker compartment limit. low_balance: our Bob Go account needs topping up (never shown to buyers). try_later:
 * pending or failed-will-retry, a courier hiccup.
 */
export type QuoteVerdict = "ok" | "no_route" | "too_big" | "low_balance" | "try_later";
export interface Quote {
  verdict: QuoteVerdict;
  cheapest: { provider: string; providerName: string; level: string; amount: number } | null;
  rateRequestId: number | null;
  /** Each courier's status and reason, for logs and the team. */
  detail: string;
}
/** A booking that Bob Go refused, with the verdict so callers can react (alert the team, give the seller more time). */
export class BookingRefused extends UserError {
  constructor(public verdict: QuoteVerdict, public detail: string) {
    super(verdict === "too_big" ? "This parcel is too big for that courier or locker."
      : verdict === "no_route" ? "No courier delivers this route right now."
      : "Couriers can't book this right now. Please try again in a little while.", 409);
  }
}

/** Sorts Bob Go's rate answer into one verdict. Exported for tests. */
export function judgeRates(rates: any): Quote {
  const reqs: any[] = rates?.provider_rate_requests ?? [];
  const options: Quote["cheapest"][] = [];
  for (const pr of reqs) {
    if (pr.status !== "success") continue;
    for (const r of pr.responses ?? []) if (r.status === "success" && typeof r.rate_amount === "number")
      options.push({ provider: pr.provider_slug, providerName: pr.provider_name ?? pr.provider_slug, level: r.service_level_code, amount: r.rate_amount });
  }
  const detail = reqs.map((pr) => `${pr.provider_name ?? pr.provider_slug}: ${pr.status}${pr.failed_reason ? ` (${String(pr.failed_reason).slice(0, 120)})` : ""}`
    + (pr.responses ?? []).filter((r: any) => r.status !== "success").map((r: any) => ` [${r.service_level_code}: ${r.status}${r.failed_reason ? ` ${String(r.failed_reason).slice(0, 80)}` : ""}]`).join("")).join("; ").slice(0, 1500)
    || "no couriers answered";
  const rateRequestId = typeof rates?.id === "number" ? rates.id : null;
  if (options.length) return { verdict: "ok", cheapest: options.sort((a, z) => a!.amount - z!.amount)[0], rateRequestId, detail };
  const all = (st: (x: string) => boolean) => reqs.flatMap((pr) => [pr.status, ...(pr.responses ?? []).map((r: any) => r.status)]).some(st);
  const reasons = reqs.flatMap((pr) => [pr.failed_reason, ...(pr.responses ?? []).map((r: any) => r.failed_reason)]).filter(Boolean).join(" ").toLowerCase();
  const verdict: QuoteVerdict = /balance|credit|insufficient funds|top ?up/.test(reasons) ? "low_balance"
    : /weight|dimension|size|compartment|too (big|large|heavy|long)|exceed|limit/.test(reasons) ? "too_big"
    : all((x) => x === "pending" || x === "failed-will-retry") ? "try_later"
    : "no_route";
  return { verdict, cheapest: null, rateRequestId, detail };
}
export interface Tracking { status: string; delivered: boolean; events: { at: string; status: string; message: string | null; location: string | null }[] }

export interface Delivery {
  mode: "mock" | "sandbox" | "live";
  pickupPoints(lat: number, lng: number): Promise<PickupPoint[]>;
  /** One pickup point, checked with Bob Go so a buyer can't send a made up locker. */
  pickupPoint(id: number, provider: string): Promise<PickupPoint | null>;
  /** Can this route and parcel be booked? Same request a booking makes. */
  quote(input: QuoteInput, timeoutMs?: number): Promise<Quote>;
  book(input: BookingInput): Promise<Booking>;
  labelUrl(shipmentRef: string): Promise<string>;
  tracking(shipmentRef: string): Promise<Tracking>;
  cancel(shipmentRef: string): Promise<void>;
}

const toAddress = (a: Address) => ({
  type: a.business ? "business" : "residential", company: a.company ?? "", street_address: a.street, local_area: a.suburb,
  city: a.city, zone: a.province, country: "ZA", code: a.postalCode,
});
const parcels = (size: ParcelSize, description: string) => {
  const p = PARCEL_SIZES[size];
  return [{ submitted_length_cm: p.box.length, submitted_width_cm: p.box.width, submitted_height_cm: p.box.height, submitted_weight_kg: p.maxKg, description: description.slice(0, 60) }];
};
const split = (name: string) => { const parts = name.trim().split(/\s+/); return { first: parts[0] ?? "", last: parts.slice(1).join(" ") }; };

class BobGo implements Delivery {
  constructor(public mode: "sandbox" | "live", private base: string, private key: string) {}

  private async call(path: string, init: RequestInit = {}) {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      console.error("bobgo", path, res.status, text.slice(0, 500));
      throw new Error(`Bob Go ${res.status} on ${path.split("?")[0]}`);
    }
    return data;
  }

  async pickupPoints(lat: number, lng: number) {
    const q = new URLSearchParams({ lat: String(lat), lng: String(lng), limit: "15" });
    return this.points(await this.call(`/v2/locations?${q}`));
  }
  async pickupPoint(id: number, provider: string) {
    const q = new URLSearchParams({ location_id: String(id), provider_slug: provider });
    return this.points(await this.call(`/v2/locations?${q}`))[0] ?? null;
  }
  private points(d: any): PickupPoint[] {
    return ((d?.locations ?? []) as any[])
      .filter((l) => l.active !== false && !(l.compartment_errors?.length))
      .map((l) => ({ id: Number(l.id), provider: String(l.provider_slug), name: String(l.human_name || l.name), address: String(l.full_address || l.address || ""),
        lat: Number(l.lat), lng: Number(l.lng), type: String(l.type ?? "pickup_point"), hours: typeof l.trading_hours === "string" ? l.trading_hours : undefined }));
  }

  /** The route and parcel, the same for quoting and booking. */
  private common(b: QuoteInput) {
    return {
      parcels: parcels(b.parcel, b.description),
      // Lockers refuse a declared value ("This service level does not support declared value", seen in the sandbox
      // 7 Nov 2026), so it's only sent for door delivery, where it covers the parcel.
      ...(b.toPoint ? {} : { declared_value: Math.round(b.declaredValueCents / 100) }),
      collection_address: toAddress(b.from),
      ...(b.toPoint ? { delivery_pickup_point_location_id: b.toPoint.id } : { delivery_address: toAddress(b.to!) }),
    };
  }
  async quote(b: QuoteInput, timeoutMs = 25000) {
    // Prices from every courier on our account (a locker restricts it to the locker's courier).
    const rates = await this.call("/v2/rates", { method: "POST", body: JSON.stringify({
      ...this.common(b), timeout: Math.min(25000, Math.max(6000, timeoutMs)),
      ...(b.toPoint ? { pickup_point_provider_slug: b.toPoint.provider } : {}),
    }) });
    const q = judgeRates(rates);
    if (q.verdict !== "ok") console.error("bobgo quote", q.verdict, q.rateRequestId, q.detail);
    return q;
  }
  async book(b: BookingInput) {
    // 1. Quote; take the cheapest courier that works.
    const q = await this.quote(b);
    if (q.verdict !== "ok" || !q.cheapest) throw new BookingRefused(q.verdict, q.detail);
    const best = q.cheapest;
    const common = { ...this.common(b) };
    // 2. Book it.
    const from = split(b.fromContact.name), to = split(b.toContact.name);
    const s = await this.call("/v2/shipments", { method: "POST", body: JSON.stringify({
      ...common,
      provider_slug: best.provider, service_level_code: best.level, selected_rate_request_id: q.rateRequestId,
      collection_contact_name: from.first, collection_contact_surname: from.last, collection_contact_mobile_number: b.fromContact.phone,
      delivery_contact_name: to.first, delivery_contact_surname: to.last, delivery_contact_mobile_number: b.toContact.phone,
      ...(b.toContact.email ? { delivery_contact_email: b.toContact.email } : {}),
      custom_order_number: b.orderRef, timeout: 25000,
    }) });
    if (!s?.tracking_reference) throw new Error("Bob Go booking returned no tracking reference");
    return { shipmentRef: String(s.tracking_reference), courierName: best.providerName, costCents: Math.round(best.amount * 100) };
  }

  async labelUrl(ref: string) {
    const d = await this.call(`/v2/shipments/waybill?tracking_references=${encodeURIComponent(JSON.stringify([ref]))}&paper_size=A4`);
    if (d?.download_url) return String(d.download_url);
    throw new UserError("The label is still being made. Try again in a minute.", 409);
  }

  async tracking(ref: string) {
    const d = await this.call(`/v2/tracking?tracking_reference=${encodeURIComponent(ref)}`);
    const t = Array.isArray(d) ? d[0] : d;
    return parseTracking(t);
  }

  async cancel(ref: string) {
    await this.call("/v2/shipments/cancel", { method: "POST", body: JSON.stringify({ tracking_reference: ref }) });
  }
}

/** Turns Bob Go's tracking (from the API or a webhook) into our shape. */
export function parseTracking(t: any): Tracking {
  const status = String(t?.status ?? "");
  const events = ((t?.checkpoints ?? []) as any[]).map((c) => ({
    at: new Date(String(c.time).replace(" ", "T")).toISOString(),
    status: String(c.status ?? ""), message: c.message ? String(c.message).slice(0, 300) : null, location: c.location ? String(c.location).slice(0, 120) : null,
  })).filter((e) => !isNaN(Date.parse(e.at)));
  return { status, delivered: status === "delivered" || !!t?.shipment_movement_events?.delivered_time, events };
}

/** Testing without a Bob Go key: fake lockers, fake bookings at the buyer's price, no tracking (the team marks delivered). */
class MockDelivery implements Delivery {
  mode = "mock" as const;
  async pickupPoints(lat: number, lng: number) {
    const near = [
      ["PUDO Locker, Rondebosch Main Road", "Main Road, Rondebosch, Cape Town, 7700"],
      ["PUDO Locker, Cavendish Square", "Dreyer Street, Claremont, Cape Town, 7708"],
      ["PUDO Locker, Gardens Centre", "Mill Street, Gardens, Cape Town, 8001"],
      ["PUDO Locker, Observatory", "Lower Main Road, Observatory, Cape Town, 7925"],
      ["Pargo, Woodstock Exchange", "Albert Road, Woodstock, Cape Town, 7925"],
    ];
    return near.map(([name, address], i) => ({ id: 9000 + i, provider: i === 4 ? "pargo" : "pudo", name, address, lat: lat + i * 0.01, lng: lng + i * 0.01, type: i === 4 ? "pickup_point" : "locker" }));
  }
  async pickupPoint(id: number, provider: string) {
    return (await this.pickupPoints(-33.95, 18.47)).find((p) => p.id === id && p.provider === provider) ?? null;
  }
  async quote(b: QuoteInput) {
    // Like the real thing for testing: lockers can't take Large parcels; anything else works.
    const p = PARCEL_SIZES[b.parcel];
    if (b.toPoint && p.locker === null) return { verdict: "too_big" as const, cheapest: null, rateRequestId: null, detail: "test: too big for a locker" };
    return { verdict: "ok" as const, cheapest: { provider: "demo", providerName: "Test courier", level: "ECO", amount: (b.toPoint ? (p.locker ?? p.door) : p.door) / 100 }, rateRequestId: 1, detail: "test" };
  }
  async book(b: BookingInput) {
    const p = PARCEL_SIZES[b.parcel];
    return { shipmentRef: `MOCK${crypto.randomUUID().slice(0, 8).toUpperCase()}`, courierName: b.toPoint ? "PUDO (test)" : "The Courier Guy (test)",
      costCents: b.toPoint ? (p.locker ?? p.door) : p.door };
  }
  async labelUrl(ref: string) { return `${env("APP_URL", "http://localhost:5173")}/mock-label/${ref}`; }
  async tracking() { return { status: "", delivered: false, events: [] }; }
  async cancel() {}
}

/** Null when deliveries aren't switched on (then courier and locker are refused at checkout). */
export function delivery(): Delivery | null {
  const mode = Deno.env.get("BOBGO_MODE");
  if (mode === "mock") {
    if (/myhaul\.co\.za/i.test(Deno.env.get("APP_URL") ?? "")) return null; // never fake deliveries on the real site
    return new MockDelivery();
  }
  if (mode === "sandbox" || mode === "live") {
    const key = Deno.env.get("BOBGO_API_KEY");
    if (!key) return null;
    return new BobGo(mode, mode === "live" ? "https://api.bobgo.co.za" : "https://api.sandbox.bobgo.co.za", key);
  }
  return null;
}

export function requireDelivery(): Delivery {
  const d = delivery();
  if (!d) throw new UserError("Courier and locker delivery aren't switched on yet. Pick collection for now.", 503);
  return d;
}

/** Bob Go signs webhooks: base64 HMAC SHA256 of the raw body with our webhook secret. */
export async function webhookSignatureOk(raw: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get("BOBGO_WEBHOOK_SECRET");
  if (!secret || !header) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  let bin = ""; sig.forEach((b) => (bin += String.fromCharCode(b)));
  const expected = btoa(bin);
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

/** Checks an address the app sent. */
export function cleanAddress(a: any, what: string): Address {
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const out = { street: s(a?.street, 120), suburb: s(a?.suburb, 80), city: s(a?.city, 80), province: s(a?.province, 3) as Province, postalCode: s(a?.postalCode, 4) };
  if (out.street.length < 3 || out.suburb.length < 2 || out.city.length < 2 || !PROVINCES.includes(out.province) || !/^\d{4}$/.test(out.postalCode))
    throw new UserError(`Check the ${what}: street, suburb, city, province and a 4 digit postal code.`);
  return out;
}

/** Saves tracking events for an order and marks it delivered when the courier says so (only from shipped). */
// deno-lint-ignore no-explicit-any
export async function applyTracking(db: any, orderId: string, t: Tracking) {
  if (t.events.length) {
    await db.from("shipment_events").upsert(
      t.events.map((e) => ({ order_id: orderId, happened_at: e.at, status: e.status.slice(0, 60), message: e.message, location: e.location })),
      { onConflict: "order_id,happened_at,status", ignoreDuplicates: true });
  }
  await db.from("orders").update({ tracking_status: t.status.slice(0, 60) || null, tracking_checked_at: new Date().toISOString() }).eq("id", orderId);
  if (t.delivered) await db.from("orders").update({ status: "delivered" }).eq("id", orderId).eq("status", "shipped");
}

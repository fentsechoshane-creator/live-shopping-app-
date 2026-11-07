function assert(c: unknown, msg = "expected true") { if (!c) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} is not ${JSON.stringify(b)}`); }
function assertThrows(fn: () => unknown) { try { fn(); } catch { return; } throw new Error("expected an error"); }
import { BookingRefused, cleanAddress, delivery, judgeRates, orderParcelSize, parseTracking, webhookSignatureOk } from "./bobgo.ts";

Deno.test("accepts Bob Go's signature and rejects tampering", async () => {
  Deno.env.set("BOBGO_WEBHOOK_SECRET", "test-secret");
  const body = JSON.stringify({ shipment_tracking_reference: "UASDRW78", status: "delivered" });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  let bin = ""; sig.forEach((b) => (bin += String.fromCharCode(b)));
  assert(await webhookSignatureOk(body, btoa(bin)));
  assert(!(await webhookSignatureOk(body.replace("delivered", "returned"), btoa(bin))));
  assert(!(await webhookSignatureOk(body, null)));
  Deno.env.delete("BOBGO_WEBHOOK_SECRET");
  assert(!(await webhookSignatureOk(body, btoa(bin))), "no secret set means nothing is trusted");
});

Deno.test("reads tracking checkpoints and spots delivery", () => {
  const t = parseTracking({ status: "delivered", checkpoints: [
    { time: "2026-11-10 14:15:41+02:00", status: "delivered", message: "Signed by T", location: "Rondebosch" },
    { time: "2026-11-09 08:00:00+02:00", status: "collected", message: "", location: "" },
  ] });
  assert(t.delivered);
  assertEquals(t.events.length, 2);
  assertEquals(t.events[0].at, "2026-11-10T12:15:41.000Z");
  assertEquals(t.events[1].message, null);
  assert(!parseTracking({ status: "in-transit", checkpoints: [] }).delivered);
});

Deno.test("bundles take the biggest size, and 3 or more items are at least medium", () => {
  assertEquals(orderParcelSize(["small"]), "small");
  assertEquals(orderParcelSize(["small", "large"]), "large");
  assertEquals(orderParcelSize(["small", "small", "small"]), "medium");
  assertEquals(orderParcelSize([null]), "small");
});

Deno.test("checks addresses", () => {
  const a = cleanAddress({ street: "12 Main Road", suburb: "Rondebosch", city: "Cape Town", province: "WC", postalCode: "7700" }, "address");
  assertEquals(a.province, "WC");
  assertThrows(() => cleanAddress({ street: "12 Main Road", suburb: "Rondebosch", city: "Cape Town", province: "XX", postalCode: "7700" }, "address"));
  assertThrows(() => cleanAddress({ street: "12 Main Road", suburb: "Rondebosch", city: "Cape Town", province: "WC", postalCode: "770" }, "address"));
});

// Bob Go's rate answers (statuses from https://developer.bobgo.co.za/rates/rates/), each sorted into one verdict.
const pr = (status: string, failed_reason = "", responses: any[] = []) => ({ provider_slug: "tcg", provider_name: "The Courier Guy", status, failed_reason, responses });
Deno.test("a bookable rate is ok and the cheapest wins", () => {
  const q = judgeRates({ id: 7, provider_rate_requests: [
    pr("success", "", [{ service_level_code: "ECO", status: "success", rate_amount: 96.45 }, { service_level_code: "ONX", status: "success", rate_amount: 150 }]),
    { ...pr("success", "", [{ service_level_code: "LKR", status: "success", rate_amount: 60 }]), provider_slug: "pudo", provider_name: "PUDO" },
  ] });
  assertEquals(q.verdict, "ok");
  assertEquals(q.cheapest?.provider, "pudo");
  assertEquals(q.rateRequestId, 7);
});
Deno.test("no route, too big, low balance and try later are told apart", () => {
  assertEquals(judgeRates({ provider_rate_requests: [pr("success-no-rates")] }).verdict, "no_route");
  assertEquals(judgeRates({ provider_rate_requests: [pr("unimplemented")] }).verdict, "no_route");
  assertEquals(judgeRates({ provider_rate_requests: [] }).verdict, "no_route");
  assertEquals(judgeRates({ provider_rate_requests: [pr("failed-indefinitely", "Parcel exceeds maximum weight of 2kg")] }).verdict, "too_big");
  assertEquals(judgeRates({ provider_rate_requests: [pr("success", "", [{ service_level_code: "BOXL-S", status: "failed-indefinitely", failed_reason: "No compartment large enough" }])] }).verdict, "too_big");
  assertEquals(judgeRates({ provider_rate_requests: [pr("failed-indefinitely", "Insufficient balance on account")] }).verdict, "low_balance");
  assertEquals(judgeRates({ provider_rate_requests: [pr("pending"), pr("failed-will-retry")] }).verdict, "try_later");
  // A success alongside failures is still bookable.
  assertEquals(judgeRates({ provider_rate_requests: [pr("success-no-rates"), pr("success", "", [{ service_level_code: "ECO", status: "success", rate_amount: 90 }])] }).verdict, "ok");
  assert(judgeRates({ provider_rate_requests: [pr("failed-indefinitely", "Parcel too big")] }).detail.includes("Parcel too big"), "the reason is kept for the team");
});
Deno.test("booking quotes first and refuses with the verdict; it sends what the docs ask for", async () => {
  Deno.env.set("BOBGO_MODE", "sandbox"); Deno.env.set("BOBGO_API_KEY", "k");
  const calls: { url: string; body: any }[] = [];
  const real = globalThis.fetch;
  let rates: any = { id: 11, provider_rate_requests: [pr("success-no-rates")] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(input).endsWith("/v2/rates")) return new Response(JSON.stringify(rates), { status: 200 });
    return new Response(JSON.stringify({ tracking_reference: "UAB12345" }), { status: 200 });
  }) as typeof fetch;
  try {
    const dl = delivery()!;
    const input = { orderRef: "MH 1", parcel: "small" as const, declaredValueCents: 30000, description: "myHaul order",
      from: { street: "1 Main Road", suburb: "Observatory", city: "Cape Town", province: "WC" as const, postalCode: "7925" }, fromContact: { name: "Lebo M", phone: "0821234567" },
      toPoint: { id: 371, provider: "demo" }, toContact: { name: "Thandi", phone: "0831234567" } };
    let refused: unknown = null;
    try { await dl.book(input); } catch (e) { refused = e; }
    assert(refused instanceof BookingRefused && refused.verdict === "no_route", "refused with the verdict");
    assertEquals(calls.length, 1); // never tried to book
    assertEquals(calls[0].body.delivery_pickup_point_location_id, 371);
    assertEquals(calls[0].body.pickup_point_provider_slug, "demo");
    assertEquals(calls[0].body.declared_value, undefined); // lockers refuse a declared value
    assert(calls[0].body.timeout >= 6000, "always sends a timeout");
    rates = { id: 12, provider_rate_requests: [{ ...pr("success", "", [{ service_level_code: "LKR", status: "success", rate_amount: 60 }]), provider_slug: "demo" }] };
    const b = await dl.book(input);
    assertEquals(b.shipmentRef, "UAB12345");
    const ship = calls[calls.length - 1].body;
    assertEquals(ship.provider_slug, "demo");
    assertEquals(ship.selected_rate_request_id, 12);
    assertEquals(ship.delivery_pickup_point_location_id, 371);
  } finally { globalThis.fetch = real; Deno.env.delete("BOBGO_MODE"); Deno.env.delete("BOBGO_API_KEY"); }
});

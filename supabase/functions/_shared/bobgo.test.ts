function assert(c: unknown, msg = "expected true") { if (!c) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} is not ${JSON.stringify(b)}`); }
function assertThrows(fn: () => unknown) { try { fn(); } catch { return; } throw new Error("expected an error"); }
import { cleanAddress, orderParcelSize, parseTracking, webhookSignatureOk } from "./bobgo.ts";

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

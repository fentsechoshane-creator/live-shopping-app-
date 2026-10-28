import { verifyMuxSignature } from "./mux.ts";

async function sign(body: string, secret: string, t: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  return `t=${t},v1=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

Deno.test("accepts a valid Mux signature", async () => {
  const t = Math.floor(Date.now() / 1000);
  const body = '{"type":"video.asset.ready"}';
  if (!(await verifyMuxSignature(await sign(body, "s3cret", t), body, "s3cret"))) throw new Error("should accept");
});

Deno.test("rejects a tampered body, wrong secret or old timestamp", async () => {
  const t = Math.floor(Date.now() / 1000);
  const body = '{"type":"video.asset.ready"}';
  const h = await sign(body, "s3cret", t);
  if (await verifyMuxSignature(h, body + " ", "s3cret")) throw new Error("tampered body accepted");
  if (await verifyMuxSignature(h, body, "other")) throw new Error("wrong secret accepted");
  if (await verifyMuxSignature(await sign(body, "s3cret", t - 3600), body, "s3cret")) throw new Error("old timestamp accepted");
  if (await verifyMuxSignature(null, body, "s3cret")) throw new Error("missing header accepted");
});

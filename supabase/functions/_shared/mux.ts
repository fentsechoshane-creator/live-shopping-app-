// Mux video. Direct uploads from the phone, and a webhook when the video is ready.
const MUX_API = "https://api.mux.com/video/v1";

export const muxConfigured = () => !!(Deno.env.get("MUX_TOKEN_ID") && Deno.env.get("MUX_TOKEN_SECRET"));

function auth() {
  return "Basic " + btoa(`${Deno.env.get("MUX_TOKEN_ID")}:${Deno.env.get("MUX_TOKEN_SECRET")}`);
}

export async function createDirectUpload(origin: string): Promise<{ id: string; url: string }> {
  const res = await fetch(`${MUX_API}/uploads`, {
    method: "POST",
    headers: { authorization: auth(), "content-type": "application/json" },
    body: JSON.stringify({
      cors_origin: origin,
      new_asset_settings: { playback_policy: ["public"], max_resolution_tier: "1080p" },
    }),
  });
  if (!res.ok) throw new Error(`Mux upload failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { id: j.data.id, url: j.data.url };
}

/** Checks the Mux-Signature header: "t=<time>,v1=<hex hmac of `${t}.${body}`>". */
export async function verifyMuxSignature(header: string | null, body: string, secret: string, toleranceSec = 300): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, parts.v1 ?? "");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

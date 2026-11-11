import { liveKitToken, roomFor } from "./livekit.ts";

function decode(part: string) {
  const s = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(s + "=".repeat((4 - (s.length % 4)) % 4)));
}

Deno.test("a host token can send video, a viewer token can only watch", async () => {
  const host = await liveKitToken("APIkey", "secret", { room: roomFor("abc"), identity: "u1", canPublish: true, ttl: 3600 }, 1_000_000);
  const viewer = await liveKitToken("APIkey", "secret", { room: roomFor("abc"), identity: "guest-1", canPublish: false, ttl: 60, hidden: true }, 1_000_000);
  const h = decode(host.split(".")[1]), v = decode(viewer.split(".")[1]);
  if (h.iss !== "APIkey" || h.sub !== "u1" || h.exp !== 1_003_600 || h.video.room !== "show-abc" || !h.video.canPublish || !h.video.roomJoin) throw new Error("host claims wrong");
  if (v.video.canPublish || v.video.canPublishData || !v.video.hidden || !v.video.canSubscribe) throw new Error("viewer must only watch");
});

Deno.test("the signature checks out with the secret and fails with another", async () => {
  const t = await liveKitToken("k", "s3cret", { room: "r", identity: "i", canPublish: false, ttl: 60 });
  const [hd, pl, sig] = t.split(".");
  const verify = async (secret: string) => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const raw = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (sig.length % 4)) % 4)), (c) => c.charCodeAt(0));
    return crypto.subtle.verify("HMAC", key, raw, new TextEncoder().encode(`${hd}.${pl}`));
  };
  if (!(await verify("s3cret"))) throw new Error("should verify");
  if (await verify("other")) throw new Error("wrong secret verified");
  if (decode(hd).alg !== "HS256") throw new Error("must be HS256");
});

import { signJwt } from "./push.ts";

async function pem(key: CryptoKey) {
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key));
  let s = ""; der.forEach((b) => (s += String.fromCharCode(b)));
  return `-----BEGIN PRIVATE KEY-----\n${btoa(s)}\n-----END PRIVATE KEY-----`;
}
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

for (const alg of ["ES256", "RS256"] as const) {
  Deno.test(`push tokens are signed correctly (${alg})`, async () => {
    const params = alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
    const pair = await crypto.subtle.generateKey(params as any, true, ["sign", "verify"]) as CryptoKeyPair;
    const jwt = await signJwt({ alg }, { iss: "test" }, await pem(pair.privateKey), alg);
    const [h, c, sig] = jwt.split(".");
    const ok = await crypto.subtle.verify(alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : "RSASSA-PKCS1-v1_5", pair.publicKey, unb64(sig), new TextEncoder().encode(`${h}.${c}`));
    if (!ok) throw new Error("signature does not verify");
    if (JSON.parse(new TextDecoder().decode(unb64(c))).iss !== "test") throw new Error("claims wrong");
  });
}

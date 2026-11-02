// Sends phone notifications to the myHaul app. Android through Firebase Cloud Messaging, iPhone through Apple (APNs).
// Both are free. Secrets (Supabase > Edge Functions > Secrets, never in the app or git):
//   Android: FCM_SERVICE_ACCOUNT  the whole JSON file from Firebase > Project settings > Service accounts
//   iPhone:  APNS_KEY (the .p8 file's text), APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRODUCTION ("true" for App Store builds)
// Tokens Apple or Google say are dead are deleted. Tapping a notification opens `link` in the app.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

type Msg = { title: string; body: string; link?: string | null };

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const pemBytes = (pem: string) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));

export async function signJwt(header: object, claims: object, pem: string, alg: "RS256" | "ES256") {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(pem),
    alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign(alg === "RS256" ? "RSASSA-PKCS1-v1_5" : { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

let fcmToken: { value: string; exp: number } | null = null;
async function fcmAccess(sa: { client_email: string; private_key: string }) {
  if (fcmToken && fcmToken.exp > Date.now() + 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt({ alg: "RS256", typ: "JWT" },
    { iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
    sa.private_key, "RS256");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`FCM auth ${res.status}`);
  const j = await res.json();
  fcmToken = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
}

/** Sends one notification to every phone of these people. Returns how many phones got it. */
export async function sendPush(db: SupabaseClient, userIds: string[], msg: Msg): Promise<number> {
  if (!userIds.length) return 0;
  const { data } = await db.from("device_tokens").select("token, platform").in("user_id", userIds);
  const tokens = (data ?? []) as { token: string; platform: string }[];
  let ok = 0;
  const dead: string[] = [];

  const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  const android = tokens.filter((t) => t.platform === "android");
  if (saRaw && android.length) {
    const sa = JSON.parse(saRaw);
    const access = await fcmAccess(sa);
    for (const t of android) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
        body: JSON.stringify({ message: { token: t.token, notification: { title: msg.title, body: msg.body },
          data: msg.link ? { link: msg.link } : {}, android: { priority: "high" } } }),
      });
      if (res.ok) ok++;
      else {
        const text = await res.text();
        if (res.status === 404 || /UNREGISTERED/.test(text)) dead.push(t.token); else console.error("fcm", res.status, text);
      }
    }
  }

  const key = Deno.env.get("APNS_KEY"), keyId = Deno.env.get("APNS_KEY_ID"), team = Deno.env.get("APNS_TEAM_ID"), topic = Deno.env.get("APNS_BUNDLE_ID");
  const ios = tokens.filter((t) => t.platform === "ios");
  if (key && keyId && team && topic && ios.length) {
    const jwt = await signJwt({ alg: "ES256", kid: keyId }, { iss: team, iat: Math.floor(Date.now() / 1000) }, key, "ES256");
    const host = Deno.env.get("APNS_PRODUCTION") === "true" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
    for (const t of ios) {
      const res = await fetch(`${host}/3/device/${t.token}`, {
        method: "POST",
        headers: { authorization: `bearer ${jwt}`, "apns-topic": topic, "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json" },
        body: JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: "default" }, link: msg.link ?? null }),
      });
      if (res.ok) ok++;
      else {
        const text = await res.text();
        if (res.status === 410 || /BadDeviceToken|Unregistered/.test(text)) dead.push(t.token); else console.error("apns", res.status, text);
      }
    }
  }

  if (dead.length) await db.from("device_tokens").delete().in("token", dead);
  return ok;
}

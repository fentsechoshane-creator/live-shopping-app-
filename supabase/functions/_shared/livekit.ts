// LiveKit access tokens: a short signed note (a JWT) that lets one phone join one live show's video room.
// Hosts may send video and sound; viewers may only watch, and are hidden so they don't fill the room list.
// Built with the browser's own crypto, so no LiveKit package is needed on the server.

export interface LiveGrant {
  room: string;
  identity: string;
  name?: string;
  canPublish: boolean;
  /** Seconds the token stays valid. */
  ttl: number;
  hidden?: boolean;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

export async function liveKitToken(apiKey: string, apiSecret: string, g: LiveGrant, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: apiKey, sub: g.identity, name: g.name ?? g.identity, nbf: nowSec - 10, exp: nowSec + g.ttl,
    video: {
      room: g.room, roomJoin: true, canSubscribe: true, canPublish: g.canPublish, canPublishData: false,
      canUpdateOwnMetadata: false, hidden: !!g.hidden,
      ...(g.canPublish ? { canPublishSources: ["camera", "microphone"] } : {}),
    },
  };
  const data = `${enc(header)}.${enc(payload)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

/** Every show gets its own room. */
export const roomFor = (showId: string) => `show-${showId}`;

// Lets a phone join a live show's video on LiveKit Cloud. Needs the LIVEKIT_URL, LIVEKIT_API_KEY and
// LIVEKIT_API_SECRET secrets; without them the app says live video isn't set up yet.
// Host (the shop that owns the show): may send camera and sound, and only while the shop may go live.
// Viewer: watch only. Signed out visitors can watch too; people blocked by the seller can't.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import { liveKitToken, roomFor } from "../_shared/livekit.ts";

Deno.serve(handler(async (req, body) => {
  const url = Deno.env.get("LIVEKIT_URL"), key = Deno.env.get("LIVEKIT_API_KEY"), secret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!url || !key || !secret) return json({ error: "Live video isn't set up yet." }, 503);
  const showId = String(body.showId ?? "");
  if (!/^[0-9a-f-]{36}$/.test(showId)) throw new UserError("That show doesn't exist.", 404);
  const db = adminClient();
  const { data: show } = await db.from("live_shows").select("id, shop_id, status, shops(owner_id, handle)").eq("id", showId).single();
  if (!show) throw new UserError("That show doesn't exist.", 404);
  const owner = (show as any).shops?.owner_id as string;

  if (body.role === "host") {
    const uid = await requireUser(req, db);
    if (uid !== owner) throw new UserError("That isn't your show.", 403);
    if (show.status !== "scheduled" && show.status !== "live") throw new UserError("This show has ended. Start a new one.");
    const { data: why } = await db.rpc("live_blocker", { p_shop: show.shop_id });
    if (why) throw new UserError(String(why), 403);
    const token = await liveKitToken(key, secret, { room: roomFor(showId), identity: uid, name: (show as any).shops?.handle, canPublish: true, ttl: 6 * 3600 });
    return json({ url, token });
  }

  if (show.status !== "live") throw new UserError("This show isn't live right now.");
  // Signed in viewers are checked against the seller's blocks; anyone else watches as a guest.
  let identity = `guest-${crypto.randomUUID()}`;
  const auth = req.headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ") && auth.split(".").length === 3) {
    const { data } = await db.auth.getUser(auth.slice(7));
    if (data?.user) {
      const { data: blocked } = await db.from("blocks").select("blocker_id")
        .or(`and(blocker_id.eq.${owner},blocked_id.eq.${data.user.id}),and(blocker_id.eq.${data.user.id},blocked_id.eq.${owner})`).limit(1);
      if (blocked?.length) throw new UserError("You can't watch this show.", 403);
      identity = data.user.id;
    }
  }
  const token = await liveKitToken(key, secret, { room: roomFor(showId), identity, canPublish: false, ttl: 3 * 3600, hidden: true });
  return json({ url, token });
}));

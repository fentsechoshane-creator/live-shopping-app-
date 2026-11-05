// Gives the app a Mux direct upload URL for a seller video. Without Mux keys it answers useStorage: true,
// and the app uploads to Supabase Storage instead.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser, must } from "../_shared/supabase.ts";
import { createDirectUpload, muxConfigured } from "../_shared/mux.ts";

Deno.serve(handler(async (req) => {
  const db = adminClient();
  const uid = await requireUser(req, db);
  if (!muxConfigured()) return json({ useStorage: true });
  // Only shops upload videos, and at most 30 a day (each upload costs us money at Mux).
  const { data: shop } = await db.from("shops").select("id").eq("owner_id", uid).maybeSingle();
  if (!shop) throw new UserError("Open your shop first.", 403);
  const { data: allowed } = await db.rpc("take_usage", { p_user: uid, p_kind: "mux_upload", p_max: 30, p_window: "1 day" });
  if (allowed !== true) throw new UserError("That's a lot of uploads today. Try again tomorrow.", 429);
  // Uploads are only accepted from our own app (the website and the phone apps), never any site.
  const app = new URL(Deno.env.get("APP_URL") ?? "https://myhaul-app.netlify.app").origin;
  const allowed = [app, "https://myhaul.co.za", "capacitor://localhost", "https://localhost", "http://localhost:5173"];
  const origin = req.headers.get("origin") ?? "";
  const upload = await createDirectUpload(allowed.includes(origin) ? origin : app);
  const media = must(await db.from("media").insert({ owner_id: uid, kind: "video", mux_upload_id: upload.id, status: "uploading" })
    .select("id").single(), "create media") as any;
  return json({ mediaId: media.id, uploadUrl: upload.url });
}));

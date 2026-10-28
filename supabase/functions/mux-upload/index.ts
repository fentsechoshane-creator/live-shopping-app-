// Gives the app a Mux direct upload URL for a seller video. Without Mux keys it answers useStorage: true,
// and the app uploads to Supabase Storage instead.
import { handler, json } from "../_shared/http.ts";
import { adminClient, requireUser, must } from "../_shared/supabase.ts";
import { createDirectUpload, muxConfigured } from "../_shared/mux.ts";

Deno.serve(handler(async (req) => {
  const db = adminClient();
  const uid = await requireUser(req, db);
  if (!muxConfigured()) return json({ useStorage: true });
  const upload = await createDirectUpload(req.headers.get("origin") ?? "*");
  const media = must(await db.from("media").insert({ owner_id: uid, kind: "video", mux_upload_id: upload.id, status: "uploading" })
    .select("id").single(), "create media") as any;
  return json({ mediaId: media.id, uploadUrl: upload.url });
}));

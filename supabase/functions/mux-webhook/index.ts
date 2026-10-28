// Mux calls this when an upload becomes an asset and when the video is ready to play.
// Deploy with --no-verify-jwt. Set the webhook URL in the Mux dashboard and MUX_WEBHOOK_SECRET from there.
import { json, env } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { verifyMuxSignature } from "../_shared/mux.ts";

Deno.serve(async (req) => {
  const raw = await req.text();
  if (!(await verifyMuxSignature(req.headers.get("mux-signature"), raw, env("MUX_WEBHOOK_SECRET")))) {
    return json({ error: "bad signature" }, 401);
  }
  const evt = JSON.parse(raw);
  const db = adminClient();
  const d = evt.data ?? {};
  switch (evt.type) {
    case "video.upload.asset_created":
      await db.from("media").update({ mux_asset_id: d.asset_id, status: "processing" }).eq("mux_upload_id", d.id);
      break;
    case "video.asset.ready": {
      const playback = d.playback_ids?.[0]?.id ?? null;
      await db.from("media").update({ mux_asset_id: d.id, mux_playback_id: playback, status: "ready" })
        .or(`mux_asset_id.eq.${d.id},mux_upload_id.eq.${d.upload_id ?? "none"}`);
      break;
    }
    case "video.asset.errored":
      await db.from("media").update({ status: "failed" }).eq("mux_asset_id", d.id);
      break;
  }
  return json({ ok: true });
});

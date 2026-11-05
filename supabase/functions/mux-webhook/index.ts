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
  let evt: any;
  try { evt = JSON.parse(raw); } catch { return json({ ok: true, ignored: "not json" }); }
  const db = adminClient();
  const d = evt.data ?? {};
  // Mux ids are letters and numbers. Anything else is ignored, so nothing odd ever reaches a database filter.
  const ID = /^[A-Za-z0-9]{1,128}$/;
  const ok = (v: unknown) => typeof v === "string" && ID.test(v);
  if (!ok(d.id) || (d.asset_id != null && !ok(d.asset_id)) || (d.upload_id != null && !ok(d.upload_id))
      || (d.playback_ids?.[0]?.id != null && !ok(d.playback_ids[0].id))) return json({ ok: true, ignored: "bad id" });
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

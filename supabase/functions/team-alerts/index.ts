// Scheduled job, every 5 minutes (see docs/SETUP.md): finds what needs the team and tells them.
// Free: no AI. Alerts appear in the dashboard and in the team's notifications, and by email or Telegram when set up.
import { json } from "../_shared/http.ts";
import { adminClient, cronAllowed } from "../_shared/supabase.ts";
import { sendNewAlerts } from "../_shared/alerts.ts";

Deno.serve(async (req) => {
  const db = adminClient();
  if (!(await cronAllowed(req, db))) return json({ error: "forbidden" }, 403);
  const { data: raised, error } = await db.rpc("check_alerts");
  if (error) { console.error(error); return json({ error: "check failed" }, 500); }
  const sent = await sendNewAlerts(db);
  return json({ ok: true, raised, ...sent });
});

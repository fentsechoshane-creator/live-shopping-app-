// Scheduled job, every minute (see docs/SETUP.md): sends new notifications (orders, messages, comments, auctions,
// account and shop news) to people's phones. One phone notification per person per run: a burst becomes
// "3 new updates" so a busy chat doesn't buzz ten times. Needs the push keys in _shared/push.ts; without them it
// only marks notifications as handled.
import { json } from "../_shared/http.ts";
import { adminClient, cronAllowed } from "../_shared/supabase.ts";
import { sendPush } from "../_shared/push.ts";

type N = { id: number; user_id: string; kind: string; title: string; body: string; link: string | null; created_at: string };

Deno.serve(async (req) => {
  const db = adminClient();
  if (!(await cronAllowed(req, db))) return json({ error: "forbidden" }, 403);
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { data, error } = await db.from("notifications").select("id, user_id, kind, title, body, link, created_at")
    .is("pushed_at", null).gt("created_at", since).neq("kind", "team").order("created_at").limit(500);
  if (error) { console.error(error); return json({ error: "load failed" }, 500); }
  const rows = (data ?? []) as N[];
  const byUser = new Map<string, N[]>();
  for (const n of rows) byUser.set(n.user_id, [...(byUser.get(n.user_id) ?? []), n]);

  let phones = 0;
  for (const [user, list] of byUser) {
    const last = list[list.length - 1];
    const msg = list.length === 1
      ? { title: last.title, body: last.body, link: last.link }
      : { title: `${list.length} new updates on myHaul`, body: `${last.title}: ${last.body}`.slice(0, 140), link: "/activity" };
    try { phones += await sendPush(db, [user], msg); } catch (e) { console.error("push", e); }
  }
  // Marked as handled even without push keys, so nothing piles up. Older ones were skipped above on purpose.
  if (rows.length) await db.from("notifications").update({ pushed_at: new Date().toISOString() }).in("id", rows.map((n) => n.id));
  await db.from("notifications").update({ pushed_at: new Date().toISOString() }).is("pushed_at", null).lte("created_at", since);
  return json({ ok: true, notifications: rows.length, people: byUser.size, phones });
});

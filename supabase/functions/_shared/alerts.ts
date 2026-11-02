// Sends new team alerts by email (Resend) and Telegram, when those are set up. Both are optional and free at our size.
// Secrets (Supabase > Edge Functions > Secrets, never in the app or git):
//   RESEND_API_KEY, ALERT_EMAILS (comma separated), ALERT_FROM (a sender on a domain verified in Resend)
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (the team group chat)
//   APP_URL (https://myhaul-app.netlify.app or https://myhaul.co.za) for links
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

type Alert = { id: number; severity: string; title: string; body: string; link: string | null };

export async function sendNewAlerts(db: SupabaseClient): Promise<{ sent: number; channels: string[] }> {
  const { data } = await db.from("team_alerts").select("id, severity, title, body, link").is("sent_at", null).order("created_at").limit(50);
  const alerts = (data ?? []) as Alert[];
  if (!alerts.length) return { sent: 0, channels: [] };
  const app = (Deno.env.get("APP_URL") ?? "https://myhaul-app.netlify.app").replace(/\/$/, "");
  const urgent = alerts.filter((a) => a.severity === "urgent").length;
  const subject = urgent ? `myHaul: ${urgent} urgent ${urgent === 1 ? "alert" : "alerts"}` : `myHaul: ${alerts.length} new ${alerts.length === 1 ? "alert" : "alerts"}`;
  const lines = alerts.map((a) => `${a.severity === "urgent" ? "URGENT: " : ""}${a.title}\n${a.body}${a.link ? `\n${app}${a.link}` : ""}`);
  const channels: string[] = [];

  const resend = Deno.env.get("RESEND_API_KEY"), to = Deno.env.get("ALERT_EMAILS"), from = Deno.env.get("ALERT_FROM");
  if (resend && to && from) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${resend}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: to.split(",").map((x) => x.trim()).filter(Boolean), subject, text: lines.join("\n\n") + `\n\nTeam dashboard: ${app}/team` }),
    });
    if (res.ok) channels.push("email"); else console.error("alert email", res.status, await res.text());
  }
  const tg = Deno.env.get("TELEGRAM_BOT_TOKEN"), chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (tg && chat) {
    const res = await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `${subject}\n\n${lines.join("\n\n")}`.slice(0, 4000), disable_web_page_preview: true }),
    });
    if (res.ok) channels.push("telegram"); else console.error("alert telegram", res.status, await res.text());
  }
  // Marked sent even with no channel set up: the alerts are in the dashboard and in the team's notifications either way.
  await db.from("team_alerts").update({ sent_at: new Date().toISOString() }).in("id", alerts.map((a) => a.id));
  return { sent: alerts.length, channels };
}

// TradeSafe calls this when a transaction changes. Protected by a secret in the URL (TradeSafe has no signature).
// Set the API callback in TradeSafe to: https://<project>.supabase.co/functions/v1/escrow-webhook?secret=<TRADESAFE_CALLBACK_SECRET>
// Deploy with --no-verify-jwt because TradeSafe does not send a Supabase token.
import { json, env } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const PAID_STATES = ["FUNDS_RECEIVED", "FUNDS_DEPOSITED"];

Deno.serve(async (req) => {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!secret || secret !== env("TRADESAFE_CALLBACK_SECRET")) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => null);
  const data = body?.data;
  if (!data?.reference) return json({ ok: true, ignored: "no reference" });

  const db = adminClient();
  const { data: order } = await db.from("orders").select("id, status, escrow_transaction_id").eq("id", data.reference).maybeSingle();
  if (!order || order.escrow_transaction_id !== data.id) return json({ ok: true, ignored: "unknown order" });

  if (PAID_STATES.includes(data.state) && order.status === "pending_payment") {
    const { error } = await db.from("orders").update({ status: "paid" }).eq("id", order.id).eq("status", "pending_payment");
    if (error) {
      console.error(error);
      return json({ error: "update failed" }, 500);
    }
  }
  return json({ ok: true });
});

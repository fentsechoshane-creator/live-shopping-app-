// TradeSafe calls this when a transaction changes. Protected by a secret in the URL (TradeSafe has no signature).
// Set the API callback in TradeSafe to: https://<project>.supabase.co/functions/v1/escrow-webhook?secret=<TRADESAFE_CALLBACK_SECRET>
// Deploy with --no-verify-jwt because TradeSafe does not send a Supabase token.
// We never trust the message itself: we ask TradeSafe for the transaction's real state before marking anything paid.
import { json, env, sameSecret } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { escrow } from "../_shared/escrow.ts";

const PAID_STATES = ["FUNDS_RECEIVED", "FUNDS_DEPOSITED"];

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!sameSecret(new URL(req.url).searchParams.get("secret"), Deno.env.get("TRADESAFE_CALLBACK_SECRET"))) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => null);
  const data = body?.data;
  if (typeof data?.reference !== "string" || typeof data?.id !== "string") return json({ ok: true, ignored: "no reference" });

  const db = adminClient();
  const { data: order } = await db.from("orders").select("id, status, escrow_transaction_id").eq("id", data.reference).maybeSingle();
  if (!order || order.escrow_transaction_id !== data.id) return json({ ok: true, ignored: "unknown order" });
  if (order.status !== "pending_payment") return json({ ok: true });

  let es;
  try { es = escrow(); } catch { return json({ ok: true, ignored: "payments off" }); }
  if (es.mode !== "live") return json({ ok: true, ignored: "test mode" });
  // Ask TradeSafe directly. A faked or replayed callback can't mark an order paid.
  const real = await es.transactionState(order.escrow_transaction_id);
  if (!real || real.reference !== order.id) return json({ ok: true, ignored: "not confirmed" });
  if (PAID_STATES.includes(real.state)) {
    const { error } = await db.from("orders").update({ status: "paid" }).eq("id", order.id).eq("status", "pending_payment");
    if (error) {
      console.error(error);
      return json({ error: "update failed" }, 500);
    }
  }
  return json({ ok: true });
});

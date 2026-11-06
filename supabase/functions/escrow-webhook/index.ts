// TradeSafe calls this when a transaction changes. Protected by a secret in the URL (TradeSafe has no signature;
// their own plugin has a TODO for one).
// Set the API callback in TradeSafe to: https://<project>.supabase.co/functions/v1/escrow-webhook?secret=<TRADESAFE_CALLBACK_SECRET>
// Deploy with --no-verify-jwt because TradeSafe does not send a Supabase token.
// TradeSafe sends the transaction's fields at the top level ({ "reference": ..., "state": ... }), as their WooCommerce
// plugin reads them; older examples wrap them in "data", so both are accepted.
// We never trust the message itself: we ask TradeSafe for the transaction's real state, using the transaction id we
// saved at checkout, before marking anything paid.
// TradeSafe may replace our reference with its own code (seen live on 6 Nov 2026: "TTSWKQPG"), so we find the order
// by TradeSafe's transaction id first and only fall back to our reference.
import { json, sameSecret } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { escrow, PAID_STATES } from "../_shared/escrow.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISPUTED = ["DISPUTED"];

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!sameSecret(new URL(req.url).searchParams.get("secret"), Deno.env.get("TRADESAFE_CALLBACK_SECRET"))) return json({ error: "forbidden" }, 403);
  const raw = await req.text();
  if (raw.length > 100_000) return json({ ok: true, ignored: "too big" });
  let body: any = null;
  try { body = JSON.parse(raw); } catch { /* ignored below */ }
  const msg = body?.data && typeof body.data === "object" ? body.data : body;
  const reference = typeof msg?.reference === "string" ? msg.reference.trim() : "";
  const txId = typeof msg?.id === "string" ? msg.id.trim() : "";
  const byTx = /^[A-Za-z0-9_-]{6,64}$/.test(txId);
  if (!byTx && !UUID.test(reference)) return json({ ok: true, ignored: "no reference" });

  const db = adminClient();
  const cols = "id, status, escrow_transaction_id";
  let order = byTx ? (await db.from("orders").select(cols).eq("escrow_transaction_id", txId).maybeSingle()).data : null;
  if (!order && UUID.test(reference)) order = (await db.from("orders").select(cols).eq("id", reference).maybeSingle()).data;
  if (!order?.escrow_transaction_id) return json({ ok: true, ignored: "unknown order" });

  let es;
  try { es = escrow(); } catch { return json({ ok: true, ignored: "payments off" }); }
  if (es.mode !== "live") return json({ ok: true, ignored: "test mode" });

  // Ask TradeSafe directly. A faked or replayed callback can't change anything.
  let real;
  try { real = await es.transactionState(order.escrow_transaction_id); }
  catch (e) { console.error("tradesafe state", e); return json({ error: "try again" }, 500); }
  // We asked by the transaction id saved at checkout, so this answer is about this order.
  if (!real) return json({ ok: true, ignored: "not confirmed" });

  if (order.status === "pending_payment" && PAID_STATES.includes(real.state)) {
    // How they paid decides Instant EFT delivery stamps later.
    const method = await es.paymentMethod(order.escrow_transaction_id);
    const { error } = await db.from("orders").update({ status: "paid", payment_method: method }).eq("id", order.id).eq("status", "pending_payment");
    if (error) {
      console.error(error);
      return json({ error: "update failed" }, 500);
    }
  }
  // A buyer opened a dispute on TradeSafe's side: our team needs to know straight away.
  if (DISPUTED.includes(real.state)) {
    await db.rpc("raise_alert", {
      p_kind: "escrow_dispute", p_severity: "urgent", p_title: "Buyer disputed on TradeSafe",
      p_body: `Order ${order.id.slice(0, 8)} was disputed on TradeSafe. Check it before any payout.`,
      p_link: "/team/orders", p_dedupe: `escrow_dispute:${order.id}`,
    });
  }
  return json({ ok: true });
});

// Scheduled job. Run every 15 minutes with pg_cron (see docs/SETUP.md). Protected by CRON_SECRET.
// 1. Refund paid orders that were not shipped within 72 hours.
// 2. Close the return window on delivered orders with no claim (status completed).
// 3. Schedule payouts for completed orders by the seller's trust tier.
// 4. Release payouts that are due (escrow pays the seller).
// 5. Cancel checkouts left unpaid for 24 hours, and accept change of mind returns the seller ignored for 3 days.
import { json, env } from "../_shared/http.ts";
import { adminClient, must } from "../_shared/supabase.ts";
import { escrow } from "../_shared/escrow.ts";
import { payoutDate, tierFor } from "../_shared/core/index.ts";

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== env("CRON_SECRET")) return json({ error: "forbidden" }, 403);
  const db = adminClient();
  const es = escrow();
  const done: Record<string, number> = { refunded: 0, completed: 0, scheduled: 0, released: 0, cancelled: 0, auto_accepted: 0, failed: 0 };
  const now = new Date();

  const due = must(await db.from("due_orders").select("*").limit(200), "load due orders") as any[];
  for (const o of due) {
    try {
      if (o.action === "refund_unshipped") {
        await es.refund(o.escrow_transaction_id);
        must(await db.from("orders").update({ status: "refunded" }).eq("id", o.id).eq("status", "paid"), "refund");
        done.refunded++;
      } else if (o.action === "release") {
        must(await db.from("orders").update({ status: "completed" }).eq("id", o.id).eq("status", "delivered"), "complete");
        done.completed++;
      }
    } catch (e) {
      console.error("due order failed", o.id, e);
      done.failed++;
    }
  }

  // Completed orders without a payout row yet.
  const { data: completed } = await db.from("orders")
    .select("id, shop_id, seller_payout_cents, releasable_at, completed_at, shops!inner(owner_id, owner:profiles(trust_score)), payouts(id)")
    .eq("status", "completed").is("payouts", null).limit(200);
  for (const o of (completed ?? []) as any[]) {
    if (o.payouts?.length) continue;
    const tier = tierFor(o.shops.owner.trust_score);
    const releasable = new Date(o.releasable_at ?? o.completed_at);
    const payOn = payoutDate(tier, releasable);
    // [CONFIRM] new seller reserve: needs a second escrow allocation per order. Not applied yet.
    const { error } = await db.from("payouts").insert({
      order_id: o.id, shop_id: o.shop_id, amount_cents: o.seller_payout_cents, reserve_cents: 0,
      releasable_at: releasable.toISOString(), pay_on: payOn ? payOn.toISOString().slice(0, 10) : null,
      status: payOn ? "scheduled" : "held",
    });
    if (!error) done.scheduled++;
  }

  // Release payouts that are due today.
  const today = now.toISOString().slice(0, 10);
  const { data: payable } = await db.from("payouts").select("id, order_id, orders!inner(escrow_allocation_id)")
    .eq("status", "scheduled").lte("pay_on", today).limit(200);
  for (const p of (payable ?? []) as any[]) {
    try {
      await es.release(p.orders.escrow_allocation_id);
      must(await db.from("payouts").update({ status: "released", released_at: now.toISOString() }).eq("id", p.id), "release");
      done.released++;
    } catch (e) {
      console.error("release failed", p.id, e);
      done.failed++;
    }
  }

  // Unpaid checkouts.
  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  const { data: stale } = await db.from("orders").select("id, escrow_transaction_id").eq("status", "pending_payment").lt("created_at", dayAgo).limit(200);
  for (const o of stale ?? []) {
    try {
      if (o.escrow_transaction_id) await es.refund(o.escrow_transaction_id);
    } catch (_) { /* nothing was paid */ }
    await db.from("orders").update({ status: "cancelled" }).eq("id", o.id).eq("status", "pending_payment");
    done.cancelled++;
  }

  // Change of mind returns the seller has not answered in 3 days are accepted automatically.
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400_000).toISOString();
  const { data: ignored } = await db.from("returns").select("order_id").eq("status", "requested").eq("reason", "changed_mind").lt("created_at", threeDaysAgo);
  for (const r of ignored ?? []) {
    await db.from("returns").update({ status: "in_transit", decided_at: now.toISOString() }).eq("order_id", r.order_id);
    await db.from("orders").update({ status: "return_in_transit" }).eq("id", r.order_id).eq("status", "return_requested");
    done.auto_accepted++;
  }

  return json({ ok: true, ...done });
});

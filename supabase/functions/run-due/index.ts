// Scheduled job. Run every 15 minutes with pg_cron (see docs/SETUP.md). Protected by a secret kept in Supabase Vault.
// 1. Refund paid orders that were not shipped within 72 hours.
// 2. Close the return window on delivered orders with no claim (status completed).
// 3. Schedule payouts for completed orders by the seller's trust tier.
// Also: delete packing proof 6 months after delivery.
// 4. Release payouts that are due (escrow pays the seller).
// 5. Close ended auctions (winner has 2 hours to pay).
// 6. Cancel checkouts left unpaid for 24 hours, and accept change of mind returns the seller ignored for 3 days.
import { json } from "../_shared/http.ts";
import { adminClient, cronAllowed, must } from "../_shared/supabase.ts";
import { escrow, PAID_STATES } from "../_shared/escrow.ts";
import { applyTracking, delivery } from "../_shared/bobgo.ts";
import { payoutDate, tierFor } from "../_shared/core/index.ts";

Deno.serve(async (req) => {
  const db = adminClient();
  if (!(await cronAllowed(req, db))) return json({ error: "forbidden" }, 403);
  let es;
  // Health check for the team (same secret as the schedule): which connections are set up and working. No keys returned.
  const body = await req.json().catch(() => ({}));
  if (body?.check === "health") {
    const set = (n: string) => !!Deno.env.get(n);
    let tradesafe: Record<string, unknown>;
    try { tradesafe = await escrow().health(); } catch (e) { tradesafe = { error: String(e instanceof Error ? e.message : e) }; }
    // Bob Go: a read only call (lockers near Cape Town) proves the key and address work. Books nothing.
    let bobgoPing: unknown = null;
    const bg = delivery();
    if (bg && bg.mode !== "mock") {
      try { bobgoPing = { lockersNearCapeTown: (await bg.pickupPoints(-33.9249, 18.4241)).length }; }
      catch (e) { bobgoPing = { error: String(e instanceof Error ? e.message : e).slice(0, 300) }; }
    }
    return json({
      tradesafe,
      bobgo: { mode: Deno.env.get("BOBGO_MODE") ?? null, key: set("BOBGO_API_KEY"), webhookSecret: set("BOBGO_WEBHOOK_SECRET"), ping: bobgoPing },
      mux: { token: set("MUX_TOKEN_ID") && set("MUX_TOKEN_SECRET"), webhookSecret: set("MUX_WEBHOOK_SECRET") },
      callbackSecret: set("TRADESAFE_CALLBACK_SECRET"), appUrl: Deno.env.get("APP_URL") ?? null,
    });
  }
  try { es = escrow(); } catch { return json({ error: "payments are not switched on (set TRADESAFE_MODE)" }, 503); }
  const done: Record<string, number> = { refunded: 0, completed: 0, scheduled: 0, released: 0, cancelled: 0, auto_accepted: 0, failed: 0 };
  const now = new Date();

  // 0. Close auctions that ended, and cancel wins not paid within 2 hours.
  const { data: settled } = await db.rpc("settle_due_auctions");
  done.auctions_settled = (settled as number | null) ?? 0;

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
    .select("id, shop_id, seller_payout_cents, courier_extra_cents, credit_topup_cents, releasable_at, completed_at, shops!inner(owner_id, owner:profiles(trust_score)), payouts(id)")
    .eq("status", "completed").is("payouts", null).limit(200);
  for (const o of (completed ?? []) as any[]) {
    if (o.payouts?.length) continue;
    const tier = tierFor(o.shops.owner.trust_score);
    const releasable = new Date(o.releasable_at ?? o.completed_at);
    const payOn = payoutDate(tier, releasable);
    // [CONFIRM] new seller reserve: needs a second escrow allocation per order. Not applied yet.
    const { error } = await db.from("payouts").insert({
      order_id: o.id, shop_id: o.shop_id,
      // What TradeSafe pays the seller. A courier extra (parcel bigger than the size picked) is now a seller charge,
      // taken from their next sale (0038), so it isn't taken off here too.
      amount_cents: o.seller_payout_cents, reserve_cents: 0,
      // Welcome credit top up: paid by us by EFT, listed for our team on the Admin page.
      topup_cents: o.credit_topup_cents ?? 0,
      releasable_at: releasable.toISOString(), pay_on: payOn ? payOn.toISOString().slice(0, 10) : null,
      status: payOn ? "scheduled" : "held",
    });
    if (!error) done.scheduled++;
  }

  // Release payouts that are due today.
  const today = now.toISOString().slice(0, 10);
  const { data: payable } = await db.from("payouts").select("id, order_id, orders!inner(escrow_allocation_id, escrow_transaction_id)")
    .eq("status", "scheduled").lte("pay_on", today).limit(200);
  for (const p of (payable ?? []) as any[]) {
    try {
      // A dispute opened on TradeSafe's side holds the payout for our team.
      if (es.mode === "live" && p.orders.escrow_transaction_id) {
        const st = await es.transactionState(p.orders.escrow_transaction_id);
        if (st?.state === "DISPUTED") {
          await db.from("payouts").update({ status: "held", pay_on: null }).eq("id", p.id);
          await db.rpc("raise_alert", { p_kind: "escrow_dispute", p_severity: "urgent", p_title: "Payout held: buyer disputed on TradeSafe",
            p_body: `Order ${String(p.order_id).slice(0, 8)}. Sort out the dispute, then release the payout.`, p_link: "/team/orders", p_dedupe: `escrow_dispute:${p.order_id}` });
          continue;
        }
      }
      await es.release(p.orders.escrow_allocation_id);
      must(await db.from("payouts").update({ status: "released", released_at: now.toISOString() }).eq("id", p.id), "release");
      done.released++;
    } catch (e) {
      console.error("release failed", p.id, e);
      done.failed++;
      // Tell the team once (not every 15 minutes); the payout stays scheduled and is tried again.
      await db.rpc("raise_alert", { p_kind: "payout_failed", p_severity: "urgent", p_title: "A payout didn't go through",
        p_body: `Payout for order ${String(p.order_id).slice(0, 8)} was refused by TradeSafe. We keep trying every 15 minutes. Check the logs.`,
        p_link: "/team/orders", p_dedupe: `payout_failed:${p.id}` });
    }
  }

  // Packing proof older than 6 months after delivery (and no return open) is deleted: files first, then the records.
  const { data: purge } = await db.rpc("packing_due_purge");
  const purgeRows = (purge ?? []) as { order_id: string; paths: string[] }[];
  if (purgeRows.length) {
    const paths = purgeRows.flatMap((r) => r.paths ?? []);
    const { error } = paths.length ? await db.storage.from("private").remove(paths) : { error: null };
    if (error) console.error("packing purge", error.message);
    else {
      must(await db.rpc("packing_mark_purged", { p_orders: purgeRows.map((r) => r.order_id) }), "mark packing purged");
      (done as any).packingPurged = purgeRows.length;
    }
  }

  // Oversold: someone paid for an item that had just sold out. Refund in full now (no trust penalty, see 0025).
  const { data: oversold } = await db.from("orders").select("id, escrow_transaction_id").eq("status", "paid").eq("oversold", true).limit(200);
  for (const o of oversold ?? []) {
    try {
      if (o.escrow_transaction_id) await es.refund(o.escrow_transaction_id);
      must(await db.from("orders").update({ status: "refunded" }).eq("id", o.id).eq("status", "paid"), "refund oversold");
      done.refunded++;
    } catch (e) {
      console.error("oversold refund failed", o.id, e);
      done.failed++;
    }
  }

  // Unpaid checkouts.
  // Cancel requests the seller didn't answer in 24 hours: cancelled and refunded, no trust points lost (decided 7 Nov).
  const askedBefore = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const { data: asked } = await db.from("orders").select("id, escrow_transaction_id, shipment_id").eq("status", "paid")
    .not("cancel_requested_at", "is", null).lt("cancel_requested_at", askedBefore).limit(100);
  for (const o of asked ?? []) {
    try {
      if (o.shipment_id) { const d = delivery(); if (d) await d.cancel(o.shipment_id).catch((e) => console.error("cancel booking", o.id, e)); }
      if (o.escrow_transaction_id) await es.refund(o.escrow_transaction_id);
      must(await db.from("orders").update({ status: "refunded", cancelled_by: "auto" }).eq("id", o.id).eq("status", "paid"), "auto cancel");
      done.cancelRequests = (done.cancelRequests ?? 0) + 1;
    } catch (e) { console.error("auto cancel failed", o.id, e); done.failed++; }
  }

  // Backup for Bob Go's tracking webhooks: check parcels on the way that haven't updated in 30 minutes
  // (decided with Ofentse 7 Nov). Up to 50 a run, every 5 minutes: about 600 parcels on the way at once.
  const dl = delivery();
  if (dl && dl.mode !== "mock") {
    const halfHour = new Date(now.getTime() - 30 * 60_000).toISOString();
    const { data: moving } = await db.from("orders").select("id, shipment_id").eq("status", "shipped").not("shipment_id", "is", null)
      .or(`tracking_checked_at.is.null,tracking_checked_at.lt.${halfHour}`).order("tracking_checked_at", { nullsFirst: true }).limit(50);
    for (const o of moving ?? []) {
      try { await applyTracking(db, o.id, await dl.tracking(o.shipment_id)); done.tracked = (done.tracked ?? 0) + 1; }
      catch (e) { console.error("tracking", o.id, e); }
    }
  }

  const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
  // Backup for missed or unmatched payment messages: recent unpaid orders are checked with TradeSafe every run.
  if (es.mode === "live") {
    const fiveMin = new Date(now.getTime() - 5 * 60_000).toISOString();
    const { data: recent } = await db.from("orders").select("id, escrow_transaction_id").eq("status", "pending_payment")
      .not("escrow_transaction_id", "is", null).gte("created_at", dayAgo).lt("created_at", fiveMin).limit(50);
    for (const o of recent ?? []) {
      try {
        const st = await es.transactionState(o.escrow_transaction_id);
        if (st && PAID_STATES.includes(st.state)) {
          await db.from("orders").update({ status: "paid", payment_method: await es.paymentMethod(o.escrow_transaction_id) }).eq("id", o.id).eq("status", "pending_payment");
          done.paidLate = (done.paidLate ?? 0) + 1;
        }
      } catch (e) { console.error("payment check", o.id, e); }
    }
  }
  const { data: stale } = await db.from("orders").select("id, escrow_transaction_id").eq("status", "pending_payment").lt("created_at", dayAgo).limit(200);
  for (const o of stale ?? []) {
    try {
      if (o.escrow_transaction_id && es.mode === "live") {
        // Paid late, or the callback was missed: mark it paid instead of stranding the buyer's money.
        const st = await es.transactionState(o.escrow_transaction_id);
        if (st && PAID_STATES.includes(st.state)) {
          await db.from("orders").update({ status: "paid", payment_method: await es.paymentMethod(o.escrow_transaction_id) }).eq("id", o.id).eq("status", "pending_payment");
          continue;
        }
        await es.refund(o.escrow_transaction_id); // if this fails, we try again next run instead of cancelling
      }
      await db.from("orders").update({ status: "cancelled" }).eq("id", o.id).eq("status", "pending_payment");
      done.cancelled++;
    } catch (e) {
      console.error("unpaid order", o.id, e);
      done.failed++;
    }
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

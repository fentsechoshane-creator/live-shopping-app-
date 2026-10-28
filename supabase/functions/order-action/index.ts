// Order actions that move money or need the escrow provider.
// Simple buyer actions (confirm received, request return, review) are database functions instead.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser, isAdmin, must } from "../_shared/supabase.ts";
import { escrow } from "../_shared/escrow.ts";

type Action = "mock_pay" | "cancel_unpaid" | "ship" | "accept_return" | "return_received" | "dispute_return" | "decide_return";

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const uid = await requireUser(req, db);
  const { orderId, action } = (body ?? {}) as { orderId: string; action: Action };
  const order = must(
    await db.from("orders").select("*, shops!inner(owner_id), returns(*)").eq("id", orderId).single(),
    "load order",
  ) as any;
  const isBuyer = order.buyer_id === uid;
  const isSeller = order.shops.owner_id === uid;
  const admin = await isAdmin(db, uid);
  const es = escrow();
  const setStatus = async (status: string, extra: Record<string, unknown> = {}) =>
    must(await db.from("orders").update({ status, ...extra }).eq("id", orderId).eq("status", order.status), `set ${status}`);
  const ret = order.returns as any;

  switch (action) {
    case "mock_pay": {
      if (es.mode !== "mock") throw new UserError("Not available.", 404);
      if (!isBuyer || order.status !== "pending_payment") throw new UserError("Nothing to pay.");
      await setStatus("paid");
      break;
    }
    case "cancel_unpaid": {
      if (!isBuyer || order.status !== "pending_payment") throw new UserError("Only unpaid orders can be cancelled.");
      if (order.escrow_transaction_id) await es.refund(order.escrow_transaction_id);
      await setStatus("cancelled");
      break;
    }
    case "ship": {
      if (!isSeller || order.status !== "paid") throw new UserError("Only paid orders can be shipped.");
      const { trackingRef, packingMediaId } = body;
      if (order.delivery === "courier" || order.delivery === "pudo_locker") {
        if (!trackingRef) throw new UserError("Add the tracking number.");
      }
      await es.startDelivery(order.escrow_allocation_id);
      await setStatus("shipped", { tracking_ref: trackingRef ?? null, packing_media_id: packingMediaId ?? null });
      break;
    }
    case "accept_return": {
      if (!isSeller || order.status !== "return_requested") throw new UserError("No return to accept.");
      must(await db.from("returns").update({ status: "in_transit", decided_by: uid, decided_at: new Date().toISOString() }).eq("order_id", orderId), "update return");
      await setStatus("return_in_transit");
      await db.from("notifications").insert({
        user_id: order.buyer_id, kind: "return", title: "Return accepted",
        body: ret?.postage_payer === "buyer"
          ? "Send the item back to the seller. You pay the return postage. Your refund follows once it arrives."
          : "Send the item back. The seller pays the return postage. Your refund follows once it arrives.",
        link: `/orders/${orderId}`,
      });
      break;
    }
    case "return_received": {
      if (!(isSeller || admin) || order.status !== "return_in_transit") throw new UserError("No return on the way.");
      await es.refund(order.escrow_transaction_id);
      must(await db.from("returns").update({ status: "refunded" }).eq("order_id", orderId), "update return");
      await setStatus("refunded");
      break;
    }
    case "dispute_return": {
      // Seller disagrees (for example, says the item matched the listing video). Our team decides.
      if (!isSeller || order.status !== "return_requested") throw new UserError("No return to dispute.");
      if (ret?.reason === "changed_mind") throw new UserError("Change of mind returns within 7 days are the buyer's right.");
      const { data: admins } = await db.from("profiles").select("id").eq("role", "admin");
      for (const a of admins ?? []) {
        await db.from("notifications").insert({ user_id: a.id, kind: "dispute", title: "Return disputed", body: `Order ${orderId}`, link: `/admin/orders/${orderId}` });
      }
      break;
    }
    case "decide_return": {
      if (!admin || order.status !== "return_requested") throw new UserError("Admins only.", 403);
      const { uphold } = body;
      const { data: shop } = await db.from("shops").select("owner_id").eq("id", order.shop_id).single();
      if (uphold) {
        // Buyer was right: refund once the item is back, seller loses points.
        must(await db.rpc("add_trust_event", { p_user: shop!.owner_id, p_kind: ret?.reason === "faulty" ? "flaw_not_shown" : "not_as_described", p_order: orderId }), "trust event");
        must(await db.from("returns").update({ status: "in_transit", decided_by: uid, decided_at: new Date().toISOString() }).eq("order_id", orderId), "update return");
        await setStatus("return_in_transit");
      } else {
        must(await db.rpc("add_trust_event", { p_user: order.buyer_id, p_kind: "return_claim_rejected", p_order: orderId }), "trust event");
        must(await db.from("returns").update({ status: "rejected", decided_by: uid, decided_at: new Date().toISOString() }).eq("order_id", orderId), "update return");
        // The seller's payout is scheduled on the next run of run-due.
        await setStatus("completed");
      }
      break;
    }
    default:
      throw new UserError("Unknown action.");
  }
  return json({ ok: true });
}));

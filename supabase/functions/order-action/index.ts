// Order actions that move money or need the escrow provider.
// Simple buyer actions (confirm received, request return, review) are database functions instead.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser, isAdmin, must } from "../_shared/supabase.ts";
import { escrow, PAID_STATES } from "../_shared/escrow.ts";
import { BookingRefused, requireDelivery, type Province } from "../_shared/bobgo.ts";
import { bookedByUs, type DeliveryOption } from "../_shared/core/index.ts";

type Action = "mock_pay" | "check_payment" | "cancel_unpaid" | "cancel" | "answer_cancel" | "seller_cancel" | "team_cancel" | "ship" | "label" | "accept_return" | "return_received" | "dispute_return" | "decide_return";

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
  const HOUR = 3600_000;
  const cleanReason = (r: unknown, required: boolean) => {
    const t = typeof r === "string" ? r.trim().slice(0, 300) : "";
    if (required && t.length < 3) throw new UserError("Say why, in a few words.");
    return t || null;
  };
  // Refund in full and close the order. A courier already booked is cancelled with Bob Go first.
  const refundNow = async (by: "buyer" | "seller" | "team" | "auto", reason: string | null) => {
    if (order.shipment_id && order.status === "paid") await requireDelivery().cancel(order.shipment_id).catch((e) => console.error("cancel booking", orderId, e));
    if (order.escrow_transaction_id) await es.refund(order.escrow_transaction_id);
    await setStatus("refunded", { cancelled_by: by, cancel_reason: reason });
  };
  const setStatus = async (status: string, extra: Record<string, unknown> = {}) =>
    must(await db.from("orders").update({ status, ...extra }).eq("id", orderId).eq("status", order.status), `set ${status}`);
  const ret = order.returns as any;

  switch (action) {
    case "mock_pay": {
      if (es.mode !== "mock") throw new UserError("Not available.", 404);
      if (!isBuyer || order.status !== "pending_payment") throw new UserError("Nothing to pay.");
      await setStatus("paid", { payment_method: await es.paymentMethod(order.escrow_transaction_id ?? "") });
      break;
    }
    case "check_payment": {
      // The buyer just came back from TradeSafe's page: ask TradeSafe now instead of waiting for its message.
      if (!(isBuyer || admin)) throw new UserError("Not your order.", 403);
      if (order.status !== "pending_payment") return json({ paid: order.status !== "cancelled" });
      if (es.mode !== "live" || !order.escrow_transaction_id) return json({ paid: false });
      const { data: allowed } = await db.rpc("take_usage", { p_user: uid, p_kind: "payment_check", p_max: 300, p_window: "1 hour" });
      if (allowed !== true) return json({ paid: false });
      const st = await es.transactionState(order.escrow_transaction_id);
      if (!st || !PAID_STATES.includes(st.state)) return json({ paid: false });
      await db.from("orders").update({ status: "paid", payment_method: await es.paymentMethod(order.escrow_transaction_id) })
        .eq("id", orderId).eq("status", "pending_payment");
      return json({ paid: true });
    }
    case "cancel_unpaid": {
      if (!isBuyer || order.status !== "pending_payment") throw new UserError("Only unpaid orders can be cancelled.");
      if (order.escrow_transaction_id) await es.refund(order.escrow_transaction_id);
      await setStatus("cancelled");
      break;
    }
    // ----- Cancelling a paid order (migration 0035, decided with Ofentse 7 Nov 2026) -----
    case "cancel": {
      // Buyer: free within 1 hour of paying while not shipped; after that it's a request the seller has 24 hours to answer.
      if (!isBuyer) throw new UserError("Not your order.", 403);
      if (order.status !== "paid") throw new UserError(order.status === "shipped" ? "It's already on the way. Once it arrives you can return it." : "This order can't be cancelled.");
      const reason = cleanReason(body.reason, false);
      if (Date.now() - new Date(order.paid_at).getTime() <= HOUR) {
        await refundNow("buyer", reason);
        return json({ ok: true, cancelled: true });
      }
      if (order.cancel_requested_at) throw new UserError("You've already asked. The seller has 24 hours to answer.");
      must(await db.from("orders").update({ cancel_requested_at: new Date().toISOString(), cancel_reason: reason }).eq("id", orderId).eq("status", "paid"), "ask to cancel");
      await db.from("notifications").insert({ user_id: order.shops.owner_id, kind: "order", title: "The buyer asked to cancel",
        body: `${reason ? `"${reason}". ` : ""}Accept to refund them, or ship it. No answer in 24 hours cancels it. You don't lose trust points either way.`, link: `/sell/orders/${orderId}` });
      return json({ ok: true, requested: true });
    }
    case "answer_cancel": {
      if (!isSeller || order.status !== "paid" || !order.cancel_requested_at) throw new UserError("There's no cancel request to answer.");
      if (body.accept === true) { await refundNow("buyer", order.cancel_reason); break; }
      must(await db.from("orders").update({ cancel_requested_at: null }).eq("id", orderId).eq("status", "paid"), "decline cancel");
      await db.from("notifications").insert({ user_id: order.buyer_id, kind: "order", title: "The seller is sending your order",
        body: "They couldn't cancel it. Once it arrives you can still return it within 7 days if you change your mind.", link: `/orders/${orderId}` });
      break;
    }
    case "seller_cancel": {
      // Loses 5 trust points (like not shipping) unless the courier couldn't book or the buyer had asked to cancel.
      if (!isSeller || order.status !== "paid") throw new UserError("Only paid orders that haven't shipped can be cancelled.");
      await refundNow("seller", cleanReason(body.reason, true));
      break;
    }
    case "team_cancel": {
      if (!admin) throw new UserError("Only our team can do this.", 403);
      if (!["paid", "shipped", "delivered", "return_requested", "return_in_transit"].includes(order.status)) throw new UserError("This order can't be refunded now.");
      const reason = cleanReason(body.reason, true)!;
      await refundNow("team", reason);
      await db.rpc("log_admin", { p_action: "Cancelled and refunded order", p_kind: "order", p_target: orderId, p_note: reason, p_admin: uid });
      break;
    }
    case "ship": {
      if (!isSeller || order.status !== "paid") throw new UserError("Only paid orders can be shipped.");
      if (order.oversold) throw new UserError("This item sold out before this payment came in. The buyer is being refunded.");
      const { trackingRef, packingMediaId, packingPhotoMediaId } = body;
      // Packing proof is required for every order, courier or collection (migration 0023 checks it again).
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID.test(String(packingMediaId ?? "")) || !UUID.test(String(packingPhotoMediaId ?? ""))) throw new UserError("Add the packing video and the photo of the sealed parcel before shipping.");
      // Check the proof before escrow is told the item is on its way (the database checks it again when the status changes).
      const { data: proof } = await db.from("media").select("id, owner_id, kind, created_at, status, storage_path").in("id", [packingMediaId, packingPhotoMediaId]);
      const v = proof?.find((m: any) => m.id === packingMediaId), p = proof?.find((m: any) => m.id === packingPhotoMediaId);
      const ok = (m: any, kind: string, prefix: string) => m && m.owner_id === uid && m.kind === kind && m.status === "ready"
        && typeof m.storage_path === "string" && m.storage_path.startsWith(`${uid}/${prefix}-`) && new Date(m.created_at) >= new Date(order.paid_at);
      if (!ok(v, "video", "packing") || !ok(p, "image", "parcel")) {
        throw new UserError("Film the packing video and photo for this order in the app, after it was paid.");
      }
      const { count: used } = await db.from("orders").select("id", { count: "exact", head: true })
        .or(`packing_media_id.in.(${packingMediaId},${packingPhotoMediaId}),packing_photo_media_id.in.(${packingMediaId},${packingPhotoMediaId})`);
      if (used) throw new UserError("Film new packing proof for each order.");
      // Courier and locker orders: we book Bob Go now (once; a retry reuses the booking).
      let booking: Record<string, unknown> = { tracking_ref: typeof trackingRef === "string" ? trackingRef.slice(0, 60) : null };
      if (bookedByUs(order.delivery as DeliveryOption)) {
        const dl = requireDelivery();
        if (order.shipment_id) booking = { tracking_ref: order.shipment_id };
        else {
          const { data: from } = await db.from("shop_pickup").select("*").eq("shop_id", order.shop_id).maybeSingle();
          if (!from) throw new UserError("Add your pickup address first (Me, then To ship), so the courier knows where to collect.");
          const d = order.delivery_details ?? {};
          const { data: buyer } = await db.auth.admin.getUserById(order.buyer_id);
          let b: Awaited<ReturnType<typeof dl.book>>;
          try {
          b = await dl.book({
            orderRef: String(order.packing_code ?? orderId.slice(0, 8)),
            parcel: order.parcel_size ?? "small",
            declaredValueCents: order.item_price_cents,
            from: { street: from.street, suburb: from.suburb, city: from.city, province: from.province as Province, postalCode: from.postal_code },
            fromContact: { name: from.name, phone: from.phone },
            ...(order.delivery === "pudo_locker"
              ? { toPoint: { id: Number(order.pickup_point?.id), provider: String(order.pickup_point?.provider) } }
              : { to: { street: d.street, suburb: d.suburb, city: d.city, province: d.province, postalCode: d.postalCode } }),
            toContact: { name: d.name ?? "Buyer", phone: d.phone ?? "", email: buyer.user?.email ?? undefined },
            description: "myHaul order",
          });
          } catch (e) {
            // Safety net (decided with Ofentse 7 Nov): a failed booking is never the seller's fault. The first time, they
            // get 2 more days to ship (so no automatic refund or trust points lost) and our team is told with Bob Go's reason.
            const verdict = e instanceof BookingRefused ? e.verdict : "try_later";
            const detail = e instanceof BookingRefused ? e.detail : String(e instanceof Error ? e.message : e).slice(0, 300);
            if (!order.booking_failed_at) {
              const later = new Date(Math.max(Date.now(), new Date(order.ship_by ?? Date.now()).getTime()) + 2 * 86400_000).toISOString();
              await db.from("orders").update({ booking_failed_at: new Date().toISOString(), ship_by: later }).eq("id", orderId).eq("status", "paid");
            }
            await db.rpc("raise_alert", { p_kind: verdict === "low_balance" ? "bobgo_balance" : "booking_failed", p_severity: "urgent",
              p_title: verdict === "low_balance" ? "Bob Go balance is too low to book couriers" : "A courier booking failed",
              p_body: `Order ${String(order.packing_code ?? orderId.slice(0, 8))} (${order.delivery}): ${detail}`.slice(0, 600),
              p_link: "/team/orders", p_dedupe: `booking_failed:${orderId}` });
            throw new UserError(verdict === "too_big"
              ? "The courier says this parcel is too big for this delivery. We've told our team and given you 2 more days. You don't lose trust points."
              : "We couldn't book the courier right now. We've told our team and given you 2 more days to ship, so you don't lose trust points. Try again in a little while.", 409);
          }
          // Save the booking straight away so a retry never books twice.
          const saved = await db.from("orders").update({ shipment_id: b.shipmentRef, courier_name: b.courierName, shipping_cost_cents: b.costCents, booked_at: new Date().toISOString() })
            .eq("id", orderId).eq("status", "paid").is("shipment_id", null);
          if (saved.error) { await dl.cancel(b.shipmentRef).catch(() => {}); throw new Error(`save booking: ${saved.error.message}`); }
          booking = { tracking_ref: b.shipmentRef };
        }
      }
      must(await db.from("orders").update({ packing_media_id: packingMediaId, packing_photo_media_id: packingPhotoMediaId }).eq("id", orderId).eq("status", "paid"), "packing proof");
      await es.startDelivery(order.escrow_allocation_id);
      // Shipping answers a pending cancel request with no (the buyer can still return it).
      await setStatus("shipped", { ...booking, cancel_requested_at: null });
      break;
    }
    case "label": {
      // The courier label to print and stick on the parcel. Links last 24 hours, so we fetch a fresh one each time.
      if (!(isSeller || admin) || !order.shipment_id) throw new UserError("There's no courier label for this order.");
      const url = await requireDelivery().labelUrl(order.shipment_id);
      return json({ url });
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
      if (ret?.disputed_at) throw new UserError("You've already sent this to our team.");
      must(await db.from("returns").update({ disputed_at: new Date().toISOString() }).eq("order_id", orderId).is("disputed_at", null), "mark disputed");
      const { data: admins } = await db.from("profiles").select("id").eq("role", "admin");
      for (const a of admins ?? []) {
        await db.from("notifications").insert({ user_id: a.id, kind: "dispute", title: "Return disputed", body: `Order ${orderId}`, link: "/team/todo?f=returns" });
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

import { useState } from "react";
import { formatRand, refundFee } from "@app/core";
import { api, type Order } from "../api";
import { useSession } from "../session";
import { dateTimeText, ErrorNote, Sheet, useAction } from "./ui";

// Cancelling paid orders (migration 0035, decided with Ofentse 7 Nov 2026):
// buyers cancel freely within 1 hour of paying, then ask the seller (24 hours, no answer cancels it);
// sellers can cancel before shipping (5 trust points unless it wasn't their fault); our team can cancel any order.

const HOUR = 3600_000;
const BUYER_REASONS = ["Changed my mind", "Ordered by mistake", "Wrong size or colour", "Taking too long"];
const SELLER_REASONS = ["It's no longer available", "It's damaged", "I can't ship it in time", "The courier couldn't book it"];

/** Who cancelled and why, on a refunded order. */
export function CancelledNote({ o, side }: { o: Order; side: "buyer" | "seller" }) {
  if (o.status !== "refunded" || !o.cancelledBy) return null;
  const who = o.cancelledBy === "team" ? "Our team cancelled this order"
    : o.cancelledBy === "auto" ? "Cancelled: the seller didn't answer the cancel request in 24 hours"
    : o.cancelledBy === "buyer" ? (side === "buyer" ? "You cancelled this order" : "The buyer cancelled this order")
    : side === "seller" ? "You cancelled this order" : "The seller cancelled this order";
  return (
    <div className="note" style={{ marginTop: 12 }}>
      <b>{who}.</b>{o.cancelReason ? ` "${o.cancelReason}".` : ""} {side === "buyer" ? "Your money is going back to your card or account in full." : "The buyer has been refunded in full."}
    </div>
  );
}

/** Buyer: cancel (within an hour) or ask the seller to cancel, while the order hasn't shipped. */
export function BuyerCancel({ o, onDone }: { o: Order; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  if (o.status !== "paid") return null;
  const free = !!o.paidAt && Date.now() - new Date(o.paidAt).getTime() <= HOUR;
  if (o.cancelRequestedAt) {
    const by = new Date(new Date(o.cancelRequestedAt).getTime() + 24 * HOUR).toISOString();
    return (
      <div className="note amber" style={{ marginTop: 12 }}>
        <b>You asked to cancel.</b> The seller has until {dateTimeText(by)} to accept. If they don't answer, it's cancelled and refunded in full.
        If they ship it, you can still return it within 7 days of delivery.
      </div>
    );
  }
  return (
    <>
      <button className="btn line block" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>{free ? "Cancel order" : "Ask to cancel"}</button>
      {open && <ReasonSheet title={free ? "Cancel this order?" : "Ask the seller to cancel?"}
        intro={free ? "You paid less than an hour ago, so you can cancel now. You get a full refund."
          : "It's been more than an hour, so the seller may already be packing it. They have 24 hours to accept. If they don't answer, it's cancelled and you get a full refund."}
        reasons={BUYER_REASONS} optional confirm={free ? "Cancel and refund me" : "Ask to cancel"}
        onClose={() => setOpen(false)}
        onConfirm={async (reason) => { const r = await api.cancelOrder(o.id, reason); setOpen(false); onDone(); return r.cancelled ? "Order cancelled. Your refund is on the way." : "Request sent to the seller"; }} />}
    </>
  );
}

/** Seller: answer a buyer's request, or cancel the order themselves before shipping. */
export function SellerCancel({ o, onDone, part }: { o: Order; onDone: () => void; part: "request" | "button" }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  const { toast } = useSession();
  if (o.status !== "paid") return null;
  const answer = (accept: boolean) => run(async () => {
    await api.answerCancel(o.id, accept);
    toast(accept ? "Cancelled. The buyer is refunded." : "Okay. Ship it as normal.");
    onDone();
  });
  // Not the seller's fault: the courier couldn't book, or the buyer asked. Then no trust points are lost.
  const noFault = !!o.bookingFailedAt || !!o.cancelRequestedAt;
  return (
    <>
      {part === "request" && o.cancelRequestedAt && (
        <div className="card cancel-ask" style={{ marginTop: 14 }} role="region" aria-label="Cancel request">
          <b>The buyer asked to cancel</b>
          {o.cancelReason && <p style={{ margin: "4px 0 0" }}>"{o.cancelReason}"</p>}
          <p className="small muted" style={{ margin: "6px 0 10px" }}>
            Accept to refund them, or ship it as normal. If you don't answer by {dateTimeText(new Date(new Date(o.cancelRequestedAt).getTime() + 24 * HOUR).toISOString())}, it's cancelled.
            You don't lose trust points either way.
          </p>
          <ErrorNote error={error} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn green grow" disabled={busy} onClick={() => answer(true)}>Refund buyer</button>
            <button className="btn grow" disabled={busy} onClick={() => answer(false)}>I'll ship it</button>
          </div>
        </div>
      )}
      {part === "button" && <button className="btn line block danger-text" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>Cancel this order</button>}
      {open && <ReasonSheet title="Cancel this order?"
        intro={noFault ? "The buyer gets a full refund. You don't lose trust points, because this wasn't your fault."
          : `The buyer gets a full refund and you lose 5 trust points, the same as not shipping. TradeSafe's refund fee (about ${formatRand(refundFee(o.paymentMethod ?? null, o.totals.total))}) comes off your next sale. Only cancel if you really can't send it.`}
        reasons={SELLER_REASONS} confirm="Cancel and refund the buyer" danger
        onClose={() => setOpen(false)}
        onConfirm={async (reason) => { await api.sellerCancelOrder(o.id, reason!); setOpen(false); onDone(); return "Order cancelled. The buyer is refunded."; }} />}
    </>
  );
}

/** Team: cancel and refund any order, with a reason that goes in the team log. */
export function TeamCancel({ orderId, status, onDone }: { orderId: string; status: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [fault, setFault] = useState(false);
  if (!["paid", "shipped", "delivered", "return_requested", "return_in_transit"].includes(status)) return null;
  return (
    <>
      <button className="btn small line danger-text" onClick={() => setOpen(true)}>Cancel and refund</button>
      {open && <ReasonSheet title="Cancel and refund this order?"
        intro={status === "paid" ? "The buyer gets a full refund. The seller is told not to ship and loses no trust points."
          : "It has already shipped. The buyer gets a full refund and any courier booking is left as is. Sort out getting the item back separately."}
        reasons={["Fraud or a fake account", "Dispute decided for the buyer", "Our mistake", "Seller asked us"]} confirm="Cancel and refund" danger
        onClose={() => setOpen(false)}
        extra={<label className="check-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={fault} onChange={(e) => setFault(e.target.checked)} />
          <span>The seller's fault <span className="small muted" style={{ display: "block" }}>They pay TradeSafe's refund fee, taken from their next sale.</span></span>
        </label>}
        onConfirm={async (reason) => { await api.teamCancelOrder(orderId, reason!, fault); setOpen(false); onDone(); return "Cancelled and refunded"; }} />}
    </>
  );
}

function ReasonSheet({ title, intro, reasons, optional, confirm, danger, extra, onClose, onConfirm }: {
  title: string; intro: string; reasons: string[]; optional?: boolean; confirm: string; danger?: boolean; extra?: React.ReactNode;
  onClose: () => void; onConfirm: (reason: string | undefined) => Promise<string>;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const { busy, error, run } = useAction();
  const { toast } = useSession();
  const reason = pick === "Other" ? other.trim() : pick ?? "";
  const ready = optional || reason.length >= 3;
  return (
    <Sheet title={title} onClose={onClose}
      footer={<button className={`btn ${danger ? "danger" : "green"} block big`} disabled={!ready || busy} onClick={() => run(async () => toast(await onConfirm(reason || undefined)))}>{busy ? "One moment…" : confirm}</button>}>
      <p className="muted" style={{ marginTop: 0 }}>{intro}</p>
      <ErrorNote error={error} />
      <div className="reason-chips" role="group" aria-label="Why">
        {[...reasons, "Other"].map((r) => <button key={r} type="button" aria-pressed={pick === r} onClick={() => setPick(r)}>{r}</button>)}
      </div>
      {pick === "Other" && <input className="setup-input" style={{ marginTop: 10 }} value={other} onChange={(e) => setOther(e.target.value)} maxLength={300} placeholder="In a few words" aria-label="Reason" autoFocus />}
      {!optional && !pick && <p className="small muted">Pick a reason.</p>}
      {extra}
    </Sheet>
  );
}

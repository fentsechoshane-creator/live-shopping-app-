import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DELIVERY_OPTIONS, ORDER_STATUS_TEXT, returnReasonsFor, type ReturnReason } from "@app/core";
import { api, type Order } from "../../api";
import { useLoad, useSession } from "../../session";
import { ErrorNote, Field, Loading, R, dateText, dateTimeText, useAction } from "../../components/ui";

const REASON_TEXT: Record<ReturnReason, string> = {
  changed_mind: "I changed my mind",
  not_as_described: "Not as described",
  wrong_item: "Wrong item or size sent",
  faulty: "Faulty or damaged",
};

export function statusPill(o: Order, side: "buyer" | "seller") {
  const cls = ["refunded", "cancelled"].includes(o.status) ? "" : o.status === "completed" ? "green" : o.status.startsWith("return") ? "amber" : "dark";
  return <span className={`pill ${cls}`}>{ORDER_STATUS_TEXT[o.status][side]}</span>;
}

export function Orders() {
  const [orders, error] = useLoad(() => api.myOrders(), []);
  return (
    <div className="screen">
      <h1>My orders</h1>
      <ErrorNote error={error} />
      {!orders && !error && <Loading />}
      {orders?.length === 0 && <div className="empty">No orders yet. Find something in the feed.</div>}
      {orders?.map((o) => (
        <Link key={o.id} to={`/orders/${o.id}`} className="list-item">
          <div className="thumb" style={{ background: "#a8a29e" }}>{o.product.title.slice(0, 12)}</div>
          <div className="grow">
            <b>{o.product.title}</b>
            <div className="small muted">{o.shop.name} · {dateText(o.createdAt)}</div>
            <div style={{ marginTop: 4 }}>{statusPill(o, "buyer")}</div>
          </div>
          <b>{R(o.totals.total)}</b>
        </Link>
      ))}
    </div>
  );
}

export function OrderDetail() {
  const { id = "" } = useParams();
  const [o, error, reload] = useLoad(() => api.order(id), [id]);
  const { busy, error: actErr, run } = useAction();
  const { toast } = useSession();
  const nav = useNavigate();
  const [reason, setReason] = useState<ReturnReason | "">("");
  const [details, setDetails] = useState("");
  const [stars, setStars] = useState(0);

  if (error) return <div className="screen"><ErrorNote error={error} /></div>;
  if (o === undefined) return <div className="screen"><Loading /></div>;
  if (!o) return <div className="screen"><div className="empty">Order not found.</div></div>;

  const act = (fn: () => Promise<void>, msg: string) => run(async () => { await fn(); toast(msg); reload(); });
  const windowOpen = o.status === "delivered" && o.releasableAt && new Date(o.releasableAt) > new Date();

  return (
    <div className="screen">
      <button className="link" onClick={() => nav(-1)}>← Back</button>
      <h1 style={{ marginTop: 10 }}>{o.product.title}</h1>
      <div className="row between"><span className="muted small">from {o.shop.name}</span>{statusPill(o, "buyer")}</div>
      <ErrorNote error={actErr} />

      <h2>Where it is</h2>
      <Timeline o={o} />

      {o.status === "pending_payment" && (
        <div className="stack">
          {o.checkoutUrl && <a className="btn green block big" href={o.checkoutUrl}>Pay {R(o.totals.total)}</a>}
          <button className="btn line block" disabled={busy} onClick={() => act(() => api.cancelUnpaid(o.id), "Order cancelled")}>Cancel order</button>
        </div>
      )}

      {o.status === "shipped" && (
        <button className="btn green block big" disabled={busy} onClick={() => act(() => api.confirmReceived(o.id), "Thanks. Your return window has started.")}>
          I have received it
        </button>
      )}

      {windowOpen && (
        <div className="card" style={{ marginTop: 16 }}>
          <b>Something wrong?</b>
          <p className="small muted" style={{ margin: "4px 0 10px" }}>You can ask for a return until {dateTimeText(o.releasableAt)}. The seller is only paid after that.</p>
          <Field label="Reason">
            <select value={reason} onChange={(e) => setReason(e.target.value as ReturnReason)}>
              <option value="">Pick a reason</option>
              {returnReasonsFor(o.mode).map((r) => <option key={r} value={r}>{REASON_TEXT[r]}</option>)}
            </select>
          </Field>
          {reason === "changed_mind" && <div className="note" style={{ marginBottom: 12 }}>You pay the return postage. Everything else is refunded.</div>}
          {reason && reason !== "changed_mind" && <div className="note" style={{ marginBottom: 12 }}>The seller pays the return postage. We compare the listing video and packing video if you disagree.</div>}
          <Field label="Tell the seller what happened"><textarea value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
          <button className="btn dark block" disabled={!reason || busy} onClick={() => act(() => api.requestReturn(o.id, reason as ReturnReason, details), "Return requested")}>Ask for a return</button>
        </div>
      )}

      {o.ret && (
        <div className="note amber" style={{ marginTop: 16 }}>
          <b>Return: {REASON_TEXT[o.ret.reason]}</b><br />
          {o.ret.status === "requested" && "Waiting for the seller. If they do not answer in 3 days, a change of mind return is accepted automatically."}
          {o.ret.status === "in_transit" && `Send the item back. ${o.ret.postagePayer === "buyer" ? "You pay" : "The seller pays"} the return postage. Your refund follows once it arrives.`}
          {o.ret.status === "refunded" && "Refunded to your card or account."}
          {o.ret.status === "rejected" && "Our team found the item matched the listing, so the seller has been paid."}
        </div>
      )}

      {["delivered", "completed"].includes(o.status) && !o.review && (
        <div className="card" style={{ marginTop: 16 }}>
          <b>Rate this order</b>
          <div className="chips" style={{ margin: "10px 0" }} role="group" aria-label="Stars">
            {[1, 2, 3, 4, 5].map((n) => <button key={n} className="chip" aria-pressed={stars === n} onClick={() => setStars(n)}>{n} ★</button>)}
          </div>
          <button className="btn dark block" disabled={!stars || busy} onClick={() => act(() => api.leaveReview(o.id, stars, ""), "Thanks for rating")}>Send rating</button>
        </div>
      )}

      <h2>Payment</h2>
      <div className="price-rows">
        <div className="row"><span>Item{o.size ? ` (size ${o.size})` : ""}</span><span>{R(o.totals.itemPrice)}</span></div>
        <div className="row"><span>{DELIVERY_OPTIONS[o.delivery].label}</span><span>{o.totals.deliveryFee ? R(o.totals.deliveryFee) : "Free"}</span></div>
        <div className="row"><span>Buyer protection</span><span>{R(o.totals.protectionFee)}</span></div>
        {o.totals.creditUsed > 0 && <div className="row"><span>Welcome credit</span><span>-{R(o.totals.creditUsed)}</span></div>}
        <div className="row total"><span>Total</span><span>{R(o.totals.total)}</span></div>
      </div>
      {api.demo && <DemoTools orderId={o.id} onDone={reload} />}
    </div>
  );
}

export function Timeline({ o }: { o: Order }) {
  const steps: [string, string | null][] = [
    ["Paid, money held", o.paidAt],
    ["Shipped" + (o.trackingRef ? ` · ${o.trackingRef}` : ""), o.shippedAt],
    ["Delivered", o.deliveredAt],
    [o.mode === "buy_now" ? "7 day return window closes" : "Check period ends", o.status === "completed" ? o.releasableAt : null],
  ];
  return (
    <div className="checklist">
      {steps.map(([label, at]) => (
        <div className="item" key={label}>
          <span className={`dot ${at ? "done" : ""}`}>{at ? "✓" : ""}</span>
          <span className="grow">{label}</span>
          <span className="small muted">{dateTimeText(at)}</span>
        </div>
      ))}
      {o.status === "paid" && o.shipBy && <p className="small muted">The seller must ship by {dateTimeText(o.shipBy)}, or you get a full refund automatically.</p>}
      {o.status === "delivered" && o.releasableAt && <p className="small muted">Return window open until {dateTimeText(o.releasableAt)}.</p>}
    </div>
  );
}

function DemoTools({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  return (
    <div className="card" style={{ marginTop: 20, background: "#fffbeb", borderColor: "#fde68a" }}>
      <b>Demo tools</b>
      <p className="small muted" style={{ margin: "4px 0 10px" }}>Only in demo mode, to move the order along.</p>
      <div className="row">
        <button className="btn grow" onClick={() => api.demo!.markDelivered(orderId).then(onDone)}>Ship and deliver</button>
        <button className="btn grow" onClick={() => api.demo!.skipDays(8).then(onDone)}>Skip 8 days</button>
      </div>
    </div>
  );
}

export function MockPay() {
  const { id = "" } = useParams();
  const [o] = useLoad(() => api.order(id), [id]);
  const [method, setMethod] = useState("Instant EFT (Ozow)");
  const { busy, error, run } = useAction();
  const nav = useNavigate();
  return (
    <div className="screen">
      <div className="note amber" style={{ marginBottom: 16 }}>
        <b>Test payment page.</b> In live mode, buyers pay on TradeSafe's secure page and the money is held in escrow.
      </div>
      <h1>Pay {o ? R(o.totals.total) : ""}</h1>
      <p className="muted">{o?.product.title}</p>
      {["Instant EFT (Ozow)", "Card", "SnapScan"].map((m) => (
        <button key={m} className="choice" aria-pressed={method === m} onClick={() => setMethod(m)}><b>{m}</b></button>
      ))}
      <ErrorNote error={error} />
      <button className="btn green block big" disabled={busy || !o} onClick={() => run(async () => { await api.mockPay(id); nav(`/orders/${id}`, { replace: true }); })}>
        {busy ? "Paying…" : "Pay now"}
      </button>
    </div>
  );
}

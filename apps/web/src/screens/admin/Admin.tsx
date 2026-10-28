import { Navigate } from "react-router-dom";
import { api } from "../../api";
import { useLoad, useSession } from "../../session";
import { ErrorNote, Loading, R, useAction } from "../../components/ui";

/** Our team: approve ID and food certificates, and decide disputed returns. */
export function Admin() {
  const [isAdmin] = useLoad(() => api.isAdmin(), []);
  const [reviews, err1, reload1] = useLoad(() => api.pendingReviews(), []);
  const [disputes, err2, reload2] = useLoad(() => api.disputedOrders(), []);
  const [topups, , reload3] = useLoad(() => api.topUpsDue(), []);
  const { busy, error, run } = useAction();
  const { toast } = useSession();
  if (isAdmin === undefined) return <div className="screen"><Loading /></div>;
  if (!isAdmin) return <Navigate to="/" replace />;
  const act = (fn: () => Promise<void>, msg: string) => run(async () => { await fn(); toast(msg); reload1(); reload2(); reload3(); });

  return (
    <div className="screen">
      <h1>Team</h1>
      <ErrorNote error={error ?? err1 ?? err2} />
      <h2>Checks waiting</h2>
      {reviews?.length === 0 && <div className="empty">Nothing to check.</div>}
      {reviews?.map((r) => (
        <div key={r.shopId + r.what} className="card" style={{ marginBottom: 10 }}>
          <b>{r.shopName}</b> · {r.what === "id" ? "ID and selfie" : "Certificate of Acceptability"}
          <div className="row" style={{ margin: "8px 0", flexWrap: "wrap" }}>
            {r.files.map((f) => <a key={f.label} href={f.url} target="_blank" rel="noreferrer" className="link">{f.label}</a>)}
            {r.files.length === 0 && <span className="small muted">Demo: no files</span>}
          </div>
          <div className="row">
            <button className="btn green grow" disabled={busy} onClick={() => act(() => api.adminReview(r.shopId, r.what, true), "Approved")}>Approve</button>
            <button className="btn danger grow" disabled={busy} onClick={() => act(() => api.adminReview(r.shopId, r.what, false), "Sent back")}>Reject</button>
          </div>
        </div>
      ))}
      <h2>Welcome credit top ups to pay</h2>
      <p className="small muted">The welcome credit is our discount. When it is more than our cut, we EFT the seller the difference from the credit budget, on the payout date.</p>
      {topups?.length === 0 && <div className="empty">Nothing to pay.</div>}
      {topups?.map((t) => (
        <div key={t.payoutId} className="card row" style={{ marginBottom: 10 }}>
          <div className="grow"><b>{R(t.amountCents)}</b> to {t.shopName}<div className="small muted">{t.bank}{t.payOn ? ` · by ${t.payOn}` : " · payout held"}</div></div>
          <button className="btn dark" disabled={busy} onClick={() => act(() => api.markTopUpPaid(t.payoutId), "Marked as paid")}>Paid</button>
        </div>
      ))}
      <h2>Returns waiting</h2>
      {disputes?.length === 0 && <div className="empty">No open returns.</div>}
      {disputes?.map((o) => (
        <div key={o.id} className="card" style={{ marginBottom: 10 }}>
          <b>{o.product.title}</b> · {o.shop.name} · {R(o.totals.total)}
          <p className="small">{o.ret?.reason.replace(/_/g, " ")}: “{o.ret?.details}”</p>
          <p className="small muted">Compare the listing video, the packing video and the buyer's photos before deciding.</p>
          <div className="row">
            <button className="btn green grow" disabled={busy} onClick={() => act(() => api.decideReturn(o.id, true), "Buyer gets a refund")}>Buyer is right</button>
            <button className="btn line grow" disabled={busy} onClick={() => act(() => api.decideReturn(o.id, false), "Seller gets paid")}>Seller is right</button>
          </div>
        </div>
      ))}
    </div>
  );
}

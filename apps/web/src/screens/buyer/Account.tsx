import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { TIER_INFO } from "@app/core";
import { api, authMethod } from "../../api";
import { useLoad, useSession } from "../../session";
import { ErrorNote, Field, Loading, TierPill, dateTimeText, useAction } from "../../components/ui";
import { FeedList } from "./Feed";

export function SignIn() {
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const next = params.get("next") || "/";
  const phone = authMethod === "phone";

  return (
    <div className="screen">
      <h1>Sign in</h1>
      <p className="muted">One account for buying and selling. We send you a 6 digit code.</p>
      {api.mode === "demo" && <div className="note amber" style={{ marginBottom: 14 }}>Demo mode: use any email and the code <b>123456</b>. An email starting with “admin” signs in as our team.</div>}
      <ErrorNote error={error} />
      {!sent ? (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.sendCode(contact); setSent(true); }); }}>
          <Field label={phone ? "Cell number" : "Email"}>
            <input value={contact} onChange={(e) => setContact(e.target.value)} type={phone ? "tel" : "email"} inputMode={phone ? "tel" : "email"}
              autoComplete={phone ? "tel" : "email"} placeholder={phone ? "082 123 4567" : "you@example.com"} required />
          </Field>
          <button className="btn green block big" disabled={busy}>{busy ? "Sending…" : "Send code"}</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.verifyCode(contact, code); nav(next, { replace: true }); }); }}>
          <Field label="Code" hint={`Sent to ${contact}`}>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
          </Field>
          <button className="btn green block big" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
          <button type="button" className="link" style={{ marginTop: 12 }} onClick={() => setSent(false)}>Use a different {phone ? "number" : "email"}</button>
        </form>
      )}
    </div>
  );
}

export function Me() {
  const { user } = useSession();
  const [mode, setMode] = useState<"buying" | "selling">("buying");
  const [shop] = useLoad(() => (user ? api.myShop() : Promise.resolve(null)), [user?.id]);
  const [admin] = useLoad(() => (user ? api.isAdmin() : Promise.resolve(false)), [user?.id]);
  const nav = useNavigate();
  if (!user) return null;
  return (
    <div className="screen">
      <div className="row between">
        <h1>{user.displayName || user.email || user.phone}</h1>
      </div>
      <div className="seg light" role="group" aria-label="Mode" style={{ display: "flex", marginBottom: 16 }}>
        <button className="grow" aria-pressed={mode === "buying"} onClick={() => setMode("buying")}>Buying</button>
        <button className="grow" aria-pressed={mode === "selling"} onClick={() => setMode("selling")}>Selling</button>
      </div>
      {mode === "buying" ? (
        <div className="stack">
          <Link className="choice" to="/orders"><b>My orders</b><span>›</span></Link>
          <Link className="choice" to="/activity"><b>Activity</b><span>›</span></Link>
        </div>
      ) : shop ? (
        <div className="stack">
          <Link className="choice" to="/sell"><span><b>{shop.name}</b><small>@{shop.handle} · {shop.status === "open" ? "Open" : "Setting up"}</small></span><span>›</span></Link>
          <Link className="choice" to="/sell/orders"><b>Orders to ship</b><span>›</span></Link>
          <Link className="choice" to="/sell/payouts"><b>Payouts</b><span>›</span></Link>
        </div>
      ) : (
        <div className="card">
          <b>Start selling</b>
          <p className="small muted">Sell from video with money held safely. No monthly fee, 6% only when you sell.</p>
          <button className="btn green block" onClick={() => nav("/sell/start")}>Open a shop</button>
        </div>
      )}
      {admin && <Link className="choice" to="/admin" style={{ marginTop: 16 }}><b>Team: reviews and disputes</b><span>›</span></Link>}
      <button className="btn line block" style={{ marginTop: 24 }} onClick={() => api.signOut().then(() => nav("/"))}>Sign out</button>
      {api.demo && <button className="btn danger block" style={{ marginTop: 8 }} onClick={() => api.demo!.reset().then(() => nav("/"))}>Reset demo data</button>}
    </div>
  );
}

export function Activity() {
  const [items, error, reload] = useLoad(() => api.notifications(), []);
  useEffect(() => {
    if (items?.some((n) => !n.readAt)) api.markAllRead().catch(() => {});
  }, [items]);
  return (
    <div className="screen">
      <div className="row between"><h1>Activity</h1><button className="link" onClick={reload}>Refresh</button></div>
      <ErrorNote error={error} />
      {!items && !error && <Loading />}
      {items?.length === 0 && <div className="empty">Nothing yet. Orders, returns and shop updates show here.</div>}
      {items?.map((n) => (
        <Link key={n.id} to={n.link ?? "#"} className="list-item">
          <span className="dot" style={{ background: n.readAt ? "transparent" : "var(--brand)", borderColor: n.readAt ? "var(--line)" : "var(--brand)" }} />
          <div className="grow"><b>{n.title}</b><div className="small muted">{n.body}</div></div>
          <span className="small muted">{dateTimeText(n.createdAt)}</span>
        </Link>
      ))}
    </div>
  );
}

export function ShopPage() {
  const { handle = "" } = useParams();
  const [data, error] = useLoad(() => api.shop(handle), [handle]);
  if (error) return <div className="screen"><ErrorNote error={error} /></div>;
  if (data === undefined) return <div className="screen"><Loading /></div>;
  if (!data) return <div className="screen"><div className="empty">Shop not found.</div></div>;
  const { shop, items } = data;
  return (
    <div className="fill" style={{ overflowY: "auto", paddingBottom: "calc(var(--tab-h) + 8px)" }}>
      <div style={{ padding: 16 }}>
        <Link to="/" className="link">← Feed</Link>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="avatar" style={{ width: 56, height: 56, fontSize: 22 }}>{shop.name[0]}</span>
          <div className="grow"><h1 style={{ margin: 0, fontSize: 21 }}>{shop.name}</h1><span className="small muted">@{shop.handle}</span></div>
          <TierPill tier={shop.tier} />
        </div>
        {shop.bio && <p style={{ lineHeight: 1.5 }}>{shop.bio}</p>}
        <div className="row small muted" style={{ gap: 16 }}>
          <span><b style={{ color: "var(--ink)" }}>{shop.sales ?? 0}</b> sales</span>
          <span><b style={{ color: "var(--ink)" }}>{shop.trustScore}</b> trust score</span>
          {shop.founding && <span className="pill green">Founding seller</span>}
        </div>
        <p className="small muted">{TIER_INFO[shop.tier].label}: {TIER_INFO[shop.tier].range}</p>
      </div>
      <div className="feed" style={{ height: "auto", overflow: "visible" }}>
        <FeedList items={items} />
      </div>
    </div>
  );
}

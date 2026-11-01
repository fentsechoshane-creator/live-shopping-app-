// Team dashboard: one place for the myHaul team to run the app. Laptop first, works on a phone.
// Everything here reads and writes the same database as the app (admin_* functions), so what the team does
// shows in the app straight away, and what people do in the app shows here.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ORDER_STATUS_TEXT, REPORT_REASONS, type OrderStatus } from "@app/core";
import {
  api, type PeopleFilter, type TeamListing, type TeamListingFilter, type TeamOrder, type TeamOrderFilter, type TeamOverview,
  type TeamPerson, type TeamPersonDetail, type TeamLogEntry,
} from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { Avatar } from "../../components/Avatar";
import { SignInForm } from "../buyer/Account";
import { ErrorNote, R, dateText, dateTimeText, timeAgo, useAction } from "../../components/ui";

// ===== Shared state: the counts in the side menu, refreshed after every action =====
const TeamCtx = createContext<{ o: TeamOverview | null; refresh: () => void }>({ o: null, refresh: () => {} });
const useTeam = () => useContext(TeamCtx);

/** Runs a team action, shows a message, and refreshes the counts and the page. */
function useTeamAction(reload?: () => void) {
  const { busy, error, run, setError } = useAction();
  const { toast } = useSession();
  const { refresh } = useTeam();
  const act = (fn: () => Promise<unknown>, msg: string) => run(async () => { await fn(); toast(msg); refresh(); reload?.(); });
  return { busy, error, act, setError };
}

const NAV: { to: string; label: string; icon: string; count?: (o: TeamOverview) => number; urgent?: boolean }[] = [
  { to: "/team", label: "Overview", icon: "home" },
  { to: "/team/accounts", label: "Accounts", icon: "team" },
  { to: "/team/checks", label: "Seller checks", icon: "shield", count: (o) => o.checksWaiting, urgent: true },
  { to: "/team/reports", label: "Reports", icon: "flag", count: (o) => o.reportsOpen, urgent: true },
  { to: "/team/returns", label: "Returns", icon: "flip", count: (o) => o.returnsWaiting, urgent: true },
  { to: "/team/orders", label: "Orders", icon: "bag", count: (o) => o.late, urgent: true },
  { to: "/team/listings", label: "Listings", icon: "grid" },
  { to: "/team/money", label: "Money", icon: "payout", count: (o) => o.topUpsDue, urgent: true },
  { to: "/team/errors", label: "App errors", icon: "help", count: (o) => o.errors7 },
  { to: "/team/log", label: "Activity log", icon: "clock" },
];

export function TeamApp() {
  const { user, ready } = useSession();
  const [isAdmin] = useLoad(() => (user ? api.isAdmin() : Promise.resolve(false)), [user?.id]);
  const [o, setO] = useState<TeamOverview | null>(null);
  const [menu, setMenu] = useState(false);
  const refresh = () => { api.teamOverview().then(setO).catch(() => {}); };
  useEffect(() => { if (isAdmin) refresh(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.title = "myHaul Team"; return () => { document.title = "myHaul"; }; }, []);

  if (!ready || (user && isAdmin === undefined)) return <div className="team-gate"><div className="muted">Loading…</div></div>;
  if (!user) return (
    <div className="team-gate">
      <div className="team-gate-card">
        <div className="team-logo">myHaul <span>Team</span></div>
        <p className="muted">Sign in with your team account.</p>
        <SignInForm onDone={() => {}} />
      </div>
    </div>
  );
  if (!isAdmin) return (
    <div className="team-gate">
      <div className="team-gate-card">
        <div className="team-logo">myHaul <span>Team</span></div>
        <p>This page is for the myHaul team. Ask someone on the team to add your account.</p>
        <Link to="/" className="btn line block">Back to the app</Link>
      </div>
    </div>
  );

  return (
    <TeamCtx.Provider value={{ o, refresh }}>
      <div className="team">
        <aside className={`team-nav ${menu ? "open" : ""}`}>
          <div className="team-logo">myHaul <span>Team</span></div>
          <nav onClick={() => setMenu(false)}>
            {NAV.map((n) => {
              const c = o && n.count ? n.count(o) : 0;
              return (
                <NavLink key={n.to} to={n.to} end={n.to === "/team"} className={({ isActive }) => `team-link ${isActive ? "on" : ""}`}>
                  <Icon name={n.icon as any} size={18} /><span className="grow">{n.label}</span>
                  {c > 0 && <span className={`team-count ${n.urgent ? "urgent" : ""}`}>{c}</span>}
                </NavLink>
              );
            })}
          </nav>
          <div className="team-nav-foot">
            <Link to="/" className="team-link"><Icon name="back" size={18} /><span className="grow">Back to the app</span></Link>
            <div className="small muted" style={{ padding: "6px 12px" }}>{api.mode === "demo" ? "Demo data" : "Live data"}</div>
          </div>
        </aside>
        {menu && <div className="team-scrim" onClick={() => setMenu(false)} />}
        <main className="team-main">
          <div className="team-topbar">
            <button className="team-menu-btn" aria-label="Menu" onClick={() => setMenu(true)}><Icon name="menu" size={22} /></button>
            <div className="team-logo small">myHaul <span>Team</span></div>
          </div>
          <Routes>
            <Route path="/team" element={<Overview />} />
            <Route path="/team/accounts" element={<Accounts />} />
            <Route path="/team/accounts/:id" element={<Person />} />
            <Route path="/team/checks" element={<Checks />} />
            <Route path="/team/reports" element={<Reports />} />
            <Route path="/team/returns" element={<Returns />} />
            <Route path="/team/orders" element={<Orders />} />
            <Route path="/team/listings" element={<Listings />} />
            <Route path="/team/money" element={<Money />} />
            <Route path="/team/errors" element={<Errors />} />
            <Route path="/team/log" element={<Log />} />
            <Route path="*" element={<Overview />} />
          </Routes>
        </main>
      </div>
    </TeamCtx.Provider>
  );
}

// ===== Small building blocks =====
function Head({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="team-head">
      <div className="grow"><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      {right}
    </header>
  );
}

function Filters<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="team-filters" role="tablist">
      {options.map(([v, l]) => <button key={v} role="tab" aria-selected={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="team-search">
      <Icon name="search" size={17} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button aria-label="Clear search" onClick={() => onChange("")}><Icon name="close" size={15} /></button>}
    </label>
  );
}

/** Waits a moment after typing before searching. */
function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = window.setTimeout(() => setD(v), ms); return () => window.clearTimeout(t); }, [v, ms]);
  return d;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="team-empty"><Icon name="check" size={22} /><div>{children}</div></div>;
}

/** Asks for a reason before a serious action. The person affected sees the reason. */
function ReasonDialog({ title, body, confirm, danger = true, busy, onCancel, onConfirm }: {
  title: string; body: string; confirm: string; danger?: boolean; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="team-modal-scrim" onClick={onCancel}>
      <div className="team-modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted">{body}</p>
        <div className="field">
          <label htmlFor="team-reason">Reason (they see this)</label>
          <textarea id="team-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus
            placeholder="For example: Selling copies of branded shoes." />
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="btn line" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? "danger" : "dark"}`} disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}

const ORDER_PILL: Partial<Record<OrderStatus, string>> = {
  paid: "amber", return_requested: "red", return_in_transit: "amber", completed: "green", refunded: "", cancelled: "", shipped: "blue", delivered: "blue",
};
const orderStatus = (s: OrderStatus) => ORDER_STATUS_TEXT[s]?.seller ?? s;
const checkWord: Record<string, string> = { not_started: "Not started", pending: "Waiting", approved: "Approved", rejected: "Rejected" };
const checkPill: Record<string, string> = { pending: "amber", approved: "green", rejected: "red", not_started: "" };
const shopWord: Record<string, string> = { onboarding: "Setting up", open: "Open", paused: "Paused", banned: "Closed" };
const shopPill: Record<string, string> = { onboarding: "", open: "green", paused: "amber", banned: "red" };

// ===== Overview =====
function Overview() {
  const { o, refresh } = useTeam();
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return <div className="team-page"><Head title="Overview" /><div className="muted">Loading…</div></div>;
  const max = Math.max(1, ...o.daily.map((d) => d.orders));
  const todo = [
    { n: o.checksWaiting, t: "seller checks to approve", to: "/team/checks" },
    { n: o.reportsOpen, t: "reports to answer (within 24 hours)", to: "/team/reports" },
    { n: o.returnsWaiting, t: "returns to decide", to: "/team/returns" },
    { n: o.late, t: "orders past their ship by date", to: "/team/orders?f=late" },
    { n: o.topUpsDue, t: `welcome credit top ups to pay (${R(o.topUpsDueCents)})`, to: "/team/money" },
    { n: o.errors7, t: "app errors this week", to: "/team/errors" },
  ].filter((x) => x.n > 0);
  return (
    <div className="team-page">
      <Head title="Overview" sub="The last 30 days, in rand. Updated every time you open this page." />
      <section className="team-kpis">
        <Kpi label="Sales" value={R(o.sales30Cents)} sub={`${o.orders30} paid orders`} />
        <Kpi label="Our fees" value={R(o.fees30Cents)} sub={`Welcome credit given: ${R(o.credit30Cents)}`} />
        <Kpi label="Orders today" value={String(o.ordersToday)} sub={`${o.toShip} waiting to ship`} />
        <Kpi label="People" value={String(o.people)} sub={`${o.peopleNew7} new this week`} />
        <Kpi label="Open shops" value={String(o.shopsOpen)} sub={`${o.shopsOnboarding} setting up, ${o.shopsClosed} paused or closed`} />
        <Kpi label="Live listings" value={String(o.liveListings)} sub={`${o.auctionsOpen} auctions running`} />
      </section>
      <div className="team-cols">
        <section className="team-card">
          <h2>Needs you</h2>
          {todo.length === 0 ? <Empty>All caught up.</Empty> : (
            <div className="team-todo">
              {todo.map((x) => (
                <Link key={x.to} to={x.to} className="team-todo-row"><b>{x.n}</b><span className="grow">{x.t}</span><Icon name="chevron" size={16} /></Link>
              ))}
            </div>
          )}
        </section>
        <section className="team-card">
          <h2>Paid orders, last 14 days</h2>
          <div className="team-bars" role="img" aria-label={`Paid orders per day: ${o.daily.map((d) => d.orders).join(", ")}`}>
            {o.daily.map((d) => (
              <div key={d.day} className="team-bar" title={`${dateText(d.day)}: ${d.orders} orders, ${R(d.salesCents)}`}>
                <span className="v">{d.orders || ""}</span>
                <span className="b" style={{ height: `${(d.orders / max) * 100}%` }} />
                <span className="d">{new Date(d.day + "T12:00:00").toLocaleDateString("en-ZA", { day: "numeric" })}</span>
              </div>
            ))}
          </div>
          <h3>All orders by status</h3>
          <div className="team-status-list">
            {Object.entries(o.byStatus).length === 0 && <span className="muted small">No orders yet.</span>}
            {(Object.entries(o.byStatus) as [OrderStatus, number][]).map(([s, n]) => (
              <Link key={s} to="/team/orders" className={`pill ${ORDER_PILL[s] ?? ""}`}>{orderStatus(s)}: {n}</Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="team-kpi"><div className="l">{label}</div><div className="v">{value}</div><div className="s">{sub}</div></div>;
}

// ===== Accounts =====
function Accounts() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get("f") as PeopleFilter) || "all";
  const [q, setQ] = useState(params.get("q") ?? "");
  const dq = useDebounced(q);
  const [rows, setRows] = useState<TeamPerson[] | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    let live = true; setRows(null); setErr(null);
    api.teamPeople(dq, filter).then((r) => { if (live) { setRows(r); setMore(r.length === 50); } }).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [dq, filter]);
  const setFilter = (f: PeopleFilter) => setParams((p) => { p.set("f", f); return p; }, { replace: true });
  const loadMore = async () => { const r = await api.teamPeople(dq, filter, rows?.length ?? 0); setRows((c) => [...(c ?? []), ...r]); setMore(r.length === 50); };
  return (
    <div className="team-page">
      <Head title="Accounts" sub="Everyone who has signed up. Open someone to see their shop, orders, trust history and reports." />
      <div className="team-toolbar">
        <Search value={q} onChange={setQ} placeholder="Search name, @username, email or shop" />
        <Filters value={filter} onChange={setFilter} options={[["all", "Everyone"], ["sellers", "Sellers"], ["buyers", "Buyers"], ["waiting", "Checks waiting"], ["suspended", "Suspended"], ["team", "Team"]]} />
      </div>
      <ErrorNote error={err} />
      {rows && rows.length === 0 && <Empty>No accounts match.</Empty>}
      {rows === null && !err && <div className="muted">Loading…</div>}
      {rows && rows.length > 0 && (
        <table className="tt">
          <thead><tr><th>Person</th><th>Email</th><th>Shop</th><th>Trust</th><th>Orders</th><th>Joined</th><th aria-label="Flags" /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="click" tabIndex={0} onClick={() => nav(`/team/accounts/${p.id}`)} onKeyDown={(e) => e.key === "Enter" && nav(`/team/accounts/${p.id}`)}>
                <td data-l="Person"><div className="team-who"><Avatar url={p.avatarUrl} name={p.name || p.handle || "?"} size={32} /><div><b>{p.name || "No name yet"}</b><div className="small muted">{p.handle ? "@" + p.handle : "Not set up"}</div></div></div></td>
                <td data-l="Email" className="small">{p.email ?? "—"}</td>
                <td data-l="Shop">{p.shop ? <span><span className={`sdot ${shopPill[p.shop.status]}`} />{p.shop.name}</span> : <span className="muted">Buyer</span>}</td>
                <td data-l="Trust"><b>{p.trust}</b> <span className="small muted">{p.tier}</span></td>
                <td data-l="Orders" className="small">{p.ordersBought} bought, {p.ordersSold} sold</td>
                <td data-l="Joined" className="small">{dateText(p.createdAt)}</td>
                <td data-l="Flags"><div className="team-flags">
                  {p.role === "admin" && <span className="pill blue">Team</span>}
                  {p.suspendedAt && <span className="pill red">Suspended</span>}
                  {(p.shop?.idStatus === "pending" || p.shop?.certStatus === "pending") && <span className="pill amber">Check waiting</span>}
                  {p.reportsAgainst > 0 && <span className="pill red">{p.reportsAgainst} report{p.reportsAgainst > 1 ? "s" : ""}</span>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more && <button className="btn line" style={{ marginTop: 12 }} onClick={loadMore}>Load more</button>}
    </div>
  );
}

function Person() {
  const { id = "" } = useParams();
  const [p, err, reload] = useLoad(() => api.teamPerson(id), [id]);
  const { busy, error, act } = useTeamAction(reload);
  const { user } = useSession();
  const [ask, setAsk] = useState<null | "suspend" | "pause" | "close">(null);
  if (err) return <div className="team-page"><BackTo /><ErrorNote error={err} /></div>;
  if (!p) return <div className="team-page"><BackTo /><div className="muted">Loading…</div></div>;
  const me = user?.id === p.id;
  const sh = p.shop;
  return (
    <div className="team-page">
      <BackTo />
      <header className="team-person-head">
        <Avatar url={p.avatarUrl} name={p.name || p.handle || "?"} size={64} />
        <div className="grow">
          <h1>{p.name || "No name yet"}</h1>
          <div className="muted">{p.handle ? "@" + p.handle : "Account not set up"} · {p.email ?? "no email"} · joined {dateText(p.createdAt)}</div>
          <div className="team-flags" style={{ marginTop: 8 }}>
            {p.role === "admin" && <span className="pill blue">Team</span>}
            {p.suspendedAt && <span className="pill red">Suspended {timeAgo(p.suspendedAt)}</span>}
            <span className="pill">Trust {p.trust} · {p.tier}</span>
            {!p.setUp && <span className="pill amber">Setup not finished</span>}
          </div>
        </div>
      </header>
      <ErrorNote error={error} />
      {p.suspendedAt && <div className="team-banner red"><b>Suspended.</b> {p.suspendedReason} They can sign in and see their orders, but can't buy, sell, bid, comment or message.</div>}

      <div className="team-actions">
        {!me && p.role !== "admin" && (p.suspendedAt
          ? <button className="btn dark" disabled={busy} onClick={() => act(() => api.unsuspendAccount(p.id), "Suspension lifted")}>Lift suspension</button>
          : <button className="btn danger" disabled={busy} onClick={() => setAsk("suspend")}>Suspend account</button>)}
        {sh && sh.status === "open" && <button className="btn line" disabled={busy} onClick={() => setAsk("pause")}>Pause shop</button>}
        {sh && sh.status !== "banned" && <button className="btn line" disabled={busy} onClick={() => setAsk("close")}>Close shop</button>}
        {sh && sh.status !== "open" && sh.status !== "onboarding" && !p.suspendedAt && (
          <button className="btn line" disabled={busy} onClick={() => act(() => api.setShopStatus(sh.id, "open"), "Shop opened")}>Open shop</button>)}
        {!me && !p.suspendedAt && (p.role === "admin"
          ? <button className="btn line" disabled={busy} onClick={() => act(() => api.setTeamRole(p.id, "user"), "Removed from the team")}>Remove from team</button>
          : <button className="btn line" disabled={busy} onClick={() => act(() => api.setTeamRole(p.id, "admin"), "Added to the team")}>Add to team</button>)}
        {sh && <Link className="btn line" to={`/s/${sh.handle}`} target="_blank">View shop in the app</Link>}
      </div>

      <div className="team-cols">
        <section className="team-card">
          <h2>Account</h2>
          <dl className="team-dl">
            <dt>Bio</dt><dd>{p.bio || "—"}</dd>
            <dt>City</dt><dd>{p.city || "—"}</dd>
            <dt>18 or older</dt><dd>{p.adultConfirmedAt ? `Confirmed ${dateText(p.adultConfirmedAt)}` : "Not confirmed"}</dd>
            <dt>Terms</dt><dd>{p.termsAcceptedAt ? `Accepted ${dateText(p.termsAcceptedAt)}` : "Not accepted"}</dd>
            <dt>Orders</dt><dd>{p.ordersBought} bought, {p.ordersSold} sold</dd>
          </dl>
        </section>
        <section className="team-card">
          <h2>Shop</h2>
          {!sh ? <p className="muted">No shop. This person only buys.</p> : (
            <>
              <div className="row between" style={{ marginBottom: 8 }}><b>{sh.name}</b><span className={`pill ${shopPill[sh.status]}`}>{shopWord[sh.status]}</span></div>
              <dl className="team-dl">
                <dt>Handle</dt><dd>@{sh.handle}</dd>
                <dt>Category</dt><dd style={{ textTransform: "capitalize" }}>{sh.category}</dd>
                <dt>Cell</dt><dd>{p.phone ?? "—"}</dd>
                <dt>Bank</dt><dd>{p.bank ?? "—"}</dd>
                <dt>Live listings</dt><dd>{p.liveListings}</dd>
              </dl>
              <div className="team-checks">
                <CheckRow label="ID and selfie" status={sh.idStatus} busy={busy}
                  onApprove={() => act(() => api.adminReview(sh.id, "id", true), "ID approved")} onReject={() => act(() => api.adminReview(sh.id, "id", false), "ID sent back")} />
                <CheckRow label="Bank details" status={sh.bankStatus} busy={busy} />
                {sh.category === "food" && <CheckRow label="Food certificate" status={sh.certStatus} busy={busy}
                  onApprove={() => act(() => api.adminReview(sh.id, "cert", true), "Certificate approved")} onReject={() => act(() => api.adminReview(sh.id, "cert", false), "Certificate sent back")} />}
              </div>
              {p.files.length > 0 && <div className="team-files">{p.files.map((f) => <a key={f.label} href={f.url} target="_blank" rel="noreferrer" className="btn line">{f.label}</a>)}</div>}
            </>
          )}
        </section>
      </div>

      <section className="team-card">
        <h2>Orders</h2>
        {p.orders.length === 0 ? <p className="muted">No orders yet.</p> : (
          <table className="tt">
            <thead><tr><th>Item</th><th>Side</th><th>With</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>{p.orders.map((o) => (
              <tr key={o.id}><td data-l="Item">{o.title}</td><td data-l="Side">{o.side === "bought" ? "Bought" : "Sold"}</td><td data-l="With">{o.other}</td>
                <td data-l="Total">{R(o.totalCents)}</td><td data-l="Status"><span className={`pill ${ORDER_PILL[o.status] ?? ""}`}>{orderStatus(o.status)}</span></td><td data-l="Date" className="small">{dateText(o.createdAt)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>

      <div className="team-cols">
        <section className="team-card">
          <h2>Trust history</h2>
          {p.trustEvents.length === 0 ? <p className="muted">Nothing yet. Everyone starts at 50.</p> : (
            <ul className="team-list">{p.trustEvents.map((e, i) => (
              <li key={i}><span className={`pts ${e.points >= 0 ? "up" : "down"}`}>{e.points > 0 ? "+" : ""}{e.points}</span><span className="grow">{e.kind.replace(/_/g, " ")}{e.note ? `: ${e.note}` : ""}</span><span className="small muted">{timeAgo(e.at)}</span></li>
            ))}</ul>
          )}
        </section>
        <section className="team-card">
          <h2>Reports about them</h2>
          {p.reports.length === 0 ? <p className="muted">No reports.</p> : (
            <ul className="team-list">{p.reports.map((r) => (
              <li key={r.id}><span className={`pill ${r.status === "open" ? "red" : ""}`}>{r.status === "open" ? "Open" : r.status === "actioned" ? "Acted on" : "Dismissed"}</span>
                <span className="grow">{REPORT_REASONS[r.reason]} ({r.targetKind}){r.details ? `: “${r.details}”` : ""}</span><span className="small muted">{timeAgo(r.createdAt)}</span></li>
            ))}</ul>
          )}
        </section>
      </div>

      <section className="team-card">
        <h2>What the team did</h2>
        {p.actions.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="team-list">{p.actions.map((a, i) => (
            <li key={i}><b>{a.action}</b><span className="grow muted">{a.note ?? ""}</span><span className="small muted">{a.by} · {dateTimeText(a.at)}</span></li>
          ))}</ul>
        )}
      </section>

      {ask === "suspend" && <ReasonDialog title={`Suspend ${p.name || "this account"}?`} confirm="Suspend" busy={busy} onCancel={() => setAsk(null)}
        body="They can still sign in and see their orders, but can't buy, sell, bid, comment or message. Their shop is paused. You can lift it any time."
        onConfirm={(r) => { setAsk(null); act(() => api.suspendAccount(p.id, r), "Account suspended"); }} />}
      {ask === "pause" && sh && <ReasonDialog title={`Pause ${sh.name}?`} confirm="Pause shop" busy={busy} onCancel={() => setAsk(null)}
        body="Their listings stop showing until you open the shop again. Open orders carry on."
        onConfirm={(r) => { setAsk(null); act(() => api.setShopStatus(sh.id, "paused", r), "Shop paused"); }} />}
      {ask === "close" && sh && <ReasonDialog title={`Close ${sh.name}?`} confirm="Close shop" busy={busy} onCancel={() => setAsk(null)}
        body="For serious problems like fakes or scams. All their live listings are removed. Open orders carry on."
        onConfirm={(r) => { setAsk(null); act(() => api.setShopStatus(sh.id, "banned", r), "Shop closed"); }} />}
    </div>
  );
}

function BackTo() {
  const nav = useNavigate();
  return <button className="team-back" onClick={() => (window.history.length > 1 ? nav(-1) : nav("/team/accounts"))}><Icon name="back" size={16} />Back</button>;
}

function CheckRow({ label, status, busy, onApprove, onReject }: { label: string; status: string; busy: boolean; onApprove?: () => void; onReject?: () => void }) {
  return (
    <div className="team-check">
      <span className="grow">{label}</span>
      <span className={`pill ${checkPill[status] ?? ""}`}>{checkWord[status] ?? status}</span>
      {status === "pending" && onApprove && onReject && (
        <><button className="btn green small" disabled={busy} onClick={onApprove}>Approve</button><button className="btn danger small" disabled={busy} onClick={onReject}>Reject</button></>
      )}
    </div>
  );
}

// ===== Seller checks =====
function Checks() {
  const [rows, err, reload] = useLoad(() => api.pendingReviews(), []);
  const { busy, error, act } = useTeamAction(reload);
  return (
    <div className="team-page">
      <Head title="Seller checks" sub="Compare the ID with the selfie, and the name with the bank account. Approved sellers get 10 trust points." />
      <ErrorNote error={error ?? err} />
      {rows?.length === 0 && <Empty>Nothing to check.</Empty>}
      <div className="team-grid">
        {rows?.map((r) => (
          <section key={r.shopId + r.what} className="team-card">
            <div className="row between"><h2 style={{ margin: 0 }}>{r.shopName}</h2><span className="pill amber">{r.what === "id" ? "ID and selfie" : "Food certificate"}</span></div>
            <div className="team-files">
              {r.files.map((f) => <a key={f.label} href={f.url} target="_blank" rel="noreferrer" className="btn line">{f.label}</a>)}
              {r.files.length === 0 && <span className="small muted">Demo: no files to open.</span>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn green grow" disabled={busy} onClick={() => act(() => api.adminReview(r.shopId, r.what, true), "Approved")}>Approve</button>
              <button className="btn danger grow" disabled={busy} onClick={() => act(() => api.adminReview(r.shopId, r.what, false), "Sent back")}>Reject</button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ===== Reports =====
function Reports() {
  const [rows, err, reload] = useLoad(() => api.openReports(), []);
  const { busy, error, act } = useTeamAction(reload);
  return (
    <div className="team-page">
      <Head title="Reports" sub="Things people flagged in the app. Answer within 24 hours: the app stores require it." />
      <ErrorNote error={error ?? err} />
      {rows?.length === 0 && <Empty>No open reports.</Empty>}
      <div className="team-grid">
        {rows?.map((r) => (
          <section key={r.id} className="team-card">
            <div className="row between"><b>{REPORT_REASONS[r.reason]}</b><span className="pill">{r.targetKind}</span></div>
            {r.summary && <p>“{r.summary}”</p>}
            {r.details && <p className="small muted">Reporter: {r.details}</p>}
            <p className="small muted">{timeAgo(r.createdAt)}</p>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn danger grow" disabled={busy || r.targetKind === "user" || r.targetKind === "message"}
                onClick={() => act(() => api.handleReport(r.id, "remove"), r.targetKind === "shop" ? "Shop closed" : "Removed")}>
                {r.targetKind === "shop" ? "Close shop" : "Remove it"}</button>
              <button className="btn line grow" disabled={busy} onClick={() => act(() => api.handleReport(r.id, "dismiss"), "Dismissed")}>Dismiss</button>
            </div>
            {(r.targetKind === "user" || r.targetKind === "message") && <p className="small muted" style={{ marginTop: 8 }}>For people and messages, find the account under Accounts and suspend it if needed.</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

// ===== Returns =====
function Returns() {
  const [rows, err, reload] = useLoad(() => api.disputedOrders(), []);
  const { busy, error, act } = useTeamAction(reload);
  return (
    <div className="team-page">
      <Head title="Returns" sub="The seller disagreed with a return. Compare the listing video, the packing video and the buyer's photos before deciding." />
      <ErrorNote error={error ?? err} />
      {rows?.length === 0 && <Empty>No returns to decide.</Empty>}
      <div className="team-grid">
        {rows?.map((o) => (
          <section key={o.id} className="team-card">
            <div className="row between"><b>{o.product.title}</b><b>{R(o.totals.total)}</b></div>
            <p className="small muted">{o.shop.name} · ordered {dateText(o.createdAt)}</p>
            <p><b>{o.ret?.reason.replace(/_/g, " ")}</b>{o.ret?.details ? `: “${o.ret.details}”` : ""}</p>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn green grow" disabled={busy} onClick={() => act(() => api.decideReturn(o.id, true), "Buyer gets a refund")}>Buyer is right</button>
              <button className="btn line grow" disabled={busy} onClick={() => act(() => api.decideReturn(o.id, false), "Seller gets paid")}>Seller is right</button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ===== Orders =====
function Orders() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get("f") as TeamOrderFilter) || "all";
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [rows, setRows] = useState<TeamOrder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setRows(null);
    api.teamOrders(dq, filter).then((r) => live && setRows(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [dq, filter]);
  const totals = useMemo(() => (rows ?? []).reduce((a, o) => ({ sales: a.sales + o.totalCents, fees: a.fees + o.feeCents }), { sales: 0, fees: 0 }), [rows]);
  return (
    <div className="team-page">
      <Head title="Orders" sub="Every paid order. Money is held by escrow until the return window closes." />
      <div className="team-toolbar">
        <Search value={q} onChange={setQ} placeholder="Search item, shop, @buyer or order number" />
        <Filters value={filter} onChange={(f) => setParams((p) => { p.set("f", f); return p; }, { replace: true })}
          options={[["all", "All"], ["open", "In progress"], ["to_ship", "To ship"], ["late", "Late"], ["returns", "Returns"], ["done", "Finished"]]} />
      </div>
      <ErrorNote error={err} />
      {rows && rows.length > 0 && <p className="small muted">{rows.length} orders shown · {R(totals.sales)} sales · {R(totals.fees)} our fees</p>}
      {rows?.length === 0 && <Empty>No orders here.</Empty>}
      {rows === null && !err && <div className="muted">Loading…</div>}
      {rows && rows.length > 0 && (
        <table className="tt">
          <thead><tr><th>Item</th><th>Shop</th><th>Buyer</th><th>Total</th><th>Our fee</th><th>Status</th><th>Payout</th><th>Date</th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}>
              <td data-l="Item"><b>{o.title}</b>{o.mode !== "buy_now" && <div className="small muted">{o.mode === "auction" ? "Auction" : "Made to order"}</div>}</td>
              <td data-l="Shop"><Link to={`/team/accounts/${o.sellerId}`}>{o.shopName}</Link></td>
              <td data-l="Buyer"><Link to={`/team/accounts/${o.buyerId}`}>@{o.buyer}</Link></td>
              <td data-l="Total">{R(o.totalCents)}{o.creditCents > 0 && <div className="small muted">incl. {R(o.creditCents)} credit</div>}</td>
              <td data-l="Our fee">{R(o.feeCents)}</td>
              <td data-l="Status"><span className={`pill ${o.late ? "red" : ORDER_PILL[o.status] ?? ""}`}>{o.late ? "Late to ship" : orderStatus(o.status)}</span>
                {o.returnReason && <div className="small muted">{o.returnReason.replace(/_/g, " ")}</div>}</td>
              <td data-l="Payout" className="small">{o.payoutStatus ? `${o.payoutStatus}${o.payOn ? `, ${dateText(o.payOn)}` : ""}` : "—"}</td>
              <td data-l="Date" className="small">{dateText(o.createdAt)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

// ===== Listings =====
function Listings() {
  const [filter, setFilter] = useState<TeamListingFilter>("live");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [rows, setRows] = useState<TeamListing[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const { busy, error, act } = useTeamAction(() => setN((x) => x + 1));
  const [removing, setRemoving] = useState<TeamListing | null>(null);
  useEffect(() => {
    let live = true; setRows(null);
    api.teamListings(dq, filter).then((r) => live && setRows(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [dq, filter, n]);
  return (
    <div className="team-page">
      <Head title="Listings" sub="What is for sale right now. Remove anything fake, unsafe or against the seller rules." />
      <div className="team-toolbar">
        <Search value={q} onChange={setQ} placeholder="Search item or shop" />
        <Filters value={filter} onChange={setFilter} options={[["live", "Live"], ["auctions", "Auctions"], ["proof", "Designer proof to check"], ["removed", "Removed"]]} />
      </div>
      <ErrorNote error={error ?? err} />
      {rows?.length === 0 && <Empty>Nothing here.</Empty>}
      {rows === null && !err && <div className="muted">Loading…</div>}
      {rows && rows.length > 0 && (
        <table className="tt">
          <thead><tr><th>Item</th><th>Shop</th><th>Price</th><th>Type</th><th>Stock</th><th aria-label="Flags" /><th aria-label="Actions" /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td data-l="Item"><b>{p.title}</b><div className="small muted">{p.label.replace(/_/g, " ")}</div></td>
              <td data-l="Shop"><Link to={`/team/accounts/${p.sellerId}`}>{p.shopName}</Link></td>
              <td data-l="Price">{R(p.priceCents)}</td>
              <td data-l="Type" className="small">{p.mode === "auction" ? `Auction${p.auctionState ? `, ${p.auctionState}` : ""}` : p.mode === "order_now" ? "Made to order" : "Buy now"}</td>
              <td data-l="Stock">{p.stock}</td>
              <td data-l="Flags"><div className="team-flags">
                {p.reports > 0 && <span className="pill red">{p.reports} report{p.reports > 1 ? "s" : ""}</span>}
                {p.proofStatus === "pending" && <span className="pill amber">Proof to check</span>}
                {p.status === "removed" && <span className="pill">Removed</span>}
              </div></td>
              <td data-l="">{p.status === "live" && <button className="btn danger small" disabled={busy} onClick={() => setRemoving(p)}>Remove</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {removing && <ReasonDialog title={`Remove “${removing.title}”?`} confirm="Remove listing" busy={busy} onCancel={() => setRemoving(null)}
        body="It stops showing in the app straight away. The seller is told why."
        onConfirm={(r) => { const p = removing; setRemoving(null); act(() => api.removeListing(p.id, r), "Listing removed"); }} />}
    </div>
  );
}

// ===== Money =====
function Money() {
  const { o } = useTeam();
  const [rows, err, reload] = useLoad(() => api.topUpsDue(), []);
  const { busy, error, act } = useTeamAction(reload);
  return (
    <div className="team-page">
      <Head title="Money" sub="Escrow holds buyers' money and pays sellers. We only pay welcome credit top ups ourselves." />
      {o && (
        <section className="team-kpis">
          <Kpi label="Sales, 30 days" value={R(o.sales30Cents)} sub={`${o.orders30} paid orders`} />
          <Kpi label="Our fees, 30 days" value={R(o.fees30Cents)} sub="Seller fee and buyer protection" />
          <Kpi label="Welcome credit, 30 days" value={R(o.credit30Cents)} sub="Paid from the credit budget" />
          <Kpi label="Top ups to pay" value={R(o.topUpsDueCents)} sub={`${o.topUpsDue} sellers`} />
        </section>
      )}
      <section className="team-card">
        <h2>Welcome credit top ups to pay</h2>
        <p className="small muted">When the R50 credit is more than our cut, we EFT the seller the difference from our account, on the payout date. Mark it paid once the EFT has gone through.</p>
        <ErrorNote error={error ?? err} />
        {rows?.length === 0 && <Empty>Nothing to pay.</Empty>}
        {rows && rows.length > 0 && (
          <table className="tt">
            <thead><tr><th>Shop</th><th>Bank</th><th>Amount</th><th>Pay by</th><th aria-label="Actions" /></tr></thead>
            <tbody>{rows.map((t) => (
              <tr key={t.payoutId}><td data-l="Shop"><b>{t.shopName}</b></td><td data-l="Bank">{t.bank}</td><td data-l="Amount"><b>{R(t.amountCents)}</b></td>
                <td data-l="Pay by">{t.payOn ? dateText(t.payOn) : "Payout held"}</td>
                <td data-l=""><button className="btn dark small" disabled={busy} onClick={() => act(() => api.markTopUpPaid(t.payoutId), "Marked as paid")}>Mark paid</button></td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ===== App errors =====
function Errors() {
  const [rows, err] = useLoad(() => api.recentErrors(), []);
  return (
    <div className="team-page">
      <Head title="App errors" sub="Crashes and errors from people's phones in the last 30 days, newest first. Share them with Lehloma to fix." />
      <ErrorNote error={err} />
      {rows?.length === 0 && <Empty>No errors reported.</Empty>}
      {rows && rows.length > 0 && (
        <section className="team-card" style={{ padding: 0 }}>
          {rows.map((e) => (
            <details key={e.id} className="team-error">
              <summary><b>{e.message}</b><div className="small muted">{e.path ?? "?"} · {e.platform ?? "?"} · {e.version ?? "?"} · {timeAgo(e.createdAt)}</div></summary>
              {e.stack && <pre>{e.stack}</pre>}
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

// ===== Activity log =====
function Log() {
  const [rows, err] = useLoad<TeamLogEntry[]>(() => api.teamLog(), []);
  return (
    <div className="team-page">
      <Head title="Activity log" sub="Everything the team has done, newest first. Nobody can edit or delete it." />
      <ErrorNote error={err} />
      {rows?.length === 0 && <Empty>Nothing yet.</Empty>}
      {rows && rows.length > 0 && (
        <table className="tt">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>About</th><th>Note</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id}>
              <td data-l="When" className="small">{dateTimeText(a.at)}</td>
              <td data-l="Who">@{a.by}</td>
              <td data-l="What"><b>{a.action}</b></td>
              <td data-l="About">{a.targetKind === "user" && a.targetId ? <Link to={`/team/accounts/${a.targetId}`}>{a.target ?? "Account"}</Link> : a.target ?? a.targetKind}</td>
              <td data-l="Note" className="small muted">{a.note ?? ""}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

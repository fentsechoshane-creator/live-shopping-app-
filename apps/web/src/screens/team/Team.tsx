// Team dashboard: one place for the myHaul team to run the app. Laptop first, works on a phone.
// Everything here reads and writes the same database as the app (admin_* functions), so what the team does
// shows in the app straight away, and what people do in the app shows here.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { TeamCancel } from "../../components/CancelOrder";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ACCOUNT_FEATURES, ORDER_STATUS_TEXT, REPORT_REASONS, type AccountFeature, type FeatureState, type OrderStatus } from "@app/core";
import {
  api, type PeopleFilter, type TeamListing, type TeamListingFilter, type TeamOrder, type TeamOrderFilter, type TeamOverview,
  type TeamPerson, type TeamPersonDetail, type TeamLogEntry, type TeamAlert, type PackingProof,
} from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { Avatar } from "../../components/Avatar";
import { SignInForm } from "../buyer/Account";
import { ErrorNote, R, dateText, dateTimeText, timeAgo, useAction } from "../../components/ui";

// ===== Shared state: the counts in the side menu, refreshed after every action =====
const TeamCtx = createContext<{ o: TeamOverview | null; alerts: TeamAlert[]; packing: number; refresh: () => void }>({ o: null, alerts: [], packing: 0, refresh: () => {} });
const useTeam = () => useContext(TeamCtx);

/** Runs a team action, shows a message, and refreshes the counts and the page. */
function useTeamAction(reload?: () => void) {
  const { busy, error, run, setError } = useAction();
  const { toast } = useSession();
  const { refresh } = useTeam();
  const act = (fn: () => Promise<unknown>, msg: string) => run(async () => { await fn(); toast(msg); refresh(); reload?.(); });
  return { busy, error, act, setError };
}

type NavItem = { to: string; label: string; icon: string; count?: (o: TeamOverview, alerts: TeamAlert[], packing: number) => number; urgent?: boolean };
const todoCount = (o: TeamOverview) => o.checksWaiting + o.reportsOpen + o.returnsWaiting + o.late + o.topUpsDue;
/** The menu, grouped by what you're doing: work to do, looking something up, keeping the app running. */
const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [
    { to: "/team", label: "Overview", icon: "home" },
    { to: "/team/todo", label: "To do", icon: "check", count: (o, _a, p) => todoCount(o) + p, urgent: true },
  ] },
  { group: "Look up", items: [
    { to: "/team/accounts", label: "Accounts", icon: "team" },
    { to: "/team/orders", label: "Orders", icon: "bag" },
    { to: "/team/listings", label: "Listings", icon: "grid" },
    { to: "/team/money", label: "Money", icon: "payout" },
  ] },
  { group: "System", items: [
    { to: "/team/errors", label: "App errors", icon: "help", count: (o) => o.errors7 },
    { to: "/team/log", label: "Activity log", icon: "clock" },
  ] },
];

export function TeamApp() {
  const { user, ready } = useSession();
  const [isAdmin] = useLoad(() => (user ? api.isAdmin() : Promise.resolve(false)), [user?.id]);
  const [o, setO] = useState<TeamOverview | null>(null);
  const [menu, setMenu] = useState(false);
  const [alerts, setAlerts] = useState<TeamAlert[]>([]);
  const [packing, setPacking] = useState(0);
  const refresh = () => { api.teamOverview().then(setO).catch(() => {}); api.teamAlerts().then(setAlerts).catch(() => {}); api.teamPackingQueue().then((q) => setPacking(q.length)).catch(() => {}); };
  useEffect(() => { if (isAdmin) refresh(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the counts fresh while the dashboard is open.
  useEffect(() => { if (!isAdmin) return; const t = window.setInterval(refresh, 60_000); return () => window.clearInterval(t); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <TeamCtx.Provider value={{ o, alerts, packing, refresh }}>
      <div className="team">
        <aside className={`team-nav ${menu ? "open" : ""}`}>
          <div className="team-logo">myHaul <span>Team</span></div>
          <nav onClick={() => setMenu(false)}>
            {NAV.map((g) => (
              <div key={g.group ?? "main"} className="team-nav-group">
                {g.group && <div className="team-nav-h">{g.group}</div>}
                {g.items.map((n) => {
                  const c = o && n.count ? n.count(o, alerts, packing) : 0;
                  return (
                    <NavLink key={n.to} to={n.to} end={n.to === "/team"} className={({ isActive }) => `team-link ${isActive ? "on" : ""}`}>
                      <Icon name={n.icon as any} size={18} /><span className="grow">{n.label}</span>
                      {c > 0 && <span className={`team-count ${n.urgent ? "urgent" : ""}`}>{c}</span>}
                    </NavLink>
                  );
                })}
              </div>
            ))}
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
            <GlobalSearch />
          </div>
          <Routes>
            <Route path="/team" element={<Overview />} />
            <Route path="/team/todo" element={<Todo />} />
            <Route path="/team/accounts" element={<Accounts />} />
            <Route path="/team/accounts/:id" element={<Person />} />
            {/* Old addresses (alert links, bookmarks) open the matching part of To do. */}
            <Route path="/team/alerts" element={<Navigate to="/team/todo" replace />} />
            <Route path="/team/checks" element={<Navigate to="/team/todo?f=checks" replace />} />
            <Route path="/team/reports" element={<Navigate to="/team/todo?f=reports" replace />} />
            <Route path="/team/returns" element={<Navigate to="/team/todo?f=returns" replace />} />
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
function ReasonDialog({ title, body, confirm, danger = true, busy, onCancel, onConfirm, reasonLabel = "Reason (they see this)", placeholder = "For example: Selling copies of branded shoes." }: {
  title: string; body: string; confirm: string; danger?: boolean; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void;
  reasonLabel?: string; placeholder?: string;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="team-modal-scrim" onClick={onCancel}>
      <div className="team-modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted">{body}</p>
        <div className="field">
          <label htmlFor="team-reason">{reasonLabel}</label>
          <textarea id="team-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus
            placeholder={placeholder} />
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
  const { o, alerts, refresh } = useTeam();
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return <div className="team-page"><Head title="Overview" /><div className="muted">Loading…</div></div>;
  const max = Math.max(1, ...o.daily.map((d) => d.orders));
  const todo = [
    { n: o.checksWaiting, t: "seller checks to approve", to: "/team/todo?f=checks" },
    { n: o.reportsOpen, t: "reports to answer (within 24 hours)", to: "/team/todo?f=reports" },
    { n: o.returnsWaiting, t: "returns to decide", to: "/team/todo?f=returns" },
    { n: o.late, t: "orders past their ship by date", to: "/team/todo?f=late" },
    { n: o.topUpsDue, t: `reward top ups to pay (${R(o.topUpsDueCents)})`, to: "/team/todo?f=topups" },
    { n: o.errors7, t: "app errors this week", to: "/team/errors" },
  ].filter((x) => x.n > 0);
  return (
    <div className="team-page">
      <Head title="Overview" sub="The last 30 days, in rand. Updated every time you open this page." />
      {alerts.some((a) => !a.seen && a.severity === "urgent") && (
        <Link to="/team/todo" className="team-banner red" style={{ display: "block", textDecoration: "none" }}>
          <b>{alerts.filter((a) => !a.seen && a.severity === "urgent").length} urgent {alerts.filter((a) => !a.seen && a.severity === "urgent").length === 1 ? "alert" : "alerts"}.</b> {alerts.find((a) => !a.seen && a.severity === "urgent")!.title}. Open To do.
        </Link>
      )}
      <section className="team-kpis">
        <Kpi label="Sales" value={R(o.sales30Cents)} sub={`${o.orders30} paid orders`} />
        <Kpi label="Our fees" value={R(o.fees30Cents)} sub={`Rewards spent: ${R(o.credit30Cents)}`} />
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
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "overview" | "orders" | "features" | "history") || "overview";
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

      <Filters value={tab} onChange={(v) => setParams(v === "overview" ? {} : { tab: v }, { replace: true })}
        options={[["overview", "Overview"], ["orders", `Orders (${p.orders.length})`], ["features", "Features"], ["history", "History"]]} />

      {tab === "overview" && <div className="team-cols">
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
      </div>}

      {tab === "features" && <Features userId={p.id} hasShop={!!sh} onChange={reload} />}

      {tab === "orders" && <section className="team-card">
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
      </section>}

      {tab === "history" && <>
      <PersonRewards userId={p.id} />
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
      </>}

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

/** Per account switches: auto follows the normal rules and milestones, on and off override them. The database enforces them. */
function Features({ userId, hasShop, onChange }: { userId: string; hasShop: boolean; onChange: () => void }) {
  const [f, err, reload] = useLoad(() => api.teamFeatures(userId), [userId]);
  const { busy, error, act } = useTeamAction(() => { reload(); onChange(); });
  const [ask, setAsk] = useState<null | { key: AccountFeature; state: FeatureState }>(null);
  const [all, setAll] = useState(false);
  const info = ask ? ACCOUNT_FEATURES.find((x) => x.key === ask.key)! : null;
  const set = (key: AccountFeature, state: FeatureState) => {
    if (state === "auto") act(() => api.setAccountFeature(userId, key, "auto"), "Back to the normal rules");
    else setAsk({ key, state });
  };
  const changed = f ? ACCOUNT_FEATURES.filter((x) => f[x.key].state !== "auto").length : 0;
  return (
    <section className="team-card">
      <div className="row between"><h2>Features</h2>{changed > 0 && <span className="pill amber">{changed} changed</span>}</div>
      <p className="muted small" style={{ marginTop: 0 }}>Auto follows the normal rules. On skips a milestone. Off blocks it. Legal checks (ID, bank, food certificate, designer proof) can't be skipped, so some can only be turned off.</p>
      <ErrorNote error={err ?? error} />
      {!f ? <div className="muted">Loading…</div> : (["buying", "selling"] as const)
        .filter((side) => all || changed === 0 || ACCOUNT_FEATURES.some((x) => x.side === side && f[x.key].state !== "auto")).map((side) => (
        <div key={side} className="team-features">
          <h3>{side === "buying" ? "Buying" : "Selling"}{side === "selling" && !hasShop ? " (no shop yet)" : ""}</h3>
          {ACCOUNT_FEATURES.filter((x) => x.side === side && (all || changed === 0 || f[x.key].state !== "auto")).map((x) => {
            const cur = f[x.key];
            const now = cur.state === "auto" ? cur.autoOk : cur.state === "on";
            return (
              <div key={x.key} className="team-feature">
                <div className="grow">
                  <div className="row" style={{ gap: 8 }}><b>{x.label}</b>
                    <span className={`pill ${now ? "green" : "red"}`}>{now ? "Allowed" : "Blocked"}</span></div>
                  <div className="small muted">{cur.state === "auto" ? (cur.autoNote === "Allowed" ? x.auto : `${x.auto} Now: ${cur.autoNote}.`) : cur.state === "on" ? x.on : x.off}</div>
                  {cur.state !== "auto" && <div className="small">{cur.state === "on" ? "Turned on" : "Turned off"} by {cur.by ?? "team"}{cur.at ? ` ${timeAgo(cur.at)}` : ""}: {cur.reason}</div>}
                </div>
                <div className="seg" role="group" aria-label={x.label}>
                  {(["auto", "on", "off"] as const).map((st) => (
                    <button key={st} aria-pressed={cur.state === st} disabled={busy || (st === "on" && !x.on) || cur.state === st}
                      title={st === "on" && !x.on ? "Can only be turned off" : undefined} onClick={() => set(x.key, st)}>
                      {st === "auto" ? "Auto" : st === "on" ? "On" : "Off"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {f && changed > 0 && <button className="btn line small" style={{ marginTop: 12 }} onClick={() => setAll(!all)}>
        {all ? "Show only changed" : `Show all ${ACCOUNT_FEATURES.length}`}</button>}
      {ask && info && <ReasonDialog title={`${ask.state === "on" ? "Turn on" : "Turn off"} ${info.label.toLowerCase()}?`} confirm={ask.state === "on" ? "Turn on" : "Turn off"}
        danger={ask.state === "off"} busy={busy} onCancel={() => setAsk(null)} body={(ask.state === "on" ? info.on : info.off) ?? ""}
        reasonLabel="Reason (only the team sees this)" placeholder={ask.state === "on" ? "For example: Founding seller, early access." : "For example: Checking a report."}
        onConfirm={(r) => { const a = ask; setAsk(null); act(() => api.setAccountFeature(userId, a.key, a.state, r), a.state === "on" ? "Turned on" : "Turned off"); }} />}
    </section>
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
    <section className="todo-section">
      <h2>Seller checks</h2>
      <p className="small muted">Compare the ID with the selfie, and the name with the bank account. Approved sellers get 10 trust points.</p>
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
    </section>
  );
}

// ===== Reports =====
function Reports() {
  const [rows, err, reload] = useLoad(() => api.openReports(), []);
  const { busy, error, act } = useTeamAction(reload);
  return (
    <section className="todo-section">
      <h2>Reports</h2>
      <p className="small muted">Things people flagged in the app. Answer within 24 hours: the app stores require it.</p>
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
    </section>
  );
}

// ===== Returns =====
function Returns() {
  const [rows, err, reload] = useLoad(() => api.disputedOrders(), []);
  const { busy, error, act } = useTeamAction(reload);
  return (
    <section className="todo-section">
      <h2>Returns</h2>
      <p className="small muted">The seller disagreed with a return. Compare the listing video, the packing video and the buyer's photos. No packing video, or one that doesn't show the item clearly, means the buyer is right.</p>
      <ErrorNote error={error ?? err} />
      {rows?.length === 0 && <Empty>No returns to decide.</Empty>}
      <div className="team-grid">
        {rows?.map((o) => (
          <section key={o.id} className="team-card">
            <div className="row between"><b>{o.product.title}</b><b>{R(o.totals.total)}</b></div>
            <p className="small muted">{o.shop.name} · ordered {dateText(o.createdAt)}</p>
            <p><b>{o.ret?.reason.replace(/_/g, " ")}</b>{o.ret?.details ? `: “${o.ret.details}”` : ""}</p>
            <div className="row" style={{ gap: 8 }}>
              <PackingButton orderId={o.id} />
              <button className="btn green grow" disabled={busy} onClick={() => act(() => api.decideReturn(o.id, true), "Buyer gets a refund")}>Buyer is right</button>
              <button className="btn line grow" disabled={busy} onClick={() => act(() => api.decideReturn(o.id, false), "Seller gets paid")}>Seller is right</button>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

// ===== Orders =====
function Orders() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get("f") as TeamOrderFilter) || "all";
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => { const x = params.get("q"); if (x != null) setQ(x); }, [params.get("q")]); // eslint-disable-line react-hooks/exhaustive-deps
  const dq = useDebounced(q);
  const [rows, setRows] = useState<TeamOrder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true; setRows(null);
    api.teamOrders(dq, filter).then((r) => live && setRows(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [dq, filter, reloadKey]);
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
          <thead><tr><th>Item</th><th>Shop</th><th>Buyer</th><th>Total</th><th>Our fee</th><th>Status</th><th>Payout</th><th>Packing</th><th>Date</th></tr></thead>
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
              <td data-l="Packing">{["pending_payment", "paid", "cancelled"].includes(o.status) ? <span className="small muted">Not shipped</span> : <PackingButton orderId={o.id} small />}
                <div style={{ marginTop: 6 }}><TeamCancel orderId={o.id} status={o.status} onDone={() => setReloadKey((k) => k + 1)} /></div></td>
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
/** Reward top ups we pay ourselves. On Money and in To do. */
function TopUps() {
  const [rows, err, reload] = useLoad(() => api.topUpsDue(), []);
  const { busy, error, act } = useTeamAction(reload);
  return (
      <section className="team-card todo-section">
        <h2>Reward top ups to pay</h2>
        <p className="small muted">When a R50 reward is more than our cut, we EFT the seller the difference from our account, on the payout date. Check the warning signs first: sellers can make fake buyer accounts to collect top ups. Only pay once the order is finished, and mark it paid once the EFT has gone through.</p>
        <ErrorNote error={error ?? err} />
        {rows?.length === 0 && <Empty>Nothing to pay.</Empty>}
        {rows && rows.length > 0 && (
          <table className="tt">
            <thead><tr><th>Shop</th><th>Buyer</th><th>Bank</th><th>Amount</th><th>Pay by</th><th>Check first</th><th aria-label="Actions" /></tr></thead>
            <tbody>{rows.map((t) => (
              <tr key={t.payoutId}><td data-l="Shop">{t.sellerId ? <Link to={`/team/accounts/${t.sellerId}`}>{t.shopName}</Link> : <b>{t.shopName}</b>}</td>
                <td data-l="Buyer">{t.buyerId ? <Link to={`/team/accounts/${t.buyerId}`}>@{t.buyer}</Link> : "—"}</td>
                <td data-l="Bank">{t.bank}</td><td data-l="Amount"><b>{R(t.amountCents)}</b></td>
                <td data-l="Pay by">{t.payOn ? dateText(t.payOn) : "Payout held"}</td>
                <td data-l="Check first"><div className="team-flags">{(t.flags ?? []).length === 0 ? <span className="pill green">Looks fine</span>
                  : t.flags!.map((f) => <span key={f} className="pill amber">{f}</span>)}</div></td>
                <td data-l=""><button className="btn dark small" disabled={busy} onClick={() => act(() => api.markTopUpPaid(t.payoutId), "Marked as paid")}>Mark paid</button></td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
  );
}

function Money() {
  const { o } = useTeam();
  return (
    <div className="team-page">
      <Head title="Money" sub="Escrow holds buyers' money and pays sellers. We only pay reward top ups ourselves." />
      {o && (
        <section className="team-kpis">
          <Kpi label="Sales, 30 days" value={R(o.sales30Cents)} sub={`${o.orders30} paid orders`} />
          <Kpi label="Our fees, 30 days" value={R(o.fees30Cents)} sub="Seller fee and buyer protection" />
          <Kpi label="Rewards spent, 30 days" value={R(o.credit30Cents)} sub="Paid from the rewards budget" />
          <Kpi label="Top ups to pay" value={R(o.topUpsDueCents)} sub={`${o.topUpsDue} sellers`} />
        </section>
      )}
      <TopUps />
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

// ===== Alerts =====
/** Everything that needs the team, in one list. Handling an item clears it everywhere. Alerts on phones, Telegram and email point here. */
type TodoFilter = "all" | "checks" | "reports" | "returns" | "late" | "topups" | "packing";
function Todo() {
  const { o, alerts, packing, refresh } = useTeam();
  const [params, setParams] = useSearchParams();
  const f = (params.get("f") as TodoFilter) || "all";
  const set = (v: TodoFilter) => setParams(v === "all" ? {} : { f: v }, { replace: true });
  // Looking at the list counts as seeing the alerts, so the urgent banner on Overview clears.
  useEffect(() => {
    const ids = alerts.filter((a) => !a.seen).map((a) => a.id);
    if (ids.length) api.markAlertsSeen(ids).then(refresh).catch(() => {});
  }, [alerts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = { checks: o?.checksWaiting ?? 0, reports: o?.reportsOpen ?? 0, returns: o?.returnsWaiting ?? 0, late: o?.late ?? 0, topups: o?.topUpsDue ?? 0, packing };
  const total = n.checks + n.reports + n.returns + n.late + n.topups + n.packing;
  const label = (t: string, c: number) => (c > 0 ? `${t} (${c})` : t);
  const show = (k: Exclude<TodoFilter, "all">) => f === k || (f === "all" && n[k] > 0);
  return (
    <div className="team-page">
      <Head title="To do" sub="Everything that needs the team. Reports first: the app stores want an answer within 24 hours." />
      <div className="team-toolbar">
        <Filters value={f} onChange={set} options={[["all", label("All", total)], ["reports", label("Reports", n.reports)], ["checks", label("Seller checks", n.checks)],
          ["returns", label("Returns", n.returns)], ["late", label("Late orders", n.late)], ["topups", label("Top ups", n.topups)], ["packing", label("Packing checks", n.packing)]]} />
      </div>
      {o && f === "all" && total === 0 && <Empty>All caught up.</Empty>}
      {show("reports") && <Reports />}
      {show("checks") && <Checks />}
      {show("returns") && <Returns />}
      {show("late") && <LateOrders />}
      {show("topups") && <TopUps />}
      {show("packing") && <PackingChecks />}
      {alerts.length > 0 && (
        <details className="team-card todo-sent">
          <summary><b>Alerts we sent</b> <span className="small muted">to the team's phones, Telegram and email</span></summary>
          {alerts.slice(0, 30).map((a) => (
            <div key={a.id} className="team-alert seen">
              <span className={`pill ${a.severity === "urgent" ? "red" : "amber"}`}>{a.severity === "urgent" ? "Urgent" : "To do"}</span>
              <span className="grow"><b>{a.title}</b><span className="small muted" style={{ display: "block" }}>{a.body}</span></span>
              <span className="small muted">{timeAgo(a.createdAt)}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/** Orders past their ship by date. They refund by themselves if the seller never ships. */
function LateOrders() {
  const [rows, err] = useLoad(() => api.teamOrders("", "late"), []);
  return (
    <section className="todo-section">
      <h2>Late orders</h2>
      <p className="small muted">Past the ship by date. Remind the seller; unshipped orders refund the buyer automatically.</p>
      <ErrorNote error={err} />
      {rows?.length === 0 && <Empty>No late orders.</Empty>}
      {rows && rows.length > 0 && (
        <table className="tt">
          <thead><tr><th>Item</th><th>Shop</th><th>Buyer</th><th>Total</th><th>Ordered</th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}><td data-l="Item"><b>{o.title}</b></td><td data-l="Shop"><Link to={`/team/accounts/${o.sellerId}`}>{o.shopName}</Link></td>
              <td data-l="Buyer"><Link to={`/team/accounts/${o.buyerId}`}>@{o.buyer}</Link></td><td data-l="Total">{R(o.totalCents)}</td><td data-l="Ordered" className="small">{dateText(o.createdAt)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

/** Surprise rewards this person earned (never advertised). */
function PersonRewards({ userId }: { userId: string }) {
  const [rows] = useLoad(() => api.teamRewards(userId), [userId]);
  const word: Record<string, string> = { first_buy: "First order", first_auction: "First auction win", first_sale: "First sale" };
  const st: Record<string, [string, string]> = { pending: ["amber", "Waiting for return window"], ready: ["green", "Ready"], used: ["", "Used"], forfeited: ["red", "Removed (returned)"] };
  return (
    <section className="team-card">
      <h2>Surprise rewards</h2>
      {!rows ? <div className="muted">Loading…</div> : rows.length === 0 ? <p className="muted">None earned yet.</p> : (
        <ul className="team-list">{rows.map((r, i) => (
          <li key={i}><b>{R(r.amountCents)}</b><span className="grow">{word[r.kind]}</span><span className={`pill ${st[r.status][0]}`}>{st[r.status][1]}</span><span className="small muted">{timeAgo(r.createdAt)}</span></li>
        ))}</ul>
      )}
    </section>
  );
}

/** Opens one order's packing proof. */
function PackingButton({ orderId, small }: { orderId: string; small?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className={`btn line ${small ? "small" : "grow"}`} onClick={() => setOpen(true)}>Packing proof</button>
    {open && <PackingDialog orderId={orderId} onClose={() => setOpen(false)} />}
  </>;
}

/** The video, the parcel photo and the code, with the team's verdict and a link to send a buyer who asked. */
function PackingDialog({ orderId, onClose, onDone }: { orderId: string; onClose: () => void; onDone?: () => void }) {
  const [p, err, reload] = useLoad<PackingProof>(() => api.teamPacking(orderId), [orderId]);
  const { busy, error, act } = useTeamAction(() => { reload(); onDone?.(); });
  const [strike, setStrike] = useState(false);
  const share = () => act(async () => {
    const l = await api.teamPackingShare(orderId, "Buyer asked by email");
    const text = [l.video && `Packing video: ${l.video}`, l.photo && `Sealed parcel photo: ${l.photo}`].filter(Boolean).join("\n");
    await navigator.clipboard?.writeText(text).catch(() => {});
  }, "Links copied. They expire in 7 days.");
  return (
    <div className="team-modal-scrim" onClick={onClose}>
      <div className="team-modal wide" role="dialog" aria-label="Packing proof" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>Packing proof</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
        <ErrorNote error={err ?? error} />
        {!p ? <div className="muted">Loading…</div> : p.purgedAt ? <p className="muted">Deleted on {dateText(p.purgedAt)}, 6 months after delivery.</p> : !p.videoUrl && !p.photoUrl ? (
          <p className="muted">No packing proof on this order. {api.mode === "demo" ? "(Demo: proof is kept on the phone that shipped it.)" : "Orders shipped before packing proof was required have none. In a dispute, the buyer is right."}</p>
        ) : (
          <>
            <p className="small">Code to look for: <b>{p.code}</b> · shipped {p.shippedAt ? dateTimeText(p.shippedAt) : "—"} · this shop has <b>{p.strikes90}</b> {p.strikes90 === 1 ? "strike" : "strikes"} in 90 days</p>
            <div className="pack-media">
              {p.videoUrl && <video src={p.videoUrl} controls playsInline preload="metadata" aria-label="Packing video" />}
              {p.photoUrl && <img src={p.photoUrl} alt="Sealed parcel" />}
            </div>
            <p className="small muted">Check: the code shows, the item is shown from every side with any flaws, it goes into the parcel, and the parcel is sealed with the code visible.</p>
            {p.review && <p><span className={`pill ${p.review === "ok" ? "green" : "red"}`}>{p.review === "ok" ? "Checked: fine" : "Strike given"}</span> <span className="small muted">{p.reviewedAt ? timeAgo(p.reviewedAt) : ""}</span></p>}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {!p.review && <button className="btn green" disabled={busy} onClick={() => act(() => api.teamPackingReview(orderId, true), "Marked as fine")}>Looks fine</button>}
              {p.review !== "strike" && <button className="btn danger" disabled={busy} onClick={() => setStrike(true)}>Doesn't follow the rules</button>}
              <button className="btn line" disabled={busy} onClick={share}>Copy links for the buyer (7 days)</button>
            </div>
          </>
        )}
        {strike && <ReasonDialog title="Give a packing strike?" confirm="Give strike" busy={busy} onCancel={() => setStrike(false)}
          body="1st strike is a warning. 2nd loses trust points. 3rd in 90 days pauses their listings. They're told why."
          reasonLabel="What was wrong (the seller sees this)" placeholder="For example: The item was never shown out of the bag."
          onConfirm={(r) => { setStrike(false); act(() => api.teamPackingReview(orderId, false, r), "Strike given. The seller has been told."); }} />}
      </div>
    </div>
  );
}

/** Spot checks: some recent shipments, picked at random, to catch bad packing habits before a dispute does. */
function PackingChecks() {
  const [rows, err, reload] = useLoad(() => api.teamPackingQueue(), []);
  const { refresh } = useTeam();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="todo-section">
      <h2>Packing checks</h2>
      <p className="small muted">Random shipments from the last 2 weeks. Watch the video: code, every side of the item, sealed parcel.</p>
      <ErrorNote error={err} />
      {rows?.length === 0 && <Empty>No packing checks waiting.</Empty>}
      {rows && rows.length > 0 && (
        <table className="tt">
          <thead><tr><th>Item</th><th>Shop</th><th>Code</th><th>Shipped</th><th aria-label="Actions" /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.orderId}><td data-l="Item"><b>{r.title}</b></td><td data-l="Shop"><Link to={`/team/accounts/${r.sellerId}`}>{r.shopName}</Link></td>
              <td data-l="Code">{r.code}</td><td data-l="Shipped" className="small">{timeAgo(r.shippedAt)}</td>
              <td data-l=""><button className="btn dark small" onClick={() => setOpen(r.orderId)}>Check</button></td></tr>
          ))}</tbody>
        </table>
      )}
      {open && <PackingDialog orderId={open} onClose={() => setOpen(null)} onDone={() => { reload(); refresh(); }} />}
    </section>
  );
}

/** Search from every page: people by name, @handle, email or shop, and orders by item or order number. */
function GlobalSearch() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<{ people: TeamPerson[]; orders: TeamOrder[] } | null>(null);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => { setOpen(false); setQ(""); }, [loc.pathname]);
  useEffect(() => {
    if (dq.length < 2) return setRes(null);
    let live = true;
    Promise.all([api.teamPeople(dq, "all"), api.teamOrders(dq, "all")])
      .then(([people, orders]) => live && setRes({ people: people.slice(0, 5), orders: orders.slice(0, 5) })).catch(() => live && setRes({ people: [], orders: [] }));
    return () => { live = false; };
  }, [dq]);
  const first = res?.people[0] ? `/team/accounts/${res.people[0].id}` : res?.orders[0] ? `/team/orders?q=${encodeURIComponent(dq)}` : null;
  return (
    <div className="team-gsearch" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <label className="team-search">
        <Icon name="search" size={17} />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" && first) nav(first); if (e.key === "Escape") setOpen(false); }}
          placeholder="Search people, shops, emails or orders" aria-label="Search people, shops, emails or orders" />
        {q && <button aria-label="Clear search" onClick={() => setQ("")}><Icon name="close" size={15} /></button>}
      </label>
      {open && dq.length >= 2 && (
        <div className="team-gresults" role="listbox" aria-label="Search results">
          {!res && <div className="muted small" style={{ padding: 12 }}>Searching…</div>}
          {res && res.people.length + res.orders.length === 0 && <div className="muted small" style={{ padding: 12 }}>Nothing found for “{dq}”.</div>}
          {res && res.people.length > 0 && <div className="team-gh">People</div>}
          {res?.people.map((p) => (
            <Link key={p.id} to={`/team/accounts/${p.id}`} className="team-gres" role="option">
              <b>{p.name || p.handle || "No name"}</b><span className="small muted">{p.handle ? "@" + p.handle : ""}{p.shop ? ` · ${p.shop.name}` : ""}{p.email ? ` · ${p.email}` : ""}</span>
            </Link>
          ))}
          {res && res.orders.length > 0 && <div className="team-gh">Orders</div>}
          {res?.orders.map((o) => (
            <Link key={o.id} to={`/team/orders?q=${encodeURIComponent(o.id.slice(0, 8))}`} className="team-gres" role="option">
              <b>{o.title}</b><span className="small muted">{o.shopName} · @{o.buyer} · {R(o.totalCents)} · {orderStatus(o.status)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

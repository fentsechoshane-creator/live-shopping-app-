import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { WELCOME_CREDIT } from "@app/core";
import { api, authMethod } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { BackButton, ErrorNote, Field, Loading, R, Segmented, Sheet, TierPill, timeAgo, useAction } from "../../components/ui";
import { FeedList } from "./Feed";
import { OrderList } from "./Orders";
import { SellingView } from "../seller/Selling";

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
      <BackButton />
      <h1 className="large-title" style={{ margin: "8px 0 6px" }}>Sign in</h1>
      <p className="muted" style={{ marginTop: 0 }}>One account for buying and selling. We send you a 6 digit code.</p>
      {api.mode === "demo" && <div className="note amber" style={{ marginBottom: 14 }}>Demo: use any email and the code <b>123456</b>. An email starting with “admin” signs in as our team.</div>}
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
          <button type="button" className="link" style={{ marginTop: 14 }} onClick={() => setSent(false)}>Use a different {phone ? "number" : "email"}</button>
        </form>
      )}
    </div>
  );
}

/** Profile, with the Buying | Selling switch at the top, like the prototype. */
export function Me() {
  const { user, setMenuOpen } = useSession();
  const [params, setParams] = useSearchParams();
  const mode = params.get("tab") === "selling" ? "selling" : "buying";
  const [profile, , reloadProfile] = useLoad(() => (user ? api.myProfile() : Promise.resolve(null)), [user?.id]);
  const [credit] = useLoad(() => (user ? api.welcomeCreditAvailable() : Promise.resolve(false)), [user?.id]);
  if (!user) return null;
  const handle = (profile?.displayName || user.email?.split("@")[0] || "you").toLowerCase().replace(/[^a-z0-9.]+/g, ".");

  return (
    <div className="screen">
      <div className="title-row">
        <b style={{ fontSize: 18 }}>@{handle}</b>
        <div className="row" style={{ gap: 8 }}>
          <button className="wallet-chip" style={{ background: "var(--ink)", color: "var(--bg)" }} aria-label={`Wallet, ${credit ? R(WELCOME_CREDIT) : "R0"} credit`}>
            <Icon name="wallet" /><span className="amt">{credit ? R(WELCOME_CREDIT) : "R0"}</span>
          </button>
          <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Menu and settings"><Icon name="menu" /></button>
        </div>
      </div>
      <Segmented label="Mode" value={mode} onChange={(v) => setParams(v === "selling" ? { tab: "selling" } : {})}
        options={[{ value: "buying", label: "Buying" }, { value: "selling", label: "Selling" }]} />
      <div style={{ marginTop: 18 }}>
        {mode === "buying" ? <BuyingView profile={profile ?? null} credit={!!credit} onSaved={reloadProfile} /> : <SellingView />}
      </div>
    </div>
  );
}

function BuyingView({ profile, credit, onSaved }: { profile: Awaited<ReturnType<typeof api.myProfile>> | null; credit: boolean; onSaved: () => void }) {
  const { following, toggleFollow, toast } = useSession();
  const [shops] = useLoad(() => api.following(), [following.size]);
  const [edit, setEdit] = useState(false);
  const nav = useNavigate();
  if (!profile) return <Loading />;
  const name = profile.displayName || "You";
  const standing = profile.trustScore >= 70 ? "Trusted buyer" : profile.trustScore >= 40 ? "Good standing" : "Under review";
  const share = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/`); toast("Link copied"); } catch { toast("Could not copy the link"); }
  };

  return (
    <>
      <div className="profile-head">
        <div className="ring"><div>{name[0]?.toUpperCase()}</div></div>
        <div className="stats">
          <div><b>{following.size}</b><span>Following</span></div>
          <div><b>{profile.ordersCount}</b><span>Orders</span></div>
          <div><b>{credit ? R(WELCOME_CREDIT) : "R0"}</b><span>Credit</span></div>
        </div>
      </div>
      <b style={{ fontSize: 17 }}>{name}</b>
      <div className="small muted" style={{ margin: "2px 0 14px" }}>Cape Town · Joined {new Date(profile.createdAt).toLocaleDateString("en-ZA", { month: "long", year: "numeric" })}</div>
      <div className="row">
        <button className="btn grow" onClick={() => setEdit(true)}>Edit profile</button>
        <button className="btn grow" onClick={share}>Share profile</button>
      </div>
      <button className="hero-card" style={{ width: "100%", border: 0, marginTop: 14, textAlign: "left" }} onClick={() => nav("/help")}>
        <span className="badge-ic"><Icon name="shield" /></span>
        <span className="grow"><b style={{ display: "block" }}>{standing}</b><span className="s">Trust score {profile.trustScore} · buyer protection on every order</span></span>
        <Icon name="chevron" size={18} />
      </button>
      {credit && (
        <div className="note green" style={{ marginTop: 12 }}><b>{R(WELCOME_CREDIT)} welcome credit.</b> It comes off your first order of R200 or more.</div>
      )}

      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Following</h2>
        <span className="small muted">{following.size} sellers</span>
      </div>
      {shops && shops.length > 0 ? (
        <div className="group">
          {shops.map((s) => (
            <div className="cell" key={s.id}>
              <Link to={`/s/${s.handle}`} className="row grow"><span className="avatar">{s.name[0]}</span><span className="grow"><span className="t" style={{ display: "block" }}>{s.name}</span><span className="s" style={{ display: "block" }}>@{s.handle}</span></span></Link>
              <button className="btn" style={{ minHeight: 34, fontSize: 13 }} onClick={() => toggleFollow(s.id)}>Following</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-card">
          <span className="grow muted">Follow sellers to see their drops first.</span>
          <button className="btn dark" style={{ minHeight: 40 }} onClick={() => nav("/explore")}>Find sellers</button>
        </div>
      )}
      {edit && <EditProfile name={name} onClose={() => setEdit(false)} onSaved={onSaved} />}
    </>
  );
}

function EditProfile({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(name);
  const { busy, error, run } = useAction();
  return (
    <Sheet title="Edit profile" onClose={onClose}
      footer={<button className="btn green block big" disabled={busy || !value.trim()} onClick={() => run(async () => { await api.updateProfile(value); onSaved(); onClose(); })}>Save</button>}>
      <ErrorNote error={error} />
      <Field label="Name shown to sellers"><input value={value} onChange={(e) => setValue(e.target.value)} maxLength={40} /></Field>
    </Sheet>
  );
}

type ActivityTab = "notifications" | "messages" | "orders";

/** Activity: notifications, messages and orders in one place, like the prototype. */
export function Activity() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as ActivityTab) || "notifications";
  const [items, error, reload] = useLoad(() => api.notifications(), []);
  const [orders] = useLoad(() => api.myOrders(), []);
  const unread = items?.filter((n) => !n.readAt).length ?? 0;
  useEffect(() => {
    if (tab === "notifications" && unread) api.markAllRead().catch(() => {});
  }, [tab, unread]);
  const iconFor = (title: string) => (/refund|return/i.test(title) ? "payout" : /way|deliver|ship/i.test(title) ? "truck" : /order|payment/i.test(title) ? "bag" : /check|approved/i.test(title) ? "shield" : "bell");

  return (
    <div className="screen">
      <div className="title-row"><h1 className="large-title">Activity</h1><button className="link" onClick={reload}>Refresh</button></div>
      <Segmented<ActivityTab> label="Activity" value={tab} onChange={(v) => setParams({ tab: v })} options={[
        { value: "notifications", label: <>Notifications{unread > 0 && <span className="count">{unread}</span>}</> },
        { value: "messages", label: "Messages" },
        { value: "orders", label: "Orders" },
      ]} />
      <div style={{ marginTop: 16 }}>
        {tab === "notifications" && (
          <>
            <ErrorNote error={error} />
            {!items && !error && <Loading />}
            {items?.length === 0 && <div className="empty-card"><span className="muted">Nothing yet. Orders, returns and shop updates show here.</span></div>}
            {items && items.length > 0 && (
              <div className="group">
                {items.map((n) => (
                  <Link key={n.id} to={n.link ?? "#"} className="cell" style={{ alignItems: "flex-start", background: n.readAt ? undefined : "var(--green-soft)" }}>
                    <span className="icon-btn" style={{ width: 38, height: 38 }}><Icon name={iconFor(n.title)} size={18} /></span>
                    <span className="grow"><span className="t" style={{ display: "block" }}>{n.title}</span><span className="s" style={{ display: "block" }}>{n.body}</span></span>
                    <span className="small muted">{timeAgo(n.createdAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
        {tab === "messages" && (
          <div className="empty-card">
            <span className="icon-btn"><Icon name="chat" /></span>
            <span className="grow"><b>Chat with sellers is coming next</b><div className="small muted">For now, ask questions on the item and the seller sees them in their orders.</div></span>
          </div>
        )}
        {tab === "orders" && <OrderList orders={orders} />}
      </div>
    </div>
  );
}

export function ShopPage() {
  const { handle = "" } = useParams();
  const [data, error] = useLoad(() => api.shop(handle), [handle]);
  const { following, toggleFollow, user } = useSession();
  const nav = useNavigate();
  if (error) return <div className="screen"><ErrorNote error={error} /></div>;
  if (data === undefined) return <div className="screen"><Loading /></div>;
  if (!data) return <div className="screen"><div className="empty">Shop not found.</div></div>;
  const { shop, items } = data;
  const isFollowing = following.has(shop.id);
  return (
    <div className="fill" style={{ overflowY: "auto" }}>
      <div style={{ padding: "12px 16px 16px" }}>
        <BackButton />
        <div className="profile-head">
          <div className="ring green"><div>{shop.name[0]}</div></div>
          <div className="stats">
            <div><b>{shop.followers ?? 0}</b><span>Followers</span></div>
            <div><b>{shop.sales ?? 0}</b><span>Sales</span></div>
            <div><b>{shop.trustScore}</b><span>Trust</span></div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}><b style={{ fontSize: 18 }}>{shop.name}</b><TierPill tier={shop.tier} />{shop.founding && <span className="pill green">Founding seller</span>}</div>
        <div className="small muted" style={{ margin: "2px 0 12px" }}>@{shop.handle}{shop.bio ? ` · ${shop.bio}` : ""}</div>
        <button className={`btn block ${isFollowing ? "" : "dark"}`} onClick={() => (user ? toggleFollow(shop.id) : nav("/signin"))}>{isFollowing ? "Following" : "Follow"}</button>
      </div>
      <div style={{ height: "calc(100% - 60px)", position: "relative", background: "#0b0b0d" }}>
        {items.length ? <FeedList items={items} /> : <div className="feed-empty">No videos yet.</div>}
      </div>
    </div>
  );
}


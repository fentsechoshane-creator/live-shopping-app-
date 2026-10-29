import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { WELCOME_CREDIT } from "@app/core";
import { api, authMethod } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { BackButton, ErrorNote, Field, Loading, R, Segmented, Sheet, TierPill, timeAgo, useAction } from "../../components/ui";
import { PostGrid } from "../../components/PostGrid";
import { OrderList } from "./Orders";

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
      {tab === "orders" && orders && <div className="tiny-count">{orders.length} {orders.length === 1 ? "order" : "orders"} in total</div>}
      <div style={{ marginTop: tab === "orders" ? 10 : 16 }}>
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

/** Public shop page, laid out like the profile: header, then Posts, Likes and Reposts. */
export function ShopPage() {
  const { handle = "" } = useParams();
  const [data, error] = useLoad(() => api.shop(handle), [handle]);
  const { following, toggleFollow, user, toast } = useSession();
  const [tab, setTab] = useState<"posts" | "likes" | "reposts">("posts");
  const [reacted] = useLoad(() => (data && tab !== "posts" ? api.reactedPosts(tab === "likes" ? "like" : "repost", data.shop.id) : Promise.resolve([])), [data?.shop.id, tab]);
  const nav = useNavigate();
  if (error) return <div className="screen"><ErrorNote error={error} /></div>;
  if (data === undefined) return <div className="screen"><Loading /></div>;
  if (!data) return <div className="screen"><BackButton /><div className="empty">Shop not found.</div></div>;
  const { shop, items } = data;
  const isFollowing = following.has(shop.id);
  const share = async () => {
    const url = `${location.origin}/s/${shop.handle}`;
    try { if (navigator.share) await navigator.share({ url }); else { await navigator.clipboard.writeText(url); toast("Link copied"); } } catch { /* cancelled */ }
  };
  return (
    <div className="screen profile">
      <div className="pbar">
        <button className="bare" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button>
        <button className="bare" onClick={share} aria-label="Share shop"><Icon name="share" /></button>
      </div>
      <div className="phead">
        <div className="pavatar green">{shop.name[0]}</div>
        <div className="pstats">
          <button onClick={() => setTab("posts")}><b>{items.length}</b><span>Posts</span></button>
          <div><b>{shop.sales ?? 0}</b><span>Sales</span></div>
          <div><b>{shop.followers ?? 0}</b><span>Followers</span></div>
        </div>
      </div>
      <div className="pname"><b>{shop.name}</b><TierPill tier={shop.tier} /></div>
      <div className="phandle">
        <span>@{shop.handle}</span>
        {shop.founding && <span className="standing green"><Icon name="check" size={12} strokeWidth={2.6} />Founding seller</span>}
      </div>
      {shop.bio && <p className="pbio">{shop.bio}</p>}
      <button className={`btn block ${isFollowing ? "" : "dark"}`} style={{ marginTop: 12, minHeight: 40 }}
        onClick={() => (user ? toggleFollow(shop.id) : nav("/signin"))}>{isFollowing ? "Following" : "Follow"}</button>

      <div className="ptabs" role="tablist" aria-label="Shop">
        <button role="tab" aria-selected={tab === "posts"} onClick={() => setTab("posts")}>Posts</button>
        <button role="tab" aria-selected={tab === "likes"} onClick={() => setTab("likes")}>Likes</button>
        <button role="tab" aria-selected={tab === "reposts"} onClick={() => setTab("reposts")}>Reposts</button>
      </div>
      {tab === "posts"
        ? <PostGrid items={items} empty={<div className="pempty">No videos yet.</div>} />
        : !reacted ? <Loading /> : <PostGrid items={reacted} empty={<div className="pempty">{tab === "likes" ? "No likes yet." : "No reposts yet."}</div>} />}
    </div>
  );
}

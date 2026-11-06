import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, authMethod } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { safePath, useGoBack, BackButton, ErrorNote, Field, Loading, R, Segmented, Sheet, TierPill, timeAgo, useAction } from "../../components/ui";
import { PostGrid } from "../../components/PostGrid";
import { shareOrCopy } from "../../native";
import { useTabSwipe } from "../../components/gestures";
import { replyText, useMessageShop } from "./Messages";
import { FriendsRow } from "./Friends";
import { DmList } from "../../components/DmList";
import { MoreSheet } from "../../components/Safety";
import { Avatar } from "../../components/Avatar";
import { useIsMine } from "../../lib/mine";

export function SignIn() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const next = safePath(params.get("next"));
  return (
    <div className="screen">
      <BackButton />
      <h1 className="large-title" style={{ margin: "8px 0 6px" }}>Sign in</h1>
      <SignInForm onDone={() => nav(next, { replace: true })} />
    </div>
  );
}

/** Sign in over the current screen, so you don't lose your place. Opened by `withUser`. */
export function SignInSheet() {
  const { signInAsk, closeSignIn } = useSession();
  if (!signInAsk) return null;
  return (
    <Sheet title={signInAsk} onClose={closeSignIn}>
      <SignInForm onDone={() => {}} />
    </Sheet>
  );
}

/** Email (or phone) and a 6 digit code. New and returning people use the same steps. */
export function SignInForm({ onDone }: { onDone: () => void }) {
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [usePassword, setUsePassword] = useState(false); // for the app store reviewers' test account
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  const phone = authMethod === "phone";
  const verify = (c: string) => run(async () => { await api.verifyCode(contact, c); onDone(); });

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>{sent ? `Check ${contact}. Type the 6 digit code from the email, or tap the sign in link in it on this device.` : "One account for buying and selling. No password needed: we email you a code."}</p>
      {api.mode === "demo" && <div className="note amber" style={{ marginBottom: 14 }}>Demo: use any email and the code <b>123456</b>. An email starting with “admin” signs in as our team. To try the seller side of chats, use <b>lebo@shop.demo</b>.</div>}
      <ErrorNote error={error} />
      {usePassword ? (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.signInWithPassword(contact, password); onDone(); }); }}>
          <Field label="Email"><input value={contact} onChange={(e) => setContact(e.target.value)} type="email" inputMode="email" autoComplete="email" required /></Field>
          <Field label="Password"><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></Field>
          <button className="btn green block big" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <button type="button" className="link" style={{ marginTop: 14 }} onClick={() => setUsePassword(false)}>Get a code instead</button>
        </form>
      ) : !sent ? (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.sendCode(contact); setSent(true); }); }}>
          <Field label={phone ? "Cell number" : "Email"}>
            <input value={contact} onChange={(e) => setContact(e.target.value)} type={phone ? "tel" : "email"} inputMode={phone ? "tel" : "email"}
              autoComplete={phone ? "tel" : "email"} placeholder={phone ? "082 123 4567" : "you@example.com"} required autoFocus />
          </Field>
          <button className="btn green block big" disabled={busy || !contact.trim()}>{busy ? "Sending…" : "Send code"}</button>
          <button type="button" className="link" style={{ marginTop: 14 }} onClick={() => setUsePassword(true)}>Sign in with a password</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); verify(code); }}>
          <Field label="Code">
            {/* Signs in by itself once all 6 digits are in (including when the phone fills the code from the message). */}
            <input value={code} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6 && !busy) verify(v); }}
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus />
          </Field>
          <button className="btn green block big" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Sign in"}</button>
          <div className="row between" style={{ marginTop: 14 }}>
            <button type="button" className="link" onClick={() => { setSent(false); setCode(""); }}>Use a different {phone ? "number" : "email"}</button>
            <button type="button" className="link" disabled={busy} onClick={() => run(async () => { await api.sendCode(contact); setCode(""); })}>Send again</button>
          </div>
        </form>
      )}
    </>
  );
}

type InboxTab = "messages" | "updates";
const isChat = (n: { link: string | null }) => !!n.link && /^\/(messages|chats)\//.test(n.link);

/** Pull down at the top of a list to reload it, like every phone app. */
export function usePullRefresh(onRefresh: () => void) {
  const start = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  return {
    pull,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => { start.current = window.scrollY <= 0 ? e.touches[0].clientY : null; },
      onTouchMove: (e: React.TouchEvent) => { if (start.current != null) setPull(Math.max(0, Math.min(90, e.touches[0].clientY - start.current))); },
      onTouchEnd: () => { if (pull >= 70) onRefresh(); start.current = null; setPull(0); },
    },
  };
}

/** Inbox: chats first, then updates (payments, shipping, returns, auctions, shop checks). Orders live on your profile. */
export function Inbox() {
  const [params, setParams] = useSearchParams();
  const [items, error, reloadItems] = useLoad(() => api.notifications(), []);
  const [chats, , reloadChats] = useLoad(() => api.conversations(), []);
  const [friendChats, , reloadFriendChats] = useLoad(() => api.friendChats(), []);
  const [friends, , reloadFriends] = useLoad(() => api.friends(), []);
  const updates = items?.filter((n) => !isChat(n));
  const unreadUpdates = updates?.filter((n) => !n.readAt).length ?? 0;
  const unreadChats = (chats?.reduce((n, c) => n + c.unread, 0) ?? 0) + (friendChats?.reduce((n, c) => n + c.unread, 0) ?? 0);
  // Open on what's new: Messages unless only updates are waiting.
  const asked = params.get("tab") as InboxTab | null;
  const tab: InboxTab = asked === "messages" || asked === "updates" ? asked : unreadChats === 0 && unreadUpdates > 0 ? "updates" : "messages";
  const setTab = (v: InboxTab) => setParams({ tab: v }, { replace: true });
  const swipeTabs = useTabSwipe(["messages", "updates"] as const, tab, setTab);
  const reload = () => { reloadItems(); reloadChats(); reloadFriendChats(); reloadFriends(); };
  const { pull, handlers } = usePullRefresh(reload);
  useEffect(() => {
    if (tab === "updates" && unreadUpdates) api.markAllRead().then(() => window.dispatchEvent(new Event("inbox-read"))).catch(() => {});
  }, [tab, unreadUpdates]);
  const iconFor = (title: string) => (/refund|return/i.test(title) ? "payout" : /way|deliver|ship/i.test(title) ? "truck" : /order|payment/i.test(title) ? "bag" : /check|approved/i.test(title) ? "shield" : "bell");

  return (
    <div className="screen" {...handlers}>
      {pull > 0 && <div className="pull-hint" style={{ height: pull }}>{pull >= 70 ? "Let go to refresh" : "Pull to refresh"}</div>}
      <div className="row between inbox-head">
        <h1 className="large-title">Inbox</h1>
        <Link to="/friends" className="icon-btn" aria-label="New message"><Icon name="edit" size={20} /></Link>
      </div>
      <Segmented<InboxTab> label="Inbox" value={tab} onChange={setTab} options={[
        { value: "messages", label: <>Messages{unreadChats > 0 && <span className="count">{unreadChats}</span>}</> },
        { value: "updates", label: <>Updates{unreadUpdates > 0 && <span className="count">{unreadUpdates}</span>}</> },
      ]} />
      <div style={{ marginTop: 16 }} {...swipeTabs} className="swipe-area">
        {tab === "messages" && (chats && friendChats ? (
          <>
            {friends && <FriendsRow friends={friends} />}
            <DmList friends={friendChats} shops={chats} />
          </>
        ) : <Loading />)}
        {tab === "updates" && (
          <>
            <ErrorNote error={error} />
            {!updates && !error && <Loading />}
            {updates?.length === 0 && <div className="empty-card"><span className="muted">Nothing yet. Payments, shipping, returns and shop updates show here.</span></div>}
            {updates && updates.length > 0 && (
              <div className="group">
                {updates.map((n) => (
                  <Link key={n.id} to={n.link ? safePath(n.link) : "#"} className="cell" style={{ alignItems: "flex-start", background: n.readAt ? undefined : "var(--green-soft)" }}>
                    <span className="icon-btn" style={{ width: 38, height: 38 }}><Icon name={iconFor(n.title)} size={18} /></span>
                    <span className="grow"><span className="t" style={{ display: "block" }}>{n.title}</span><span className="s" style={{ display: "block" }}>{n.body}</span></span>
                    <span className="small muted">{timeAgo(n.createdAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Public shop page, laid out like the profile: header, then Posts, Likes and Reposts. */
export function ShopPage() {
  const { handle = "" } = useParams();
  const [data, error] = useLoad(() => api.shop(handle), [handle]);
  const { following, toggleFollow, toast, withUser } = useSession();
  const [tab, setTab] = useState<"posts" | "likes" | "reposts">("posts");
  const [more, setMore] = useState(false);
  const goBack = useGoBack("/explore");
  const loc = useLocation();
  const messageShop = useMessageShop();
  const mine = useIsMine(data?.shop.id);
  const nav = useNavigate();
  const [replyMin] = useLoad(() => (data ? api.shopReplyMinutes(data.shop.id) : Promise.resolve(null)), [data?.shop.id]);
  const [avatars] = useLoad(() => (data ? api.shopAvatars([data.shop.id]) : Promise.resolve({} as Record<string, string>)), [data?.shop.id]);
  const swipeShopTabs = useTabSwipe(["posts", "likes", "reposts"] as const, tab, setTab);
  const [reacted] = useLoad(() => (data && tab !== "posts" ? api.reactedPosts(tab === "likes" ? "like" : "repost", data.shop.id) : Promise.resolve([])), [data?.shop.id, tab]);
  if (error) return <div className="screen"><ErrorNote error={error} /></div>;
  if (data === undefined) return <div className="screen"><Loading /></div>;
  if (!data) return <div className="screen"><BackButton /><div className="empty">Shop not found.</div></div>;
  const { shop, items } = data;
  const isFollowing = following.has(shop.id);
  const share = async () => { if ((await shareOrCopy(`/s/${shop.handle}`)) === "copied") toast("Link copied"); };
  return (
    <div className="screen profile">
      <div className="pbar">
        <button className="bare" onClick={goBack} aria-label="Back"><Icon name="back" /></button>
        <div className="row" style={{ gap: 2 }}>
          <button className="bare" onClick={share} aria-label="Share shop"><Icon name="share" /></button>
          <button className="bare" onClick={() => setMore(true)} aria-label="More options"><Icon name="more" size={20} strokeWidth={3} /></button>
        </div>
      </div>
      <div className="phead">
        <Avatar url={avatars?.[shop.id]} name={shop.name} className="pavatar green" />
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
      {replyText(replyMin) && <p className="pnote muted" style={{ marginTop: 4 }}><Icon name="chat" size={12} /> {replyText(replyMin)}</p>}
      {mine ? (
        <>
          <p className="pnote muted" style={{ marginTop: 8 }}><Icon name="store" size={12} /> This is your shop, as buyers see it.</p>
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <button className="btn grow dark" style={{ minHeight: 40 }} onClick={() => nav("/me")}>Manage my shop</button>
            <button className="btn grow" style={{ minHeight: 40 }} onClick={() => nav("/sell/orders")}><Icon name="bag" size={16} />My orders</button>
          </div>
        </>
      ) : (
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className={`btn grow ${isFollowing ? "" : "dark"}`} style={{ minHeight: 40 }}
            onClick={() => withUser(() => toggleFollow(shop.id), "Sign in to follow")}>{isFollowing ? "Following" : "Follow"}</button>
          <button className="btn grow" style={{ minHeight: 40 }} onClick={() => messageShop(shop.id)}><Icon name="chat" size={16} />Message</button>
        </div>
      )}
      {more && <MoreSheet kind="shop" targetId={shop.id} shopId={shop.id} shopHandle={shop.handle} onClose={() => setMore(false)} mine={mine} />}

      <div className="ptabs" role="tablist" aria-label="Shop">
        <button role="tab" aria-selected={tab === "posts"} onClick={() => setTab("posts")}>Posts</button>
        <button role="tab" aria-selected={tab === "likes"} onClick={() => setTab("likes")}>Likes</button>
        <button role="tab" aria-selected={tab === "reposts"} onClick={() => setTab("reposts")}>Reposts</button>
      </div>
      <div {...swipeShopTabs} className="swipe-area">
      {tab === "posts"
        ? <PostGrid items={items} openProductId={new URLSearchParams(loc.search).get("item")} empty={<div className="pempty">No videos yet.</div>} />
        : !reacted ? <Loading /> : <PostGrid items={reacted} empty={<div className="pempty">{tab === "likes" ? "No likes yet." : "No reposts yet."}</div>} />}
      </div>
    </div>
  );
}

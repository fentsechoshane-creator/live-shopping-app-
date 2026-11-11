import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, authMethod, type ShopReviews } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { safePath, useGoBack, BackButton, Blank, Wordmark, ErrorNote, Field, Loading, R, Segmented, Sheet, TierPill, timeAgo, useAction } from "../../components/ui";
import { PostGrid } from "../../components/PostGrid";
import { shareOrCopy } from "../../native";
import { useTabSwipe } from "../../components/gestures";
import { replyText, useMessageShop } from "./Messages";
import { FriendsRow } from "./Friends";
import { DmList } from "../../components/DmList";
import { MoreSheet } from "../../components/Safety";
import { Avatar } from "../../components/Avatar";
import { AuthForm } from "../../components/AuthForm";
import { useIsMine } from "../../lib/mine";

export function SignIn() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const next = safePath(params.get("next"));
  return (
    <div className="screen">
      <BackButton />
      <div style={{ margin: "18px 0 22px" }}><Wordmark size={40} /></div>
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

/** Sign in and Sign up live in components/AuthForm.tsx. */
export const SignInForm = AuthForm;

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
            {updates?.length === 0 && <Blank icon="bell" title="No updates yet" line="Payments, shipping and returns show here." />}
            {updates && updates.length > 0 && (
              <div className="group">
                {updates.map((n) => (
                  <Link key={n.id} to={n.link ? safePath(n.link) : "#"} className={`cell upd ${n.readAt ? "" : "unread"}`} style={{ alignItems: "flex-start" }}>
                    <span className="upd-dot" aria-label={n.readAt ? undefined : "New"} />
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
/** Five stars, filled to the nearest half. */
function StarRow({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="star-row" aria-hidden="true" style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={value >= n - 0.25 ? "on" : value >= n - 0.75 ? "half" : ""}>★</span>)}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[(m || 1) - 1]} ${y}`; };

/** A shop's reviews: the average, how the stars spread, and what buyers said. Who wrote each one stays private. */
function ReviewsSheet({ reviews, shopName, onClose }: { reviews: ShopReviews; shopName: string; onClose: () => void }) {
  const max = Math.max(1, ...Object.values(reviews.stars));
  return (
    <Sheet title="Reviews" onClose={onClose}>
      <div className="rev-head">
        <div className="rev-avg"><b className="num">{reviews.average?.toFixed(1)}</b><StarRow value={reviews.average ?? 0} size={16} />
          <span className="small muted">{reviews.count} {reviews.count === 1 ? "review" : "reviews"}</span></div>
        <div className="rev-bars">
          {(["5", "4", "3", "2", "1"] as const).map((k) => (
            <div key={k} className="rev-bar"><span className="num">{k}</span><i><em style={{ width: `${(reviews.stars[k] / max) * 100}%` }} /></i><span className="num muted">{reviews.stars[k]}</span></div>
          ))}
        </div>
      </div>
      {reviews.recent.length === 0 ? <p className="small muted">No written reviews yet. Buyers can rate {shopName} once their order arrives.</p> : (
        <div className="rev-list">
          {reviews.recent.map((r, i) => (
            <div key={i} className="rev">
              <div className="row" style={{ justifyContent: "space-between" }}><StarRow value={r.stars} /><span className="small muted">{monthName(r.month)}</span></div>
              <p>{r.body}</p>
              <span className="small muted">Verified buyer · {r.item}</span>
            </div>
          ))}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 14 }}>Only buyers who received an order can leave a review. We don't show who wrote it.</p>
    </Sheet>
  );
}

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
  const [reviews] = useLoad(() => (data ? api.shopReviews(data.shop.id) : Promise.resolve(null)), [data?.shop.id]);
  const [showReviews, setShowReviews] = useState(false);
  if (error) return <div className="screen"><ErrorNote error={error} /></div>;
  if (data === undefined) return <div className="screen"><Loading /></div>;
  if (!data) return <div className="screen"><BackButton /><Blank icon="store" title="Shop not found" line="It may have closed or changed its name." /></div>;
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
      {reviews && reviews.count > 0 && (
        <button className="prating" onClick={() => setShowReviews(true)} aria-label={`Rated ${reviews.average} out of 5 from ${reviews.count} ${reviews.count === 1 ? "review" : "reviews"}. See reviews`}>
          <StarRow value={reviews.average ?? 0} /><b className="num">{reviews.average?.toFixed(1)}</b>
          <span>{reviews.count} {reviews.count === 1 ? "review" : "reviews"}</span><Icon name="chevron" size={14} />
        </button>
      )}
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
      {showReviews && reviews && <ReviewsSheet reviews={reviews} shopName={shop.name} onClose={() => setShowReviews(false)} />}
      {more && <MoreSheet kind="shop" targetId={shop.id} shopId={shop.id} shopHandle={shop.handle} onClose={() => setMore(false)} mine={mine} />}

      <div className="ptabs" role="tablist" aria-label="Shop">
        <button role="tab" aria-selected={tab === "posts"} onClick={() => setTab("posts")}>Posts</button>
        <button role="tab" aria-selected={tab === "likes"} onClick={() => setTab("likes")}>Likes</button>
        <button role="tab" aria-selected={tab === "reposts"} onClick={() => setTab("reposts")}>Reposts</button>
      </div>
      <div {...swipeShopTabs} className="swipe-area">
      {tab === "posts"
        ? <PostGrid items={items} openProductId={new URLSearchParams(loc.search).get("item")} empty={<Blank icon="play" title="No videos yet" />} />
        : !reacted ? <Loading /> : <PostGrid items={reacted} empty={<Blank icon={tab === "likes" ? "heart" : "repost"} title={tab === "likes" ? "No likes yet" : "No reposts yet"} />} />}
      </div>
    </div>
  );
}

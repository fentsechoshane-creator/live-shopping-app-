import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LISTING_LABELS, WELCOME_CREDIT } from "@app/core";
import { api, type FeedItem } from "../../api";
import { useLoad, useSession } from "../../session";
import { ProductArt } from "../../components/Scene";
import { Video } from "../../components/Video";
import { Icon } from "../../components/Icon";
import { Loading, R, Segmented, Sheet, TierPill } from "../../components/ui";

import { CheckoutSheet } from "./Checkout";
import { CommentsSheet } from "../../components/Comments";
import { MoreSheet } from "../../components/Safety";
import { useMessageShop } from "./Messages";

type Tab = "for_you" | "following" | "live";

export function Feed() {
  const [tab, setTab] = useState<Tab>("for_you");
  const [items, error] = useLoad(() => api.feed(), []);
  const { following, user, blockedShops } = useSession();
  const [credit] = useLoad(() => (user ? api.welcomeCreditAvailable() : Promise.resolve(false)), [user?.id]);
  const nav = useNavigate();
  const [reposts] = useLoad(() => (user && tab === "following" ? api.followingReposts() : Promise.resolve([] as FeedItem[])), [user?.id, tab, following.size]);
  // Following: posts from shops you follow, plus what those shops reposted.
  const shown = tab === "following"
    ? [...(items ?? []).filter((it) => following.has(it.shop.id)), ...(reposts ?? [])]
        .filter((it, i, all) => all.findIndex((x) => x.postId === it.postId) === i)
    : items ?? [];
  const visibleItems = shown.filter((it) => !blockedShops.has(it.shop.id)); // blocked shops never show

  return (
    <div className="fill">
      {error && <div className="feed-empty" style={{ background: "#0b0b0d" }}><div className="error">{error}</div></div>}
      {!items && !error && <div className="feed-empty" style={{ background: "#0b0b0d" }}><Loading /></div>}
      {items && tab === "live" && (
        <FeedEmpty title="No one is live right now" body="Lives with pop up Buy now cards and quick auctions are coming next. Follow sellers to hear when they go live." />
      )}
      {items && tab === "following" && visibleItems.length === 0 && (
        <FeedEmpty title="Follow sellers to see their drops here" body="Tap Follow on any video, or find shops in Explore."
          action={<button className="btn vglass" onClick={() => nav("/explore")}>Find sellers</button>} />
      )}
      {items && tab !== "live" && visibleItems.length > 0 && <FeedList items={visibleItems} key={tab} />}

      <div className="top-bar">
        <Segmented<Tab> label="Feed" onVideo value={tab} onChange={setTab} options={[
          { value: "for_you", label: "For you" },
          { value: "following", label: "Following" },
          { value: "live", label: <><span className="dot-live" />Live</> },
        ]} />
        <div className="row" style={{ gap: 8 }}>
          <button className="wallet-chip vglass" onClick={() => nav(user ? "/me" : "/signin")}
            aria-label={`Wallet, ${credit ? R(WELCOME_CREDIT) : "R0"} credit`}>
            <Icon name="wallet" /><span className="amt">{credit ? R(WELCOME_CREDIT) : "R0"}</span>
          </button>
          <button className="wallet-chip vglass" onClick={() => nav("/explore")} aria-label="Search"><Icon name="search" /></button>
        </div>
      </div>
    </div>
  );
}

function FeedEmpty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="feed-empty" style={{ background: "radial-gradient(120% 80% at 50% 30%, #2a2a33, #0b0b0d)" }}>
      <div className="glass-panel vglass stack" style={{ alignItems: "center" }}>
        <b style={{ fontSize: 17, color: "#fff" }}>{title}</b>
        <span style={{ fontSize: 14, lineHeight: 1.45 }}>{body}</span>
        {action}
      </div>
    </div>
  );
}

/** Full screen video list with Browse and checkout sheets. Used by the feed and shop pages. */
export function FeedList({ items, start = 0 }: { items: FeedItem[]; start?: number }) {
  const [browse, setBrowse] = useState<FeedItem | null>(null);
  const [buy, setBuy] = useState<FeedItem | null>(null);
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const { user } = useSession();
  const nav = useNavigate();

  useEffect(() => {
    const el = ref.current;
    if (el && start) { el.scrollTop = start * el.clientHeight; setIndex(start); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setIndex(Math.round(el.scrollTop / Math.max(1, el.clientHeight)));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const [counts, setCounts] = useState<Record<string, { likes: number; reposts: number }>>({});
  useEffect(() => { api.postCounts(items.map((it) => it.postId)).then(setCounts).catch(() => {}); }, [items]);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  useEffect(() => { api.commentCounts(items.map((it) => it.postId)).then(setCommentCounts).catch(() => {}); }, [items]);
  const [commenting, setCommenting] = useState<FeedItem | null>(null);
  const [more, setMore] = useState<FeedItem | null>(null);
  const messageShop = useMessageShop();

  const go = (d: number) => ref.current?.scrollTo({ top: (index + d) * ref.current.clientHeight, behavior: "smooth" });
  const startBuy = (it: FeedItem) => {
    if (!user) return nav(`/signin?next=${encodeURIComponent("/")}`);
    setBrowse(null);
    setBuy(it);
  };

  return (
    <>
      <div className="feed" ref={ref} aria-label="Video feed">
        {items.map((it) => <VideoCard key={it.postId} item={it} counts={counts[it.postId]} comments={commentCounts[it.postId] ?? 0}
          onBrowse={() => setBrowse(it)} onBuy={() => startBuy(it)} onComments={() => setCommenting(it)} onMore={() => setMore(it)} />)}
      </div>
      {items.length > 1 && (
        <div className="rail">
          <button className="vround vglass" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous video"><Icon name="up" /></button>
          <div className="dots" aria-hidden="true">
            {items.slice(0, 6).map((_, i) => <span key={i} className={i === Math.min(index, 5) ? "on" : ""} />)}
          </div>
          <button className="vround vglass" onClick={() => go(1)} disabled={index >= items.length - 1} aria-label="Next video"><Icon name="down" /></button>
        </div>
      )}
      {browse && (
        <Sheet title={browse.product.title} onClose={() => setBrowse(null)} footer={<BuyButton item={browse} onClick={() => startBuy(browse)} block />}>
          <ProductDetails item={browse} />
        </Sheet>
      )}
      {buy && <CheckoutSheet item={buy} onClose={() => setBuy(null)} />}
      {commenting && <CommentsSheet postId={commenting.postId} postOwnerShopHandle={commenting.shop.handle} onClose={() => setCommenting(null)}
        onCount={(n) => setCommentCounts((c) => ({ ...c, [commenting.postId]: n }))} />}
      {more && <MoreSheet kind="post" targetId={more.postId} shopId={more.shop.id} shopHandle={more.shop.handle} onClose={() => setMore(null)}
        onMessage={() => { setMore(null); messageShop(more.shop.id, more.product.id); }} />}
    </>
  );
}

function BuyButton({ item, onClick, block }: { item: FeedItem; onClick: () => void; block?: boolean }) {
  const p = item.product;
  const sold = p.mode === "buy_now" && (p.stock < 1 || p.status === "sold_out");
  return (
    <button className={`btn green ${block ? "block big" : ""}`} onClick={onClick} disabled={sold}>
      <Icon name="bag" size={18} />{sold ? "Sold out" : p.mode === "order_now" ? "Order now" : "Buy now"}
    </button>
  );
}

/** One small status chip, only when it tells the buyer something useful. */
function statusChip(it: FeedItem): { text: string; tone: "green" | "amber" } | null {
  const p = it.product;
  if (p.mode === "order_now") return { text: `Made to order · ${p.leadDays ?? 2} days ahead`, tone: "amber" };
  if (p.mode === "buy_now" && p.stock === 1) return { text: "Only 1 left", tone: "amber" };
  if (p.label === "authentic_designer") return { text: "Authenticity checked", tone: "green" };
  if (it.shop.founding) return { text: "Founding seller", tone: "green" };
  return null;
}

/** Short count like TikTok: 1234 shows as 1.2K. */
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n));

function VideoCard({ item, counts, comments, onBrowse, onBuy, onComments, onMore }: {
  item: FeedItem; counts?: { likes: number; reposts: number }; comments: number; onBrowse: () => void; onBuy: () => void; onComments: () => void; onMore: () => void;
}) {
  const p = item.product;
  const { following, toggleFollow, user, liked, reposted, toggleReaction } = useSession();
  const isLiked = liked.has(item.postId);
  const isReposted = reposted.has(item.postId);
  // Counts from the server already include the user's own reaction when it was loaded; nudge them on taps since then.
  const [start] = useState({ liked: isLiked, reposted: isReposted });
  const likes = (counts?.likes ?? 0) + (isLiked ? 1 : 0) - (start.liked ? 1 : 0);
  const reposts = (counts?.reposts ?? 0) + (isReposted ? 1 : 0) - (start.reposted ? 1 : 0);
  const react = (kind: "like" | "repost") => (user ? toggleReaction(item.postId, kind) : nav("/signin"));
  const nav = useNavigate();
  const chip = statusChip(item);
  const isFollowing = following.has(item.shop.id);
  const share = async () => {
    const url = `${location.origin}/s/${item.shop.handle}`;
    try {
      if (navigator.share) await navigator.share({ title: p.title, url });
      else await navigator.clipboard.writeText(url);
    } catch { /* cancelled */ }
  };
  const sub = [
    p.sizes.length ? (p.sizes.length > 1 ? `Sizes ${p.sizes[0]} to ${p.sizes[p.sizes.length - 1]}` : `Size ${p.sizes[0]}`) : LISTING_LABELS[p.label].label,
    p.mode === "buy_now" && p.stock > 1 ? `${p.stock} left` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className="video-card" aria-label={`${p.title} from ${item.shop.name}`}>
      <Video src={item.video} label={`Video: ${item.caption}`} productId={p.id} />
      <div className="shade" />
      <div className="info">
        {(item.repostedBy || chip) && (
          <div className="row" style={{ gap: 6 }}>
            {item.repostedBy && <span className="vchip vglass"><Icon name="repost" size={13} />Reposted by @{item.repostedBy}</span>}
            {chip && <span className={`vchip vglass ${chip.tone}`}><span className="d" />{chip.text}</span>}
          </div>
        )}
        <div className="seller-row">
          <Link to={`/s/${item.shop.handle}`} className="row" style={{ gap: 8 }}>
            <span className="avatar">{item.shop.name[0]}</span>
            <span className="handle">@{item.shop.handle}</span>
          </Link>
          <button className="follow-btn vglass" onClick={() => (user ? toggleFollow(item.shop.id) : nav("/signin"))} aria-pressed={isFollowing}>
            {isFollowing ? "Following" : "Follow"}
          </button>
          <button className="more-btn" onClick={onMore} aria-label="More options"><Icon name="more" size={20} strokeWidth={3} /></button>
        </div>
        <div className="caption">{item.caption}</div>
        <div className="prod-row">
        <button className="product-chip vglass" onClick={onBrowse} style={{ textAlign: "left" }} aria-label={`See details: ${p.title}, ${R(p.priceCents)}`}>
          <span className="sw art">{item.video.url
            ? (item.video.kind === "image" ? <img src={item.video.url} alt="" /> : <video src={`${item.video.url}#t=0.1`} muted playsInline preload="metadata" />)
            : <ProductArt productId={p.id} fallback="#555" />}</span>
          <span className="grow"><span className="t" style={{ display: "block" }}>{p.title}</span><span className="s" style={{ display: "block" }}>{sub}</span></span>
          <span className="p">{R(p.priceCents)}</span>
        </button>
          <button className={`react vglass ${isLiked ? "on like" : ""}`} onClick={() => react("like")} aria-pressed={isLiked} aria-label={`Like, ${likes}`}>
            <Icon name="heart" size={20} /><span>{short(likes)}</span>
          </button>
          <button className={`react vglass ${isReposted ? "on repost" : ""}`} onClick={() => react("repost")} aria-pressed={isReposted} aria-label={`Repost, ${reposts}`}>
            <Icon name="repost" size={20} /><span>{short(reposts)}</span>
          </button>
          <button className="react vglass" onClick={onComments} aria-label={`Comments, ${comments}`}>
            <Icon name="comment" size={20} /><span>{short(comments)}</span>
          </button>
        </div>
        <div className="actions">
          <BuyButton item={item} onClick={onBuy} />
          <button className="vround vglass" onClick={share} aria-label="Share"><Icon name="share" /></button>
        </div>
      </div>
    </section>
  );
}

function ProductDetails({ item }: { item: FeedItem }) {
  const p = item.product;
  const messageShop = useMessageShop();
  const [photos] = useLoad(() => api.productPhotos(p.id), [p.id]);
  return (
    <div className="stack">
      {photos && photos.length > 0 && (
        <div className="photo-row" aria-label="More photos">
          {photos.map((u, i) => <img key={u} src={u} alt={`${p.title}, photo ${i + 2}`} loading="lazy" />)}
        </div>
      )}
      <div className="row between"><span className="pill">{LISTING_LABELS[p.label].label}</span><b style={{ fontSize: 22 }}>{R(p.priceCents)}</b></div>
      {p.condition && <div className="small">Condition: <b>{p.condition.replace("_", " ")}</b></div>}
      {p.description && <p style={{ margin: 0, lineHeight: 1.5 }}>{p.description}</p>}
      {p.sizes.length > 0 && <div className="small muted">Sizes: {p.sizes.join(", ")}</div>}
      {p.allergens && <div className="note amber">Allergens: {p.allergens}</div>}
      <div className="note">
        <b>Buyer protection.</b> Your money is held safely until {p.mode === "buy_now" ? "your 7 day return window closes" : "you have checked your order"}.
        {p.mode === "buy_now" ? " Change your mind? Send it back within 7 days of delivery." : " Made to order, so there are no change of mind returns."}
      </div>
      <Link to={`/s/${item.shop.handle}`} className="group" style={{ display: "block" }}>
        <div className="cell">
          <span className="avatar">{item.shop.name[0]}</span>
          <span className="grow"><span className="t" style={{ display: "block" }}>{item.shop.name}</span><span className="s" style={{ display: "block" }}>Trust score {item.shop.trustScore}</span></span>
          <TierPill tier={item.shop.tier} />
        </div>
      </Link>
      <button className="btn block" onClick={() => messageShop(item.shop.id, p.id)}><Icon name="chat" size={18} />Message seller about this</button>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PlacedText } from "../../components/PlacedText";
import { Link, useNavigate } from "react-router-dom";
import { FEATURES } from "../../features";
import { LISTING_LABELS, activeMarks } from "@app/core";
import { api, type FeedItem } from "../../api";
import { useLoad, useSession } from "../../session";
import { ProductArt } from "../../components/Scene";
import { Video } from "../../components/Video";
import { Icon } from "../../components/Icon";
import { RewardChip } from "../../components/Rewards";
import { Loading, R, Segmented, Sheet, TierPill } from "../../components/ui";

import { CheckoutSheet } from "./Checkout";
import { CommentsSheet } from "../../components/Comments";
import { MoreSheet } from "../../components/Safety";
import { EditListing } from "../../components/EditListing";
import { useSwipe } from "../../components/gestures";
import { tap } from "../../native";
import { ShareSheet } from "../../components/ShareSheet";
import { useMessageShop } from "./Messages";
import { rankFeed } from "../../lib/rank";
import { Avatar } from "../../components/Avatar";
import { AuctionSheet, auctionButton, useAuctions, useNow } from "../../components/Auction";
import { HoldToBid } from "../../components/HoldToBid";
import { timeLeft } from "@app/core";
import type { AuctionInfo } from "../../api";
import { useIsMine } from "../../lib/mine";
import { useMyShopId } from "../../lib/mine";
import { MakeOfferSheet } from "../../components/MakeOffer";
import { ClipPlayer, type ClipPlayerApi } from "../../components/ClipPlayer";

type Tab = "for_you" | "following" | "live";

export function Feed() {
  const [tab, setTab] = useState<Tab>("for_you");
  const [items, error, reloadFeed] = useLoad(() => api.feed(), []);
  // A seller changed or took down their own listing: show the feed as it is now.
  useEffect(() => { window.addEventListener("listing-changed", reloadFeed); return () => window.removeEventListener("listing-changed", reloadFeed); }, [reloadFeed]);
  const { following, user, blockedShops, interests, withUser } = useSession();
  // For You: ordered once when it loads (so nothing jumps while you scroll), then more posts as you near the end.
  const ranked = useMemo(() => (items ? rankFeed(items, { interests, following }) : undefined), [items, interests]); // eslint-disable-line react-hooks/exhaustive-deps
  const [more, setMore] = useState<FeedItem[]>([]);
  const [end, setEnd] = useState(false);
  const loading = useRef(false);
  const loadMore = () => {
    if (loading.current || end || !items || items.length < 20) return;
    loading.current = true;
    api.feed(items.length + more.length).then((next) => {
      if (next.length === 0) setEnd(true);
      setMore((m) => [...m, ...next.filter((x) => !m.some((y) => y.postId === x.postId) && !items.some((y) => y.postId === x.postId))]);
    }).catch(() => {}).finally(() => { loading.current = false; });
  };
  const nav = useNavigate();
  const [reposts] = useLoad(() => (user && tab === "following" ? api.followingReposts() : Promise.resolve([] as FeedItem[])), [user?.id, tab, following.size]);
  // Following: posts from shops you follow, plus what those shops reposted.
  const shown = tab === "following"
    ? [...(items ?? []).filter((it) => following.has(it.shop.id)), ...(reposts ?? [])]
        .filter((it, i, all) => all.findIndex((x) => x.postId === it.postId) === i)
    : [...(ranked ?? []), ...more];
  const visibleItems = shown.filter((it) => !blockedShops.has(it.shop.id)); // blocked shops never show

  return (
    <div className="fill">
      {error && <div className="feed-empty" style={{ background: "#0b0b0d" }}><div className="error">{error}</div></div>}
      {!items && !error && <div className="feed-empty" style={{ background: "#0b0b0d" }}><Loading /></div>}
      {items && tab === "live" && (
        <FeedEmpty icon="live" title="No one is live" body="Follow sellers to hear when they go live." />
      )}
      {items && tab === "following" && visibleItems.length === 0 && (
        <FeedEmpty icon="addperson" title="Nothing here yet" body="Videos from sellers you follow show here."
          action={<button className="btn vglass" onClick={() => nav("/explore")}>Find sellers</button>} />
      )}
      {items && tab === "for_you" && visibleItems.length === 0 && (
        <FeedEmpty icon="play" title="No videos yet" body="Be the first. Open a shop and post one."
          action={<button className="btn vglass" onClick={() => withUser(() => nav("/post"), "Sign in to sell")}>Start selling</button>} />
      )}
      {items && tab !== "live" && visibleItems.length > 0 && <FeedList items={visibleItems} key={tab} onNearEnd={tab === "for_you" ? loadMore : undefined} />}

      <div className="top-bar">
        <Segmented<Tab> label="Feed" onVideo value={tab} onChange={setTab} options={[
          { value: "for_you", label: "For you" },
          { value: "following", label: "Following" },
          ...(FEATURES.live ? [{ value: "live" as Tab, label: <><span className="dot-live" />Live</> }] : []),
        ]} />
        <div className="row" style={{ gap: 8 }}>
          <RewardChip className="vglass" />
          <button className="wallet-chip vglass" onClick={() => nav("/explore?search=1")} aria-label="Search"><Icon name="search" /></button>
        </div>
      </div>
    </div>
  );
}

function FeedEmpty({ icon, title, body, action }: { icon: string; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="feed-empty" style={{ background: "#0b0b0d" }}>
      <div className="blank on-video">
        <Icon name={icon} size={44} strokeWidth={1.5} />
        <b>{title}</b>
        <span>{body}</span>
        {action}
      </div>
    </div>
  );
}

/** Full screen video list with Browse and checkout sheets. Used by the feed and shop pages. */
export function FeedList({ items, start = 0, onNearEnd }: { items: FeedItem[]; start?: number; onNearEnd?: () => void }) {
  const [browse, setBrowse] = useState<FeedItem | null>(null);
  const [buy, setBuy] = useState<FeedItem | null>(null);
  // Auctions: live bid, time left and the bid sheet.
  const [auctions, setAuction] = useAuctions(items.filter((it) => it.product.mode === "auction").map((it) => it.product.id));
  const [bidding, setBidding] = useState<FeedItem | null>(null);
  const [customBid, setCustomBid] = useState(false);
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const { withUser, user, toast } = useSession();
  // Bidding straight from the video: hold for the next step up, or tap the same button for your own amount.
  const needUser = () => { if (user) return false; withUser(undefined, "Sign in to bid"); return true; };
  const quickBid = async (it: FeedItem, amount: number) => {
    try {
      setAuction(await api.placeBid(it.product.id, amount));
      toast(`You're the top bidder at ${R(amount)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That bid didn't go through. Try again.");
      throw e;
    }
  };
  const customFor = (it: FeedItem) => withUser(() => { setCustomBid(true); setBidding(it); }, "Sign in to bid");

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
  useEffect(() => { if (onNearEnd && index >= items.length - 4) onNearEnd(); }, [index, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const [counts, setCounts] = useState<Record<string, { likes: number; reposts: number }>>({});
  useEffect(() => { api.postCounts(items.map((it) => it.postId)).then(setCounts).catch(() => {}); }, [items]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  useEffect(() => { api.shopAvatars(items.map((it) => it.shop.id)).then(setAvatars).catch(() => {}); }, [items]);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  useEffect(() => { api.commentCounts(items.map((it) => it.postId)).then(setCommentCounts).catch(() => {}); }, [items]);
  const [commenting, setCommenting] = useState<FeedItem | null>(null);
  const [more, setMore] = useState<FeedItem | null>(null);
  const [editingListing, setEditingListing] = useState<FeedItem["product"] | null>(null);
  const messageShop = useMessageShop();
  const myShop = useMyShopId();
  const [offering, setOffering] = useState<FeedItem | null>(null);
  const navTo = useNavigate();

  const go = (d: number) => ref.current?.scrollTo({ top: (index + d) * ref.current.clientHeight, behavior: "smooth" });
  const startBuy = (it: FeedItem) => it.product.mode === "auction"
    ? withUser(() => { setBrowse(null); setCustomBid(false); setBidding(it); }, "Sign in to bid")
    : withUser(() => { setBrowse(null); setBuy(it); }, "Sign in to buy");

  return (
    <>
      <div className="feed" ref={ref} aria-label="Video feed">
        {items.map((it) => <VideoCard key={it.postId} item={it} auction={auctions[it.product.id]} avatar={avatars[it.shop.id]} counts={counts[it.postId]} comments={commentCounts[it.postId] ?? 0}
          onBrowse={(x) => setBrowse(x)} onBuy={(x) => startBuy(x)} onComments={() => setCommenting(it)} onMore={() => setMore(it)}
          onQuickBid={(amount) => quickBid(it, amount)} onCustomBid={() => customFor(it)} needUser={needUser} onMessage={() => messageShop(it.shop.id, it.product.id)} />)}
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
        <Sheet title={browse.product.title} onClose={() => setBrowse(null)} footer={browse.shop.id === myShop ? <OwnerBar item={browse} auction={auctions[browse.product.id]} /> : <BuyButton item={browse} auction={auctions[browse.product.id]} onClick={() => startBuy(browse)} block />}>
          <ProductDetails item={browse} onOffer={() => withUser(() => { setOffering(browse); setBrowse(null); }, "Sign in to make an offer")} />
        </Sheet>
      )}
      {offering && <MakeOfferSheet item={{ productId: offering.product.id, shopId: offering.shop.id, title: offering.product.title, priceCents: offering.product.priceCents }}
        onClose={() => setOffering(null)} onSent={(conv) => { setOffering(null); toast("Offer sent. The seller has 24 hours to reply."); navTo(`/messages/${conv}`); }} />}
      {buy && <CheckoutSheet item={buy} onClose={() => setBuy(null)} auctionPrice={buy.product.mode === "auction" ? auctions[buy.product.id]?.priceCents ?? null : null} />}
      {bidding && <AuctionSheet item={bidding} info={auctions[bidding.product.id]} onInfo={setAuction} onClose={() => setBidding(null)} focusCustom={customBid}
        onPay={() => { const it = bidding; setBidding(null); setBuy(it); }} />}
      {commenting && <CommentsSheet postId={commenting.postId} postOwnerShopHandle={commenting.shop.handle} onClose={() => setCommenting(null)}
        onCount={(n) => setCommentCounts((c) => ({ ...c, [commenting.postId]: n }))} />}
      {editingListing && <EditListing product={editingListing} onClose={() => setEditingListing(null)} onDone={() => { setEditingListing(null); window.dispatchEvent(new Event("listing-changed")); }} />}
      {more && <MoreSheet kind="post" targetId={more.postId} shopId={more.shop.id} shopHandle={more.shop.handle} onClose={() => setMore(null)} mine={more.shop.id === myShop}
        onEdit={more.shop.id === myShop ? () => { setEditingListing(more.product); setMore(null); } : undefined}
        onMessage={() => { setMore(null); messageShop(more.shop.id, more.product.id); }} />}
    </>
  );
}

function BuyButton({ item, onClick, block, auction }: { item: FeedItem; onClick: () => void; block?: boolean; auction?: AuctionInfo }) {
  const p = item.product;
  const { user } = useSession();
  const now = useNow(p.mode === "auction");
  if (p.mode === "auction") {
    const b = auctionButton(auction, now);
    return (
      <button className={`btn ${b.kind === "pay" ? "green" : "amber"} ${block ? "block big" : ""}`} onClick={onClick} disabled={b.kind === "ended"}>
        <Icon name={b.kind === "pay" ? "bag" : "clock"} size={18} />{b.label}
      </button>
    );
  }
  const sold = p.mode === "buy_now" && (p.stock < 1 || p.status === "sold_out");
  const held = !!p.heldFor && p.heldFor !== user?.id && !!p.heldUntil && new Date(p.heldUntil) > new Date();
  if (held && !sold) return <button className={`btn ${block ? "block big" : ""}`} disabled><Icon name="lock" size={18} />On hold</button>;
  return (
    <button className={`btn green ${block ? "block big" : ""}`} onClick={onClick} disabled={sold}>
      <Icon name="bag" size={18} />{sold ? "Sold out" : p.mode === "order_now" ? "Order now" : "Buy now"}
    </button>
  );
}

/** One small status chip, only when it tells the buyer something useful. */
function statusChip(it: FeedItem, a?: AuctionInfo, now = Date.now()): { text: string; tone: "green" | "amber" } | null {
  const p = it.product;
  if (p.mode === "auction") {
    if (!a?.endsAt) return { text: "Auction", tone: "amber" };
    if (a.state === "won" && a.winnerIsMe) return { text: "You won · pay within 2 hours", tone: "green" };
    const left = new Date(a.endsAt).getTime() - now;
    return { text: left > 0 && a.state === "open" ? `Auction · ${timeLeft(left)} left` : "Auction ended", tone: "amber" };
  }
  if (p.mode === "order_now") return { text: `Made to order · ${p.leadDays ?? 2} days ahead`, tone: "amber" };
  if (p.mode === "buy_now" && p.stock === 1) return { text: "Only 1 left", tone: "amber" };
  if (p.label === "authentic_designer") return { text: "Authenticity checked", tone: "green" };
  if (it.shop.founding) return { text: "Founding seller", tone: "green" };
  return null;
}

/** Short count like TikTok: 1234 shows as 1.2K. */
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n));

function VideoCard({ item, auction, avatar, counts, comments, onBrowse, onBuy, onComments, onMore, onQuickBid, onCustomBid, needUser, onMessage }: {
  item: FeedItem; auction?: AuctionInfo; avatar?: string; counts?: { likes: number; reposts: number }; comments: number;
  /** Called with the item on screen: a tagged item in a haul video, or the post's own item. */
  onBrowse: (shown: FeedItem) => void; onBuy: (shown: FeedItem) => void; onComments: () => void; onMore: () => void;
  onQuickBid: (amountCents: number) => Promise<void>; onCustomBid: () => void; needUser: () => boolean; onMessage: () => void;
}) {
  // Edited videos: the time on the whole video decides which text, tag and flaw show.
  const [t, setT] = useState(0);
  const [clipIndex, setClipIndex] = useState(0);
  const player = useRef<ClipPlayerApi | null>(null);
  const edit = item.edit;
  const marks = edit ? activeMarks(edit, t) : [];
  const tagId = marks.find((m) => m.kind === "tag")?.productId;
  const tagged = useTaggedItem(tagId && tagId !== item.product.id ? tagId : undefined);
  const shown = tagged ?? item; // the item on screen right now
  const p = shown.product;
  const flaws = edit ? edit.marks.filter((m) => m.kind === "flaw").sort((a, b) => a.at - b.at) : [];
  const tagCount = edit ? new Set(edit.marks.filter((m) => m.kind === "tag").map((m) => m.productId)).size : 0;
  const nextFlaw = () => { const f = flaws.find((x) => x.at > t + 0.3) ?? flaws[0]; if (f) player.current?.seek(f.at); };
  const { following, toggleFollow, liked, reposted, toggleReaction, toast, withUser } = useSession();
  // Your own post: seller tools instead of Follow, Buy and Repost.
  const mine = useIsMine(item.shop.id);
  const isLiked = liked.has(item.postId);
  const isReposted = reposted.has(item.postId);
  // Counts from the server already include the user's own reaction when it was loaded; nudge them on taps since then.
  const [start] = useState({ liked: isLiked, reposted: isReposted });
  const likes = (counts?.likes ?? 0) + (isLiked ? 1 : 0) - (start.liked ? 1 : 0);
  const reposts = (counts?.reposts ?? 0) + (isReposted ? 1 : 0) - (start.reposted ? 1 : 0);
  // Swipe left on a video to open the shop, like TikTok.
  const swipe = useSwipe({ onLeft: () => nav(`/s/${item.shop.handle}`) });
  const react = (kind: "like" | "repost") => withUser(() => { tap(); toggleReaction(item.postId, kind); }, kind === "like" ? "Sign in to like" : "Sign in to repost");
  const nav = useNavigate();
  const now = useNow(item.product.mode === "auction");
  const chip = statusChip(item, auction, now);
  const shownPrice = p.mode === "auction" && !tagged ? (auction?.currentCents ?? auction?.startCents ?? p.priceCents) : p.priceCents;
  const isFollowing = following.has(item.shop.id);
  const [sharing, setSharing] = useState(false);
  const share = () => { tap(); setSharing(true); };
  const sub = [
    p.sizes.length ? (p.sizes.length > 1 ? `Sizes ${p.sizes[0]} to ${p.sizes[p.sizes.length - 1]}` : `Size ${p.sizes[0]}`) : LISTING_LABELS[p.label].label,
    p.mode === "buy_now" && p.stock > 1 ? `${p.stock} left` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className="video-card" aria-label={`${p.title} from ${item.shop.name}`} {...swipe}>
      {edit
        ? <ClipPlayer edit={edit} label={`Video: ${item.caption}`} onTime={(time, i) => { setT(time); setClipIndex(i); }} apiRef={(a) => { player.current = a; }} />
        : <Video src={item.video} label={`Video: ${item.caption}`} productId={item.product.id} />}
      <div className="shade" />
      <div className="text-layer">{marks.filter((m) => m.kind === "text").map((m, i) => <PlacedText key={`${m.at}-${i}`} m={m} />)}</div>
      {marks.some((m) => m.kind === "flaw") && (
        <div className="flaw-flash" role="status"><Icon name="flag" size={14} />{marks.find((m) => m.kind === "flaw")?.text || "Flaw shown here"}</div>
      )}
      <div className="info">
        {(item.repostedBy || chip || flaws.length > 0 || tagCount > 1 || edit?.clips[clipIndex]?.inApp) && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {item.repostedBy && <span className="vchip vglass"><Icon name="repost" size={13} />Reposted by @{item.repostedBy}</span>}
            {chip && !tagged && <span className={`vchip vglass ${chip.tone}`}><span className="d" />{chip.text}</span>}
            {tagCount > 1 && <span className="vchip vglass"><Icon name="bag" size={13} />{tagCount} items in this video</span>}
            {flaws.length > 0 && <button className="vchip vglass flaws amber" onClick={nextFlaw} aria-label={`Show flaws (${flaws.length})`}><span className="d" />{flaws.length === 1 ? "1 flaw shown" : `${flaws.length} flaws shown`}</button>}
            {edit?.clips[clipIndex]?.inApp && <span className="vchip vglass inapp"><span className="d" />Filmed in myHaul</span>}
          </div>
        )}
        <div className="seller-row">
          <Link to={`/s/${item.shop.handle}`} className="row" style={{ gap: 8 }}>
            <Avatar url={avatar} name={item.shop.name} />
            <span className="handle">@{item.shop.handle}</span>
          </Link>
          {mine ? <span className="follow-btn vglass mine-tag"><Icon name="store" size={13} />Your post</span> : (
            <button className="follow-btn vglass" onClick={() => withUser(() => toggleFollow(item.shop.id), "Sign in to follow")} aria-pressed={isFollowing}>
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}
          <button className="more-btn" onClick={onMore} aria-label="More options"><Icon name="more" size={20} strokeWidth={3} /></button>
        </div>
        <div className="caption">{item.caption}</div>
        <div className="prod-row">
        <button className="product-chip vglass" onClick={() => onBrowse(shown)} style={{ textAlign: "left" }} aria-label={`See details: ${p.title}, ${R(p.priceCents)}`}>
          <span className="sw art">{shown.video.muxPlaybackId
            ? <img src={`https://image.mux.com/${shown.video.muxPlaybackId}/thumbnail.jpg?width=120`} alt="" />
            : shown.video.url
            ? (shown.video.kind === "image" ? <img src={shown.video.url} alt="" /> : <video src={`${shown.video.url}#t=0.1`} muted playsInline preload="metadata" />)
            : <ProductArt productId={p.id} fallback="#555" />}</span>
          <span className="grow"><span className="t" style={{ display: "block" }}>{p.title}</span><span className="s" style={{ display: "block" }}>{sub}</span></span>
          <span className="p">{R(shownPrice)}</span>
        </button>
          <button className={`react vglass ${isLiked ? "on like" : ""}`} onClick={() => react("like")} aria-pressed={isLiked} aria-label={`Like, ${likes}`}>
            <Icon name="heart" size={20} /><span>{short(likes)}</span>
          </button>
          {!mine && (
            <button className={`react vglass ${isReposted ? "on repost" : ""}`} onClick={() => react("repost")} aria-pressed={isReposted} aria-label={`Repost, ${reposts}`}>
              <Icon name="repost" size={20} /><span>{short(reposts)}</span>
            </button>
          )}
          <button className="react vglass" onClick={onComments} aria-label={`Comments, ${comments}`}>
            <Icon name="comment" size={20} /><span>{short(comments)}</span>
          </button>
        </div>
        <div className="actions">
          {mine ? <OwnerBar item={shown} auction={tagged ? undefined : auction} /> : !tagged && p.mode === "auction" && auction && auctionButton(auction, now).kind === "bid" ? (
            <HoldToBid glass label={`Hold to bid ${R(auction.minNextCents)}`} price={R(auction.minNextCents)} onConfirm={() => onQuickBid(auction.minNextCents)}
              onTap={onCustomBid} onNeedUser={needUser} />
          ) : <BuyButton item={shown} auction={tagged ? undefined : auction} onClick={() => onBuy(shown)} />}
          {!mine && <button className="vround vglass" onClick={onMessage} aria-label={`Message @${item.shop.handle}`}><Icon name="chat" /></button>}
          <button className="vround vglass" onClick={share} aria-label="Share"><Icon name="share" /></button>
        </div>
      </div>
      {sharing && <ShareSheet postId={item.postId} productId={p.id} title={p.title} priceCents={p.priceCents} onClose={() => setSharing(false)} />}
    </section>
  );
}

const taggedCache = new Map<string, Promise<FeedItem | null>>();
/** A tagged item in a haul video, loaded once and kept. */
function useTaggedItem(productId: string | undefined): FeedItem | null {
  const [it, setIt] = useState<FeedItem | null>(null);
  useEffect(() => {
    if (!productId) { setIt(null); return; }
    if (!taggedCache.has(productId)) taggedCache.set(productId, api.productItem(productId).catch(() => null));
    let live = true;
    taggedCache.get(productId)!.then((x) => { if (live) setIt(x && x.product.status === "live" ? x : null); });
    return () => { live = false; };
  }, [productId]);
  return productId ? it : null;
}

/** On your own post: what buyers see instead of Buy, and where to manage it. */
function OwnerBar({ item, auction }: { item: FeedItem; auction?: AuctionInfo }) {
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const p = item.product;
  const status = p.mode === "auction"
    ? (auction?.bidCount ? `${auction.bidCount} ${auction.bidCount === 1 ? "bid" : "bids"}, top ${R(auction.currentCents ?? p.priceCents)}` : "No bids yet")
    : p.status === "sold_out" || (p.mode === "buy_now" && p.stock < 1) ? "Sold out" : p.mode === "buy_now" ? `${p.stock} in stock` : "Taking orders";
  return (
    <div className="row grow" style={{ gap: 8 }}>
      <button className="btn vglass grow owner-bar" onClick={() => nav("/sell/orders")} aria-label={`Your listing. ${status}. Open your orders`}>
        <span className="grow" style={{ textAlign: "left" }}><b style={{ display: "block" }}>Your listing</b><span className="small" style={{ opacity: 0.8 }}>{status}</span></span>
        <span className="small">Orders</span><Icon name="chevron" size={16} />
      </button>
      {p.mode !== "auction" && <button className="btn vglass owner-edit" onClick={() => setEditing(true)} aria-label="Edit listing"><Icon name="edit" size={18} /></button>}
      {editing && <EditListing product={p} onClose={() => setEditing(false)} onDone={() => { setEditing(false); window.dispatchEvent(new Event("listing-changed")); }} />}
    </div>
  );
}

function ProductDetails({ item, onOffer }: { item: FeedItem; onOffer: () => void }) {
  const p = item.product;
  const messageShop = useMessageShop();
  const mine = useIsMine(item.shop.id);
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
      {mine && <div className="note green-note"><b>This is your listing.</b> Buyers see Buy now and Message seller here.</div>}
      {!mine && <div className="note">
        <b>Buyer protection.</b> Your money is held safely until {p.mode === "buy_now" ? "your 7 day return window closes" : "you have checked your order"}.
        {p.mode === "buy_now" ? " Change your mind? Send it back within 7 days of delivery." : " Made to order, so there are no change of mind returns."}
      </div>}
      <Link to={`/s/${item.shop.handle}`} className="group" style={{ display: "block" }}>
        <div className="cell">
          <span className="avatar">{item.shop.name[0]}</span>
          <span className="grow"><span className="t" style={{ display: "block" }}>{item.shop.name}</span><span className="s" style={{ display: "block" }}>Trust score {item.shop.trustScore}</span></span>
          <TierPill tier={item.shop.tier} />
        </div>
      </Link>
      {!mine && (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn grow" onClick={() => messageShop(item.shop.id, p.id)}><Icon name="chat" size={18} />Message seller</button>
          {p.mode === "buy_now" && p.status === "live" && <button className="btn grow" onClick={onOffer}><Icon name="payout" size={18} />Make an offer</button>}
        </div>
      )}
    </div>
  );
}

// Watching a live show: the seller's video, chat, the pinned item with Buy now, and quick live auctions.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type FeedItem, type LiveChatMessage, type LiveShow } from "../../api";
import { useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { Avatar, useShopAvatars } from "../../components/Avatar";
import { Scene, type SceneKind } from "../../components/Scene";
import { Blank, Loading } from "../../components/ui";
import { AuctionSheet, useAuctions, useNow } from "../../components/Auction";
import { CheckoutSheet } from "../buyer/Checkout";
import { useLiveRoom } from "./useLiveRoom";
import { LiveAuctionCard, LiveBadge, LiveChat, PinnedCard } from "./parts";

/** When a planned show starts: "Today at 18:00", "Tomorrow at 18:00" or "Sat 14 Nov at 18:00". */
export function showTime(iso: string): string {
  const d = new Date(iso), now = new Date();
  const time = d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400e3);
  if (diff === 0) return `Today at ${time}`;
  if (diff === 1) return `Tomorrow at ${time}`;
  return `${d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
}

/** Loads a show and its chat, and reloads whenever either changes. */
export function useShow(id: string) {
  const [show, setShow] = useState<LiveShow | null | undefined>(undefined);
  const [chat, setChat] = useState<LiveChatMessage[]>([]);
  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.liveShow(id), api.liveChat(id)]);
      setShow(s); setChat(c);
    } catch { setShow((cur) => (cur === undefined ? null : cur)); }
  }, [id]);
  useEffect(() => {
    load();
    return api.watchLive(id, load);
  }, [id, load]);
  return { show, chat, reload: load };
}

export function WatchLive() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { user, withUser, toast, following, toggleFollow } = useSession();
  const { show, chat, reload } = useShow(id);
  const live = show?.status === "live";
  const room = useLiveRoom(id, "viewer", live && !show?.mine);
  const auctionId = show?.auction?.product.id;
  const [auctions, setAuction] = useAuctions(auctionId ? [auctionId] : []);
  const now = useNow();
  const [buying, setBuying] = useState<{ item: FeedItem; price?: number } | null>(null);
  const [bidding, setBidding] = useState(false);
  const hostFace = useShopAvatars([show?.shop.id]);
  const info = auctionId ? auctions[auctionId] : undefined;

  // A seller opening their own show goes to the host screen.
  useEffect(() => { if (show?.mine && (show.status === "live" || show.status === "scheduled")) nav(`/live/host/${id}`, { replace: true }); }, [show?.mine, show?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (show === undefined) return <div className="live-screen"><div className="live-center"><Loading /></div></div>;
  const close = () => (window.history.length > 1 ? nav(-1) : nav("/?tab=live"));
  if (!show) return (
    <div className="live-screen"><button className="live-close vglass" onClick={close} aria-label="Close"><Icon name="close" /></button>
      <div className="live-center"><Blank onVideo icon="live" title="This show isn't available" line="It may have ended or been removed." action="See who's live" onAction={() => nav("/?tab=live")} /></div></div>
  );

  const following_ = following.has(show.shop.id);
  const needUser = () => { if (user) return false; withUser(undefined, "Sign in to bid"); return true; };
  const quickBid = async (cents: number) => {
    try {
      const r = await api.placeBid(auctionId!, cents);
      setAuction(r);
      toast(r.leaderIsMe ? `You're the top bidder at R${cents / 100}` : `Another bidder's max matches or beats yours. It's now R${(r.currentCents ?? cents) / 100}`);
    } catch (e) { toast(e instanceof Error ? e.message : "That bid didn't go through."); throw e; }
  };

  const header = (
    <div className="live-top">
      <Link to={`/s/${show.shop.handle}`} className="live-shop">
        <Avatar url={hostFace[show.shop.id]} name={show.shop.name} size={36} />
        <span><b>{show.shop.handle}</b><span className="live-title">{show.title}</span></span>
      </Link>
      {!show.mine && (
        <button className={`follow-btn vglass ${following_ ? "on" : ""}`} aria-pressed={following_}
          onClick={() => withUser(() => toggleFollow(show.shop.id), "Sign in to follow")}>{following_ ? "Following" : "Follow"}</button>
      )}
      <button className="live-close vglass" onClick={close} aria-label="Close"><Icon name="close" /></button>
    </div>
  );

  if (show.status === "scheduled") return (
    <div className="live-screen live-wait">
      {header}
      <div className="live-center">
        <div className="blank on-video">
          <Icon name="live" size={44} strokeWidth={1.5} />
          <b>{showTime(show.startsAt)}</b>
          <span>{show.title}. We'll tell you when @{show.shop.handle} goes live.</span>
          <button className={`btn ${show.reminded ? "vglass" : "green"}`} aria-pressed={show.reminded}
            onClick={() => withUser(async () => {
              try { await api.setLiveReminder(show.id, !show.reminded); reload(); toast(show.reminded ? "Reminder off" : "We'll remind you"); }
              catch (e) { toast(e instanceof Error ? e.message : "Couldn't set the reminder."); }
            }, "Sign in to get a reminder")}>
            <Icon name="bell" size={18} />{show.reminded ? "Reminder on" : "Remind me"}
          </button>
        </div>
      </div>
    </div>
  );

  if (show.status !== "live") return (
    <div className="live-screen">
      {header}
      <div className="live-center"><Blank onVideo icon="live" title="This show has ended" line={`Follow @${show.shop.handle} to hear about the next one.`}
        action="Visit the shop" onAction={() => nav(`/s/${show.shop.handle}`)} /></div>
    </div>
  );

  const demoVideo = show.pinned?.video ?? null;
  const auctionCard = show.auction && info && (info.state === "open" || (info.winnerIsMe && info.state === "won")
    || (info.endsAt && now - new Date(info.endsAt).getTime() < 20_000));

  return (
    <div className="live-screen">
      <div className="live-video">
        {room.state === "on" && <video ref={room.videoRef} autoPlay playsInline />}
        {room.state === "demo" && (
          <>
            {demoVideo?.demo?.scene ? <div className="placeholder"><Scene kind={demoVideo.demo.scene as SceneKind} animated label={`${show.shop.name} is live`} /></div> : <div className="live-demo-bg" />}
            {demoVideo?.url && <video src={demoVideo.url} autoPlay muted loop playsInline aria-label={`${show.shop.name} is live`} />}
          </>
        )}
        {room.state === "connecting" && <div className="live-center"><Loading /></div>}
        {room.state === "error" && (
          <div className="live-center"><Blank onVideo icon="live" title="Can't show the video" line={room.error ?? "Try again in a moment."} action="Try again" onAction={room.retry} /></div>
        )}
      </div>
      <div className="live-shade" aria-hidden="true" />
      {header}
      <LiveBadge viewers={room.state === "on" ? room.viewers : show.peakViewers} startedAt={show.startedAt} />
      {room.state === "demo" && <span className="live-demo-tag vglass">Demo video</span>}
      {room.needsTap && <button className="live-sound vglass" onClick={room.startAudio}><Icon name="sound" size={18} />Tap for sound</button>}

      <div className="live-bottom">
        <LiveChat showId={show.id} messages={chat} onSent={reload} />
        {auctionCard && show.auction ? (
          <LiveAuctionCard item={show.auction} artId={show.pinned?.product.id} info={info} now={now} needUser={needUser} onQuickBid={quickBid}
            onCustom={() => withUser(() => setBidding(true), "Sign in to bid")}
            onPay={() => setBuying({ item: show.auction!, price: info?.priceCents ?? undefined })} />
        ) : show.pinned ? (
          <PinnedCard item={show.pinned} onBuy={() => withUser(() => setBuying({ item: show.pinned! }), "Sign in to buy")} />
        ) : null}
      </div>

      {bidding && show.auction && (
        <AuctionSheet item={show.auction} info={info} onInfo={setAuction} onClose={() => setBidding(false)}
          onPay={() => { setBidding(false); setBuying({ item: show.auction!, price: info?.priceCents ?? undefined }); }} />
      )}
      {buying && <CheckoutSheet item={buying.item} onClose={() => setBuying(null)} auctionPrice={buying.price ?? null} />}
    </div>
  );
}

// Pieces shared by the watch and host screens: live chat, the pinned item and the quick live auction.
import { useEffect, useRef, useState } from "react";
import { timeLeft } from "@app/core";
import { api, type AuctionInfo, type FeedItem, type LiveChatMessage } from "../../api";
import { useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { HoldToBid } from "../../components/HoldToBid";
import { ProductArt } from "../../components/Scene";
import { R } from "../../components/ui";

/** "LIVE" badge with a pulsing dot, and the number watching. */
export function LiveBadge({ viewers, startedAt }: { viewers?: number | null; startedAt?: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t); }, []);
  const secs = startedAt ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)) : null;
  return (
    <div className="live-badges">
      <span className="live-pill"><span className="dot-live" />LIVE{secs != null && <span className="t">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>}</span>
      {viewers != null && <span className="live-viewers vglass"><Icon name="eye" size={14} />{viewers}</span>}
    </div>
  );
}

/** The chat over the video: newest at the bottom, older lines fade out at the top. */
export function LiveChat({ showId, messages, onSent, canHide }: {
  showId: string; messages: LiveChatMessage[]; onSent: () => void; canHide?: boolean;
}) {
  const { user, withUser, toast } = useSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [messages.length]);
  const send = async () => {
    const b = text.trim();
    if (!b || busy) return;
    setBusy(true);
    try { await api.sayLive(showId, b); setText(""); onSent(); }
    catch (e) { toast(e instanceof Error ? e.message : "That didn't send. Try again."); }
    finally { setBusy(false); }
  };
  const hide = async (m: LiveChatMessage) => {
    if (!canHide || !window.confirm(`Hide this message from @${m.who}?`)) return;
    try { await api.hideLiveChat(m.id); onSent(); } catch (e) { toast(e instanceof Error ? e.message : "Couldn't hide it."); }
  };
  return (
    <div className="live-chat">
      <div className="live-chat-list" ref={list} aria-live="polite" aria-label="Live chat">
        {messages.slice(-30).map((m) => (
          <div key={m.id} className={`live-msg ${m.isSeller ? "seller" : ""}`} onClick={canHide ? () => hide(m) : undefined}>
            <b>{m.isSeller ? "Seller" : `@${m.who}`}</b> {m.body}
          </div>
        ))}
      </div>
      <form className="live-say vglass" onSubmit={(e) => { e.preventDefault(); if (!user) return withUser(undefined, "Sign in to chat"); send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value.slice(0, 200))} placeholder={user ? "Say something" : "Sign in to chat"}
          aria-label="Say something" enterKeyHint="send" onFocus={() => { if (!user) withUser(undefined, "Sign in to chat"); }} />
        <button type="submit" aria-label="Send" disabled={!!user && (!text.trim() || busy)}><Icon name="send" size={18} /></button>
      </form>
    </div>
  );
}

/** The pinned Buy now item, floating above the chat. */
export function PinnedCard({ item, onBuy, action }: { item: FeedItem; onBuy?: () => void; action?: React.ReactNode }) {
  const p = item.product;
  return (
    <div className="live-card vglass">
      <span className="live-thumb"><ProductArt productId={p.id} video={item.video} fallback={item.video.demo?.bg ?? "#555"} /></span>
      <div className="live-card-text">
        <b>{p.title}</b>
        <span>{R(p.priceCents)} · {p.stock > 0 ? `${p.stock} left` : <span className="sold-text">Sold out</span>}</span>
      </div>
      {action ?? (onBuy && <button className={`btn ${p.stock < 1 ? "soldout" : "green"}`} onClick={onBuy} disabled={p.stock < 1}>{p.stock < 1 ? "Sold out" : "Buy now"}</button>)}
    </div>
  );
}

/** A quick live auction: top bid, a ring counting down, and hold to bid (or + for your own amount or a max). */
export function LiveAuctionCard({ item, artId, info, now, onQuickBid, onCustom, onPay, needUser, host }: {
  item: FeedItem; artId?: string; info?: AuctionInfo; now: number; onQuickBid?: (cents: number) => Promise<void>; onCustom?: () => void;
  onPay?: () => void; needUser?: () => boolean; host?: boolean;
}) {
  const ends = info?.endsAt ? new Date(info.endsAt).getTime() : 0;
  const left = Math.max(0, ends - now);
  const open = info?.state === "open" && left > 0;
  const secs = Math.ceil(left / 1000);
  const total = 60_000;
  const frac = open ? Math.min(1, left / total) : 0;
  const top = info?.currentCents ?? null;
  return (
    <div className={`live-auction vglass ${open && secs <= 10 ? "ending" : ""}`}>
      <div className="live-auction-top">
        <span className="live-thumb"><ProductArt productId={artId ?? item.product.id} fallback={item.video.demo?.bg ?? "#555"} /></span>
        <div className="live-card-text">
          <b>{item.product.title}</b>
          <span>{top != null ? <>Top bid <b className="num">{R(top)}</b>{info?.bidCount ? ` · ${info.bidCount} ${info.bidCount === 1 ? "bid" : "bids"}` : ""}</> : <>Starts at <b className="num">{R(info?.startCents ?? item.product.priceCents)}</b></>}</span>
        </div>
        <div className="live-clock" aria-label={open ? `${secs} seconds left` : "Auction over"} style={{ ["--frac" as string]: frac }}>
          <span className="num">{open ? (secs >= 60 ? timeLeft(left) : secs) : "0"}</span>
        </div>
      </div>
      {open && !host && info && onQuickBid && (
        <div className="bid-row">
          <button className="vround vglass" onClick={onCustom} aria-label="Pick your own amount"><Icon name="plus" /></button>
          <HoldToBid glass label={`Hold to bid ${R(info.minNextCents)}`} price={R(info.minNextCents)} onConfirm={() => onQuickBid(info.minNextCents)}
            onTap={onCustom} onNeedUser={needUser} />
        </div>
      )}
      {open && info?.leaderIsMe && !host && <div className="live-auction-note green">You're the top bidder</div>}
      {!open && info && (
        info.winnerIsMe && info.state === "won" ? (
          <button className="btn green block" onClick={onPay}>You won. Pay {R(info.priceCents ?? 0)}</button>
        ) : (
          <div className="live-auction-note">{info.state === "won" || info.state === "paid" ? `Sold for ${R(info.priceCents ?? top ?? 0)}` : info.state === "open" ? "Closing…" : "No winner this time"}</div>
        )
      )}
    </div>
  );
}

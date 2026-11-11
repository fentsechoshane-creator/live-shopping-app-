import { useEffect, useRef, useState } from "react";
import { bidStep, timeLeft } from "@app/core";
import { api, type AuctionInfo, type FeedItem } from "../api";
import { useSession } from "../session";
import { Icon } from "./Icon";
import { HoldToBid } from "./HoldToBid";
import { ErrorNote, R, Sheet, timeAgo } from "./ui";

/** Ticks once a second, for countdowns. */
export function useNow(active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/** Live auction details for a list of items. Updates the moment someone bids (Realtime), and again just after the clock runs out. */
export function useAuctions(ids: string[]) {
  const key = ids.join(",");
  const [info, setInfo] = useState<Record<string, AuctionInfo>>({});
  useEffect(() => {
    if (!ids.length) return;
    let live = true;
    const load = () => api.auctionInfo(ids).then((r) => live && setInfo((cur) => ({ ...cur, ...r }))).catch(() => {});
    load();
    const stop = api.watchAuctions(ids, load);
    return () => { live = false; stop(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // When the soonest open auction ends, check once more so "Sold" or "You won" shows without waiting.
  const nextEnd = Object.values(info).filter((a) => a.state === "open" && a.endsAt).map((a) => new Date(a.endsAt!).getTime()).sort((a, b) => a - b)[0];
  useEffect(() => {
    if (!nextEnd) return;
    const t = window.setTimeout(() => api.auctionInfo(ids).then((r) => setInfo((cur) => ({ ...cur, ...r }))).catch(() => {}), Math.max(0, nextEnd - Date.now()) + 1500);
    return () => window.clearTimeout(t);
  }, [nextEnd, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [info, (r: AuctionInfo) => setInfo((cur) => ({ ...cur, [r.productId]: r }))] as const;
}

/** What the main button on an auction says, and whether it's the winner paying. */
export function auctionButton(a: AuctionInfo | undefined, now: number): { label: string; kind: "bid" | "pay" | "ended" } {
  if (!a) return { label: "Bid", kind: "bid" };
  if (a.state === "won" && a.winnerIsMe) return { label: `Pay ${R(a.priceCents ?? 0)}`, kind: "pay" };
  if (a.state !== "open" || (a.endsAt && new Date(a.endsAt).getTime() <= now)) return { label: a.state === "won" || a.state === "paid" ? "Sold" : "Ended", kind: "ended" };
  return { label: `Bid · ${R(a.currentCents ?? a.startCents)}`, kind: "bid" };
}

/**
 * Bid on a timed auction. Shows the current bid, time left, reserve and recent bids. Pick an amount with minus and plus
 * (one bid step each), quick adds, or tap the amount to type it. Max bid lets us bid for you, only when you're outbid,
 * up to your max (see maxBidReplies in packages/core). A bid is a promise to buy: the winner pays within 2 hours.
 */
export function AuctionSheet({ item, info, onInfo, onClose, onPay }: {
  item: FeedItem; info?: AuctionInfo; onInfo: (a: AuctionInfo) => void; onClose: () => void; onPay: () => void;
}) {
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const amountBox = useRef<HTMLInputElement>(null);
  const { toast } = useSession();
  const [picked, setPicked] = useState<number | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [maxOn, setMaxOn] = useState(false);
  const [showBids, setShowBids] = useState(false);
  const ends = info?.endsAt ? new Date(info.endsAt).getTime() : 0;
  const left = ends - now;
  const open = info?.state === "open" && left > 0;
  // When the clock hits zero, close it on the server and refresh.
  useEffect(() => {
    if (info?.state === "open" && left <= 0) api.settleAuction(item.product.id).then(() => api.auctionInfo([item.product.id])).then((r) => r[item.product.id] && onInfo(r[item.product.id])).catch(() => {});
  }, [info?.state, left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (typing !== null) amountBox.current?.focus(); }, [typing !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const min = info?.minNextCents ?? item.product.priceCents;
  const current = info?.currentCents ?? null;
  const myMax = info?.myMaxCents ?? null;
  // The lowest you can enter: the next bid, or for a max, above where you already are.
  const floor = maxOn
    ? Math.max(min, info?.leaderIsMe && current != null ? current + bidStep(current) : 0, myMax != null ? myMax + bidStep(myMax) : 0)
    : min;
  const amount = Math.max(floor, picked ?? floor);
  const set = (cents: number) => setPicked(Math.max(floor, Math.round(cents / 1000) * 1000));
  const commitTyping = () => { if (typing !== null) { const n = Number(typing); if (n > 0) set(n * 100); setTyping(null); } };
  // Called by the hold button once the ring closes. Throwing resets the button so they can try again.
  const bid = async () => {
    setError(null);
    try {
      const r = await api.placeBid(item.product.id, amount, maxOn ? { max: true } : undefined);
      onInfo(r);
      setPicked(null); setMaxOn(false);
      toast(r.leaderIsMe
        ? (maxOn ? `Max set to ${R(amount)}. You're on top at ${R(r.currentCents ?? amount)}` : `You're the top bidder at ${R(amount)}`)
        : `Another bidder's max matches or beats yours. It's now ${R(r.currentCents ?? amount)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That bid didn't go through. Try again.");
      throw e;
    }
  };

  return (
    <Sheet title={item.product.title} onClose={onClose}
      footer={info?.state === "won" && info.winnerIsMe ? (
        <>
          <button className="btn green block big" onClick={onPay}>Pay {R(info.priceCents ?? 0)}</button>
          <p className="small muted row" style={{ justifyContent: "center", margin: "8px 0 0", gap: 6 }}>
            <Icon name="clock" size={15} />Pay within {timeLeft(new Date(info.payBy ?? 0).getTime() - now)} to keep it.
          </p>
        </>
      ) : open ? (
        <>
          <ErrorNote error={error} />
          <HoldToBid block label={maxOn ? `Hold to set max ${R(amount)}` : `Hold to bid ${R(amount)}`} price={R(amount)} verb={maxOn ? "Max" : "Bid"} onConfirm={bid} disabled={typing !== null} />
          <p className="small muted" style={{ textAlign: "center", margin: "8px 0 0" }}>A bid is a promise to buy. If you win, pay within 2 hours.</p>
        </>
      ) : undefined}>
      {!info && <div className="muted">Loading the auction…</div>}
      {info && (
        <>
          <div className="auction-hero">
            <div>
              <div className="lbl">{info.currentCents ? (open ? "Top bid" : "Final bid") : "Starting bid"}</div>
              <div className="amt">{R(info.currentCents ?? info.startCents)}</div>
              <div className="small muted">{info.bidCount} {info.bidCount === 1 ? "bid" : "bids"}</div>
            </div>
            <div className={`clock ${open && left < 5 * 60e3 ? "ending" : ""}`} aria-live="polite">
              <div className="lbl">{open ? "Ends in" : "Auction"}</div>
              <b>{open ? timeLeft(left) : info.state === "won" || info.state === "paid" ? "Sold" : "Ended"}</b>
            </div>
          </div>
          <div className="auction-flags">
            {info.reserveSet && <span className={`pill ${info.reserveMet ? "green" : "amber"}`}>{info.reserveMet ? "Reserve met" : "Reserve not met yet"}</span>}
            {!info.reserveSet && <span className="pill">No reserve</span>}
            {info.leaderIsMe && open && <span className="pill green">You're the top bidder</span>}
            {!info.leaderIsMe && info.myTopCents && open && <span className="pill amber">You've been outbid</span>}
            {info.state === "won" && info.winnerIsMe && <span className="pill green">You won</span>}
          </div>

          {open && (
            <>
              <div className="bid-stepper">
                <button className="step-btn" onClick={() => set(amount - bidStep(amount - 1))} disabled={amount <= floor} aria-label={`Lower by ${R(bidStep(amount - 1))}`}>
                  <Icon name="minus" size={22} strokeWidth={2.4} />
                </button>
                <div className="step-amt">
                  {typing === null ? (
                    <button className="amt" onClick={() => setTyping(String(amount / 100))} aria-label={`Your bid, ${R(amount)}. Tap to type an amount`}>{R(amount)}</button>
                  ) : (
                    <label className="amt typing">R<input ref={amountBox} value={typing} inputMode="numeric" enterKeyHint="done" aria-label="Type your bid in rand"
                      onChange={(e) => setTyping(e.target.value.replace(/[^\d]/g, "").slice(0, 6))} onBlur={commitTyping}
                      onKeyDown={(e) => { if (e.key === "Enter") commitTyping(); }} size={Math.max(2, typing.length)} /></label>
                  )}
                  <div className="small muted">{amount === floor ? (maxOn ? "The lowest max you can set" : "The lowest you can bid") : `${R(floor)} or more, in steps of ${R(bidStep(amount))}`}</div>
                </div>
                <button className="step-btn up" onClick={() => set(amount + bidStep(amount))} aria-label={`Raise by ${R(bidStep(amount))}`}>
                  <Icon name="plus" size={22} strokeWidth={2.4} />
                </button>
              </div>
              <div className="quick-bids" role="group" aria-label="Quick amounts">
                <button onClick={() => setPicked(null)} aria-pressed={amount === floor}>{R(floor)}</button>
                <button onClick={() => set(amount + 5000)}>+R50</button>
                <button onClick={() => set(amount + 10000)}>+R100</button>
              </div>
              <div className="max-card">
                <div>
                  <div className="t">Max bid</div>
                  <div className="small muted">{maxOn
                    ? `We bid for you only when someone outbids you, one step at a time, up to ${R(amount)}. Nobody sees your max.`
                    : myMax != null ? `Your max is ${R(myMax)}. Turn this on to raise it.` : `Off: you bid exactly ${R(amount)}.`}</div>
                </div>
                <button className="switch" role="switch" aria-checked={maxOn} aria-label="Max bid" onClick={() => { setMaxOn(!maxOn); setPicked(null); }} />
              </div>
            </>
          )}

          {info.recent.length > 0 && (
            <div className={`fold ${showBids ? "open" : ""}`}>
              <button className="fold-head" onClick={() => setShowBids(!showBids)} aria-expanded={showBids} aria-controls="recent-bids">
                <span>Recent bids</span>
                <span className="fold-count">{info.bidCount} {info.bidCount === 1 ? "bid" : "bids"}</span>
                <Icon name="down" size={18} />
              </button>
              <div className="fold-body" id="recent-bids">
                <div className="bid-list">
                  {info.recent.map((b, i) => (
                    <div key={i} className="row between"><span><b>{b.who}</b> <span className="muted small">{timeAgo(b.at)}</span></span><b>{R(b.amountCents)}</b></div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="note" style={{ marginTop: 12 }}>
            <b>How auctions work.</b> Bids go up in fixed steps. A bid in the last minute resets the clock to 1 minute, so nobody wins by sniping.
            The winner pays within 2 hours and the money is held safely. No change of mind returns, but you're covered if it's wrong or faulty.
          </div>
        </>
      )}
    </Sheet>
  );
}

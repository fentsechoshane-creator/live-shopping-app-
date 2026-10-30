import { useEffect, useState } from "react";
import { bidStep, timeLeft } from "@app/core";
import { api, type AuctionInfo, type FeedItem } from "../api";
import { useSession } from "../session";
import { tap } from "../native";
import { Icon } from "./Icon";
import { ErrorNote, R, Sheet, timeAgo, useAction } from "./ui";

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

/** Live auction details for a list of items, refreshed every few seconds. */
export function useAuctions(ids: string[], every = 5000) {
  const key = ids.join(",");
  const [info, setInfo] = useState<Record<string, AuctionInfo>>({});
  useEffect(() => {
    if (!ids.length) return;
    let live = true;
    const load = () => api.auctionInfo(ids).then((r) => live && setInfo((cur) => ({ ...cur, ...r }))).catch(() => {});
    load();
    const t = window.setInterval(load, every);
    return () => { live = false; window.clearInterval(t); };
  }, [key, every]); // eslint-disable-line react-hooks/exhaustive-deps
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
 * Bid on a timed auction. Shows the current bid, time left, reserve and recent bids, and offers quick amounts.
 * A bid is a promise to buy: the winner pays within 2 hours.
 */
export function AuctionSheet({ item, info, onInfo, onClose, onPay }: {
  item: FeedItem; info?: AuctionInfo; onInfo: (a: AuctionInfo) => void; onClose: () => void; onPay: () => void;
}) {
  const now = useNow();
  const { busy, error, run } = useAction();
  const { toast } = useSession();
  const [custom, setCustom] = useState("");
  const [pick, setPick] = useState<number | null>(null);
  const ends = info?.endsAt ? new Date(info.endsAt).getTime() : 0;
  const left = ends - now;
  const open = info?.state === "open" && left > 0;
  // When the clock hits zero, close it on the server and refresh.
  useEffect(() => {
    if (info?.state === "open" && left <= 0) api.settleAuction(item.product.id).then(() => api.auctionInfo([item.product.id])).then((r) => r[item.product.id] && onInfo(r[item.product.id])).catch(() => {});
  }, [info?.state, left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const min = info?.minNextCents ?? item.product.priceCents;
  const quick = [min, min + bidStep(min), min + 3 * bidStep(min)];
  const amount = custom ? Math.round(Number(custom) * 100) : pick ?? min;
  const bid = () => run(async () => {
    const r = await api.placeBid(item.product.id, amount);
    tap();
    onInfo(r);
    setCustom(""); setPick(null);
    toast(`You're the top bidder at ${R(amount)}`);
  });

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
          <button className="btn amber block big" onClick={bid} disabled={busy || amount < min}>{busy ? "Placing bid…" : `Bid ${R(amount)}`}</button>
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
              <div className="quick-bids" role="group" aria-label="Quick bids">
                {quick.map((q) => <button key={q} aria-pressed={!custom && (pick ?? min) === q} onClick={() => { setCustom(""); setPick(q); }}>{R(q)}</button>)}
              </div>
              <div className="field" style={{ marginBottom: 6 }}>
                <label htmlFor="bid-amount">Or your own amount (R{min / 100} or more)</label>
                <input id="bid-amount" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder={String(min / 100)} enterKeyHint="done" />
              </div>
            </>
          )}

          {info.recent.length > 0 && (
            <>
              <h3 style={{ fontSize: 15, margin: "10px 0 2px" }}>Recent bids</h3>
              <div className="bid-list">
                {info.recent.map((b, i) => (
                  <div key={i} className="row between"><span><b>{b.who}</b> <span className="muted small">{timeAgo(b.at)}</span></span><b>{R(b.amountCents)}</b></div>
                ))}
              </div>
            </>
          )}
          <div className="note" style={{ marginTop: 12 }}>
            <b>How auctions work.</b> Bids go up in fixed steps. A bid in the last 2 minutes adds 2 minutes, so nobody wins by sniping.
            The winner pays within 2 hours and the money is held safely. No change of mind returns, but you're covered if it's wrong or faulty.
          </div>
        </>
      )}
    </Sheet>
  );
}

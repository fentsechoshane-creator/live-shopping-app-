// Surprise rewards (migration 0024). Never advertised: the wallet button only appears once someone has earned one,
// and the surprise shows once, the first time the app opens after the order is delivered.
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type Reward } from "../api";
import { useLoad, useSession } from "../session";
import { Icon } from "./Icon";
import { R, Sheet, dateText } from "./ui";

const WHY: Record<Reward["kind"], string> = {
  first_buy: "for your first order",
  first_auction: "for your first auction win",
  first_sale: "for your first sale",
  invite_sent: "for inviting a friend",
  invite_joined: "for joining with an invite",
};

/** Your rewards, refreshed when you move around the app. */
export function useRewards() {
  const { user } = useSession();
  const loc = useLocation();
  const [bump, setBump] = useState(0);
  // Pages that change an order send "rewards-check"; coming back to the app checks too.
  useEffect(() => {
    const on = () => setBump((n) => n + 1);
    window.addEventListener("rewards-check", on); window.addEventListener("focus", on);
    return () => { window.removeEventListener("rewards-check", on); window.removeEventListener("focus", on); };
  }, []);
  const [r, , reload] = useLoad(() => (user ? api.myRewards() : Promise.resolve([] as Reward[])), [user?.id, loc.pathname, bump]);
  return { rewards: r ?? [], reload };
}

/** "R50 off" when a reward is ready, "R50 soon" while it waits for the return window. Nothing otherwise. */
export function RewardChip({ className }: { className: string }) {
  const { rewards } = useRewards();
  const [open, setOpen] = useState(false);
  const ready = rewards.filter((r) => r.status === "ready");
  const pending = rewards.filter((r) => r.status === "pending");
  if (!ready.length && !pending.length) return null;
  const amt = (ready[0] ?? pending[0]).amountCents;
  return (
    <>
      <button className={`wallet-chip label ${className}`} onClick={() => setOpen(true)}
        aria-label={ready.length ? `${R(amt)} reward ready` : `${R(amt)} reward coming`}>
        <Icon name="wallet" /><span className="amt">{R(amt)} {ready.length ? "off" : "soon"}</span>
      </button>
      {open && <WalletSheet rewards={rewards} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Every reward, what it was for and when it can be used. */
export function WalletSheet({ rewards, onClose }: { rewards: Reward[]; onClose: () => void }) {
  const nav = useNavigate();
  const [stamps, setStamps] = useState(0);
  useEffect(() => { api.deliveryStamps().then(setStamps).catch(() => {}); }, []);
  const ready = rewards.filter((r) => r.status === "ready");
  return (
    <Sheet title="Wallet" onClose={onClose}>
      <div className="wallet-hero">
        <span className="small muted">Ready to use</span>
        <b>{R(ready.reduce((n, r) => n + r.amountCents, 0))}</b>
      </div>
      {rewards.length === 0
        ? <div className="note" style={{ marginBottom: 12 }}>No rewards right now. Refunds go back to your card or account, not here.</div>
        : <div className="group" style={{ marginBottom: 12 }}>
            {rewards.map((r) => (
              <div key={r.id} className="cell">
                <span className="grow"><span className="t" style={{ display: "block" }}>{R(r.amountCents)} {WHY[r.kind]}</span>
                  <span className="s" style={{ display: "block" }}>{statusText(r)}</span></span>
              </div>
            ))}
          </div>}
      <div className="note" style={{ marginBottom: 12 }}>
        <b>Delivery stamps: {Math.min(stamps, 5)} of 5</b>
        <span className="stamp-row" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <span key={i} className={i < stamps ? "on" : ""} />)}</span>
        <span className="small" style={{ display: "block", marginTop: 6 }}>{stamps >= 5
          ? "Your next courier or locker delivery is half price."
          : "Pay with Instant EFT (Ozow) on orders of R200 or more. Each one earns a stamp once its return window closes; 5 stamps give half price delivery."}</span>
      </div>
      <p className="small muted">One reward comes off an order of R200 or more, by itself at checkout. Rewards and stamps have no cash value.</p>
      <button className="btn block" onClick={() => { onClose(); nav("/orders"); }}><Icon name="bag" size={18} />My orders</button>
    </Sheet>
  );
}

function statusText(r: Reward) {
  if (r.status === "ready") return "Ready. Comes off your next order of R200 or more.";
  if (r.status === "pending") return r.usableFrom ? `Ready on ${dateText(r.usableFrom)}, when the return window closes.` : "Ready when the return window closes.";
  if (r.status === "used") return "Used.";
  return "Removed because the order was returned or refunded.";
}

/** The surprise: shown once for each new reward. */
export function RewardSurprise() {
  const { rewards } = useRewards();
  const fresh = rewards.find((r) => !r.seen && (r.status === "pending" || r.status === "ready"));
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => { if (fresh && shown !== fresh.id) setShown(fresh.id); }, [fresh?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!fresh || shown !== fresh.id) return null;
  const close = () => { api.markRewardsSeen([fresh.id]).catch(() => {}); setShown("done:" + fresh.id); };
  return (
    <div className="surprise-scrim" onClick={close}>
      <div className="surprise" role="dialog" aria-label="Surprise reward" onClick={(e) => e.stopPropagation()}>
        <div className="surprise-burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}</div>
        <div className="surprise-badge"><Icon name="wallet" size={30} /></div>
        <span className="small muted">Surprise!</span>
        <b className="surprise-amt">{R(fresh.amountCents)}</b>
        <p>A thank you {WHY[fresh.kind]}{fresh.orderTitle ? `, ${fresh.orderTitle}` : ""}.</p>
        <p className="small muted">{fresh.status === "ready" ? "It's ready now." : fresh.usableFrom ? `It's yours to spend from ${dateText(fresh.usableFrom)}, once the return window closes.` : "It's yours to spend once the return window closes."} It comes off an order of R200 or more by itself.</p>
        <button className="btn green block" onClick={close}>Nice!</button>
      </div>
    </div>
  );
}

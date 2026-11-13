import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuctionInfo, FeedItem } from "../../api";
import { BackButton, R, swatch } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { ProductArt } from "../../components/Scene";
import { Viewer } from "../../components/PostGrid";
import { useNow } from "../../components/Auction";
import { CheckoutSheet } from "./Checkout";

const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Where "You won" takes you (Ofentse picked the green banner, 12 Nov). The video sits on the left of the banner (tap to
 * watch it), the item and winning price on the right. Under it: time left to pay, the bids and the seller, what happens
 * next, and one green Pay button. After paying it points to the order instead.
 */
export function WonScreen({ item, info, onPaid }: { item: FeedItem; info: AuctionInfo; onPaid: () => void }) {
  const nav = useNavigate();
  const now = useNow(info.state === "won");
  const [watching, setWatching] = useState(false);
  const [paying, setPaying] = useState(false);
  const p = item.product;
  const price = info.priceCents ?? info.currentCents ?? p.priceCents;
  const left = info.payBy ? new Date(info.payBy).getTime() - now : 0;
  const paid = info.state === "paid";
  const late = info.state === "won" && left <= 0;
  const sub = [`@${item.shop.handle}`, p.sizes.length === 1 ? `Size ${p.sizes[0]}` : null].filter(Boolean).join(" · ");

  return (
    <div className="screen won">
      <BackButton />
      <div className="won-banner">
        <button className="won-video" onClick={() => setWatching(true)} aria-label={`Watch the video of ${p.title}`}>
          <ProductArt productId={p.id} video={item.video} fallback={item.video.demo?.bg ?? swatch(p.id)} />
          <span className="won-play"><Icon name="play" size={20} /></span>
        </button>
        <div className="won-text">
          <span className="won-pill">{paid ? "Paid ✅" : "You won 🎉"}</span>
          <b className="won-title">{p.title}</b>
          <span className="won-sub">{sub}</span>
          <span className="won-price num">{R(price)}</span>
        </div>
      </div>

      <div className="group" style={{ marginTop: 14 }}>
        {!paid && (
          <div className="cell"><span className="grow t">{late ? "Time to pay" : "Time left to pay"}</span>
            <span className={`num ${late ? "sold-text" : "won-timer"}`}>{late ? "Ended" : hms(left)}</span></div>
        )}
        <div className="cell"><span className="grow t">Bids</span><span className="muted num">{info.bidCount}</span></div>
        <button className="cell" onClick={() => nav(`/s/${item.shop.handle}`)}><span className="grow t" style={{ textAlign: "left" }}>Seller</span>
          <span className="muted">{item.shop.name}</span><Icon name="chevron" size={14} /></button>
      </div>

      <div className="won-steps">
        {[["Won", true], ["Pay. Your money is held safely", paid], ["Seller ships with tracking", false]].map(([t, done], i) => (
          <div className="won-step" key={String(t)}>
            <span className={`won-dot ${done ? "on" : ""}`}>{done ? <Icon name="check" size={12} strokeWidth={3} /> : i + 1}</span>{t}
          </div>
        ))}
      </div>

      <div className="won-foot">
        {paid ? <button className="btn green block big" onClick={() => nav("/orders")}>See your order</button>
          : late ? <p className="small muted" style={{ textAlign: "center" }}>The 2 hours to pay have passed, so this win was cancelled.</p>
          : <>
              <button className="btn green block big" onClick={() => setPaying(true)}><Icon name="bag" size={18} />Pay {R(price)}</button>
              <p className="small muted" style={{ textAlign: "center", marginTop: 8 }}>Delivery is added at checkout</p>
            </>}
      </div>

      {watching && <Viewer items={[item]} start={0} onClose={() => setWatching(false)} />}
      {paying && <CheckoutSheet item={item} auctionPrice={price} onClose={() => { setPaying(false); onPaid(); }} />}
    </div>
  );
}

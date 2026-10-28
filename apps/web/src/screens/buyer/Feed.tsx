import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LISTING_LABELS } from "@app/core";
import { api, type FeedItem } from "../../api";
import { useLoad, useSession } from "../../session";
import { Video } from "../../components/Video";
import { Loading, R, Sheet, TierPill } from "../../components/ui";
import { CheckoutSheet } from "./Checkout";

export function FeedList({ items }: { items: FeedItem[] }) {
  const [browse, setBrowse] = useState<FeedItem | null>(null);
  const [buy, setBuy] = useState<FeedItem | null>(null);
  const { user } = useSession();
  const nav = useNavigate();

  const startBuy = (it: FeedItem) => {
    if (!user) return nav(`/signin?next=${encodeURIComponent("/")}`);
    setBrowse(null);
    setBuy(it);
  };

  if (!items.length) return <div className="empty" style={{ color: "#a1a1aa" }}>No videos yet. Be the first seller to post.</div>;

  return (
    <>
      {items.map((it) => (
        <VideoCard key={it.postId} item={it} onBrowse={() => setBrowse(it)} onBuy={() => startBuy(it)} />
      ))}
      {browse && (
        <Sheet title={browse.product.title} onClose={() => setBrowse(null)}
          footer={<BuyButton item={browse} onClick={() => startBuy(browse)} block />}>
          <ProductDetails item={browse} />
        </Sheet>
      )}
      {buy && <CheckoutSheet item={buy} onClose={() => setBuy(null)} />}
    </>
  );
}

export function Feed() {
  const [items, error] = useLoad(() => api.feed(), []);
  return (
    <div className="fill">
      <div className="feed" aria-label="Video feed">
        {error && <div className="error" style={{ margin: 16 }}>{error}</div>}
        {!items && !error ? <div style={{ color: "#fff" }}><Loading /></div> : <FeedList items={items ?? []} />}
      </div>
      <div className="top-bar">
        <div className="seg"><span className="on" style={{ padding: "8px 14px", borderRadius: 999, fontWeight: 600, fontSize: 13.5 }}>For you</span></div>
      </div>
    </div>
  );
}

function BuyButton({ item, onClick, block }: { item: FeedItem; onClick: () => void; block?: boolean }) {
  const p = item.product;
  const sold = p.mode === "buy_now" && (p.stock < 1 || p.status === "sold_out");
  const cls = p.mode === "order_now" ? "dark" : "green";
  return (
    <button className={`btn ${cls} ${block ? "block big" : ""}`} onClick={onClick} disabled={sold}>
      {sold ? "Sold out" : p.mode === "order_now" ? "Order now" : "Buy now"}
    </button>
  );
}

function VideoCard({ item, onBrowse, onBuy }: { item: FeedItem; onBrowse: () => void; onBuy: () => void }) {
  const p = item.product;
  const share = async () => {
    const url = `${location.origin}/s/${item.shop.handle}`;
    try {
      if (navigator.share) await navigator.share({ title: p.title, url });
      else await navigator.clipboard.writeText(url);
    } catch { /* cancelled */ }
  };
  return (
    <section className="video-card" aria-label={`${p.title} from ${item.shop.name}`}>
      <Video src={item.video} label={`Video: ${item.caption}`} />
      <div className="shade" />
      <div className="info">
        <Link to={`/s/${item.shop.handle}`} className="seller">
          <span className="avatar">{item.shop.name[0]}</span>
          <span>@{item.shop.handle}</span>
          {item.shop.tier !== "standard" && <TierPill tier={item.shop.tier} />}
        </Link>
        <div style={{ fontSize: 14 }}>{item.caption}</div>
        <div className="product-chip">
          <div className="grow">
            <div className="t">{p.title}</div>
            <div className="s">{LISTING_LABELS[p.label].label}{p.sizes.length ? ` · ${p.sizes.join(", ")}` : ""}{p.mode === "order_now" ? ` · Order ${p.leadDays ?? 2} days ahead` : ""}</div>
          </div>
          <b>{R(p.priceCents)}</b>
        </div>
        <div className="actions">
          <button className="btn" style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }} onClick={onBrowse}>Browse</button>
          <BuyButton item={item} onClick={onBuy} />
          <button className="icon-btn" onClick={share} aria-label="Share">↗</button>
        </div>
      </div>
    </section>
  );
}

function ProductDetails({ item }: { item: FeedItem }) {
  const p = item.product;
  return (
    <div className="stack">
      <div className="row between"><span className="pill">{LISTING_LABELS[p.label].label}</span><b style={{ fontSize: 20 }}>{R(p.priceCents)}</b></div>
      {p.condition && <div className="small">Condition: <b>{p.condition.replace("_", " ")}</b></div>}
      {p.description && <p style={{ margin: 0, lineHeight: 1.5 }}>{p.description}</p>}
      {p.sizes.length > 0 && <div className="small">Sizes: {p.sizes.join(", ")}</div>}
      {p.allergens && <div className="note amber">Allergens: {p.allergens}</div>}
      <div className="note">
        <b>Buyer protection.</b> Your money is held safely until {p.mode === "buy_now" ? "your 7 day return window closes" : "you have checked your order"}.
        {p.mode === "buy_now" ? " Change your mind? Send it back within 7 days of delivery." : " Made to order, so there are no change of mind returns."}
      </div>
      <Link to={`/s/${item.shop.handle}`} className="row" style={{ textDecoration: "none" }}>
        <span className="avatar">{item.shop.name[0]}</span>
        <span className="grow"><b>{item.shop.name}</b><br /><span className="small muted">Trust score {item.shop.trustScore}</span></span>
        <TierPill tier={item.shop.tier} />
      </Link>
    </div>
  );
}

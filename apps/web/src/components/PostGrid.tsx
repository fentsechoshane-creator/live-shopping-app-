import { useEffect, useState } from "react";
import { api, type FeedItem, type ProductPublic } from "../api";
import { FeedList } from "../screens/buyer/Feed";
import { ProductArt } from "./Scene";
import { Icon } from "./Icon";
import { R, swatch } from "./ui";

/** Three across grid of videos, like a TikTok profile. Tapping one opens the full screen player at that video. */
export function PostGrid({ items, empty, openProductId }: { items: FeedItem[]; empty: React.ReactNode; openProductId?: string | null }) {
  const startAt = openProductId ? items.findIndex((it) => it.product.id === openProductId) : -1;
  const [open, setOpen] = useState<number | null>(startAt >= 0 ? startAt : null);
  const views = useProductViews(items.map((it) => it.product.id));
  if (items.length === 0) return <>{empty}</>;
  return (
    <>
      <div className="grid3">
        {items.map((it, i) => (
          <GridTile key={it.postId} product={it.product} views={views[it.product.id]} onClick={() => setOpen(i)}>
            <ProductArt productId={it.product.id} video={it.video} fallback={it.video.demo?.bg ?? swatch(it.product.id)} />
          </GridTile>
        ))}
      </div>
      {open !== null && <Viewer items={items} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Full screen player over the current page, with a back button. */
export function Viewer({ items, start, onClose }: { items: FeedItem[]; start: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Videos">
      <FeedList items={items} start={start} />
      <button className="viewer-back vglass" onClick={onClose} aria-label="Close videos"><Icon name="back" size={20} /></button>
    </div>
  );
}

type PriceKind = "buy" | "auction" | "order" | "sold";
const KIND_WORD: Record<PriceKind, string> = { buy: "Buy now", auction: "Auction", order: "Made to order", sold: "Sold out" };

/** What kind of price a tile shows: green Buy now, amber auction, white made to order, red sold out. */
export function priceKind(p: ProductPublic): PriceKind {
  if (p.status === "sold_out" || (p.mode === "buy_now" && p.stock < 1)) return "sold";
  return p.mode === "auction" ? "auction" : p.mode === "order_now" ? "order" : "buy";
}

/** 950, 1.2K, 12K, 1.2M, like TikTok. Rounds down so a count never shows more than it is. */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${Math.floor(n / 100) / 10}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${Math.floor(n / 100_000) / 10}M`;
}

/** Lifetime views for a grid's items, loaded once per grid. */
export function useProductViews(ids: string[]): Record<string, number> {
  const key = ids.join(",");
  const [views, setViews] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!key) return;
    let live = true;
    api.productViews(key.split(",")).then((v) => live && setViews(v)).catch(() => {});
    return () => { live = false; };
  }, [key]);
  return views;
}

/** One TikTok style tile: the price at the top, coloured by the kind of price, and the views at the bottom right. */
export function GridTile({ product, views, chip, onClick, label, children }: {
  product: ProductPublic; views?: number; chip?: string; onClick: () => void; label?: string; children: React.ReactNode;
}) {
  const kind = priceKind(product);
  const price = kind === "sold" ? "Sold out" : R(product.priceCents);
  return (
    <button className={`g3 ${kind === "sold" ? "sold" : ""}`} onClick={onClick}
      aria-label={`${label ?? product.title}, ${R(product.priceCents)}. ${KIND_WORD[kind]}${views !== undefined ? `. ${views} ${views === 1 ? "view" : "views"}` : ""}`}>
      {children}
      <span className={`g3price ${kind}`}>{kind === "auction" && <Icon name="clock" size={11} strokeWidth={2.6} />}{price}</span>
      {chip && <span className="g3chip">{chip}</span>}
      {views !== undefined && <span className="g3views"><Icon name="play" size={11} />{shortCount(views)}</span>}
    </button>
  );
}

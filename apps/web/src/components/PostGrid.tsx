import { useEffect, useState } from "react";
import type { FeedItem } from "../api";
import { FeedList } from "../screens/buyer/Feed";
import { ProductArt } from "./Scene";
import { Icon } from "./Icon";
import { R, swatch } from "./ui";
import { clock, useVideoLength } from "./Video";

/** Three across grid of videos, like a TikTok profile. Tapping one opens the full screen player at that video. */
export function PostGrid({ items, empty, openProductId }: { items: FeedItem[]; empty: React.ReactNode; openProductId?: string | null }) {
  const startAt = openProductId ? items.findIndex((it) => it.product.id === openProductId) : -1;
  const [open, setOpen] = useState<number | null>(startAt >= 0 ? startAt : null);
  if (items.length === 0) return <>{empty}</>;
  return (
    <>
      <div className="grid3">
        {items.map((it, i) => (
          <button key={it.postId} className="g3" onClick={() => setOpen(i)} aria-label={`${it.product.title}, ${R(it.product.priceCents)}`}>
            <ProductArt productId={it.product.id} fallback={it.video.demo?.bg ?? swatch(it.product.id)} />
            <span className="g3foot">{R(it.product.priceCents)}</span>
            {it.video.url && it.video.kind !== "image" && <TileLength url={it.video.url} />}
          </button>
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

/** "0:45" on a video tile, so people can see how long it is before they tap. */
function TileLength({ url }: { url: string }) {
  const len = useVideoLength(url);
  return len ? <span className="g3len"><Icon name="play" size={10} />{clock(len)}</span> : null;
}

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type Category, type FeedItem } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { RewardChip } from "../../components/Rewards";
import { ProductArt } from "../../components/Scene";
import { Blank, ErrorNote, Loading, R, swatch } from "../../components/ui";
import { useMyShopId } from "../../lib/mine";

const CATS: { id: Category | "all"; label: string }[] = [
  { id: "all", label: "All" }, { id: "clothes", label: "Thrift" }, { id: "designer", label: "Designer" },
  { id: "beauty", label: "Hair and beauty" }, { id: "food", label: "Bakes" },
];

export function Explore() {
  const [items, error] = useLoad(() => api.feed(), []);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const { user, following, toggleFollow, withUser } = useSession();
  const myShop = useMyShopId();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const filtered = useMemo(() => (items ?? []).filter((it) => {
    const text = `${it.product.title} ${it.shop.name} ${it.shop.handle} ${it.caption} ${it.product.description ?? ""} ${it.product.sizes.join(" ")}`.toLowerCase();
    // Every word has to match somewhere, so "black dress 34" finds the right thing.
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (cat === "all" || it.shop.category === cat) && words.every((w) => text.includes(w));
  }), [items, q, cat]);
  const shops = useMemo(() => {
    const seen = new Map<string, FeedItem["shop"]>();
    (items ?? []).forEach((it) => seen.set(it.shop.id, it.shop));
    return [...seen.values()];
  }, [items]);

  return (
    <div className="screen">
      <div className="row" style={{ gap: 10, marginTop: 6 }}>
        <label className="search">
          <Icon name="search" size={18} />
          <span className="visually-hidden">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sellers and items" type="search" enterKeyHint="search" autoFocus={params.get("search") === "1"} />
        </label>
        <RewardChip className="dark" />
      </div>
      <div className="chips scroll" style={{ margin: "14px -16px 4px" }} role="group" aria-label="Category">
        {CATS.map((c) => <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.label}</button>)}
      </div>
      <ErrorNote error={error} />
      {!items && !error && <Loading />}

      {items && !q && cat === "all" && shops.length > 0 && (
        <>
          <h2 className="section-title">Shops to follow</h2>
          <div className="shop-row">
            {shops.map((s) => (
              <div key={s.id} className="shop-card">
                <button className="avatar" style={{ border: 0 }} onClick={() => nav(`/s/${s.handle}`)} aria-label={`Open ${s.name}`}>{s.name[0]}</button>
                <b style={{ fontSize: 14 }}>{s.name}</b>
                <span className="small muted">Trust {s.trustScore}</span>
                {s.id === myShop ? <span className="small muted" style={{ minHeight: 34, display: "grid", placeItems: "center" }}>Your shop</span> : (
                  <button className="btn" style={{ minHeight: 34, padding: "0 14px", fontSize: 13, background: following.has(s.id) ? "var(--surface-2)" : "var(--ink)", color: following.has(s.id) ? "var(--ink)" : "var(--bg)" }}
                    onClick={() => withUser(() => toggleFollow(s.id), "Sign in to follow")}>{following.has(s.id) ? "Following" : "Follow"}</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {items && (
        <>
          <h2 className="section-title">{q ? `Results for “${q}”` : "Selling now"}</h2>
          {filtered.length === 0 && <Blank icon="search" title="No results" line={q ? `Nothing matches "${q}". Try another word, or browse a category above.` : "Nothing in this category yet. Try another one."} />}
          <div className="grid2">
            {filtered.map((it) => (
              <button key={it.postId} className="tile" onClick={() => nav(`/s/${it.shop.handle}?item=${it.product.id}`)} aria-label={`${it.product.title}, ${R(it.product.priceCents)}`}>
                <div className="media"><ProductArt productId={it.product.id} fallback={it.video.demo?.bg ?? swatch(it.product.id)} />
                  {it.product.mode === "order_now" && <span className="vchip vglass amber"><span className="d" />Made to order</span>}
                </div>
                <div className="body">
                  <div className="t">{it.product.title}</div>
                  <div className="p">{R(it.product.priceCents)}</div>
                  <div className="small muted" style={{ marginTop: 2 }}>@{it.shop.handle}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {items && !q && (
        <p className="small muted" style={{ margin: "22px 16px 0", textAlign: "center" }}>Trusted sellers also run timed auctions. Look for the Bid button.</p>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { TileTags, priceKind, shortCount, useAuctionPrices, useProductViews } from "../../components/PostGrid";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, PROVINCES, type Category, type FeedItem, type Province, type SearchFilters, type SearchSort } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { RewardChip } from "../../components/Rewards";
import { ProductArt } from "../../components/Scene";
import { Blank, ErrorNote, Field, Loading, R, Sheet, swatch } from "../../components/ui";
import { useMyShopId } from "../../lib/mine";
import { CATEGORY_EMOJI } from "../../lib/emoji";

const CATS: { id: Category | "all"; label: string }[] = [
  { id: "all", label: "All" }, { id: "clothes", label: "Thrift" }, { id: "designer", label: "Designer" },
  { id: "beauty", label: "Hair and beauty" }, { id: "food", label: "Bakes" },
];
const SORTS: { id: SearchSort; label: string }[] = [
  { id: "best", label: "Best match" }, { id: "new", label: "Newest" }, { id: "low", label: "Price: low to high" }, { id: "high", label: "Price: high to low" },
];
const PRICES: { label: string; min: number | null; max: number | null }[] = [
  { label: "Under R200", min: null, max: 20000 }, { label: "R200 to R500", min: 20000, max: 50000 },
  { label: "R500 to R1,000", min: 50000, max: 100000 }, { label: "Over R1,000", min: 100000, max: null },
];
type Filters = Omit<SearchFilters, "category">;
const EMPTY: Filters = { size: null, minCents: null, maxCents: null, province: null, sort: "best" };
const priceLabel = (f: Filters) => PRICES.find((p) => p.min === (f.minCents ?? null) && p.max === (f.maxCents ?? null))?.label
  ?? (f.minCents != null && f.maxCents != null ? `${R(f.minCents)} to ${R(f.maxCents)}` : f.minCents != null ? `From ${R(f.minCents)}` : f.maxCents != null ? `Up to ${R(f.maxCents)}` : null);

export function Explore() {
  const [items, error] = useLoad(() => api.feed(), []);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [f, setF] = useState<Filters>(EMPTY);
  const [editing, setEditing] = useState(false);
  const { following, toggleFollow, withUser } = useSession();
  const myShop = useMyShopId();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const filterCount = (f.size ? 1 : 0) + (f.minCents != null || f.maxCents != null ? 1 : 0) + (f.province ? 1 : 0) + (f.sort && f.sort !== "best" ? 1 : 0);
  const searching = q.trim() !== "" || cat !== "all" || filterCount > 0;

  // Searching asks the server, so it finds everything for sale, not only what's loaded. Waits for a pause in typing.
  const [results, setResults] = useState<FeedItem[] | null>(null);
  const [more, setMore] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const key = JSON.stringify([q.trim(), cat, f]);
  useEffect(() => {
    if (!searching) { setResults(null); return; }
    let live = true;
    const t = window.setTimeout(() => {
      api.search(q, { ...f, category: cat === "all" ? null : cat })
        .then((r) => { if (live) { setResults(r); setMore(r.length === 20); setSearchError(null); } })
        .catch((e) => live && setSearchError(e instanceof Error ? e.message : "Search didn't work. Try again."));
    }, q.trim() ? 300 : 0);
    return () => { live = false; window.clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMore = async () => {
    const r = await api.search(q, { ...f, category: cat === "all" ? null : cat }, results?.length ?? 0).catch(() => []);
    setResults((cur) => [...(cur ?? []), ...r]); setMore(r.length === 20);
  };

  const shops = useMemo(() => {
    const seen = new Map<string, FeedItem["shop"]>();
    (items ?? []).forEach((it) => seen.set(it.shop.id, it.shop));
    return [...seen.values()];
  }, [items]);
  const shown = searching ? results : items;
  const views = useProductViews((shown ?? []).map((it) => it.product.id));
  const bids = useAuctionPrices((shown ?? []).map((it) => it.product));
  const chips: { label: string; clear: () => void }[] = [
    ...(f.sort && f.sort !== "best" ? [{ label: SORTS.find((x) => x.id === f.sort)!.label, clear: () => setF({ ...f, sort: "best" }) }] : []),
    ...(f.size ? [{ label: `Size ${f.size}`, clear: () => setF({ ...f, size: null }) }] : []),
    ...(priceLabel(f) ? [{ label: priceLabel(f)!, clear: () => setF({ ...f, minCents: null, maxCents: null }) }] : []),
    ...(f.province ? [{ label: `From ${PROVINCES.find((p) => p.id === f.province)!.name}`, clear: () => setF({ ...f, province: null }) }] : []),
  ];

  return (
    <div className="screen">
      <div className="row" style={{ gap: 10, marginTop: 6 }}>
        <label className="search">
          <Icon name="search" size={18} />
          <span className="visually-hidden">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sellers and items" type="search" enterKeyHint="search" autoFocus={params.get("search") === "1"} />
        </label>
        <button className={`filter-btn ${filterCount ? "on" : ""}`} onClick={() => setEditing(true)} aria-label={filterCount ? `Filters, ${filterCount} on` : "Filters"}>
          <Icon name="sliders" size={20} />{filterCount > 0 && <span className="num">{filterCount}</span>}
        </button>
        <RewardChip className="dark" />
      </div>
      <div className="chips scroll" style={{ margin: "14px -16px 4px" }} role="group" aria-label="Category">
        {CATS.map((c) => <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.id !== "all" && <span className="emo" aria-hidden="true">{CATEGORY_EMOJI[c.id]}</span>}{c.label}</button>)}
      </div>
      {chips.length > 0 && (
        <div className="chips scroll applied" style={{ margin: "6px -16px 0" }} aria-label="Filters on">
          {chips.map((c) => <button key={c.label} className="chip on" onClick={c.clear} aria-label={`Remove ${c.label}`}>{c.label}<Icon name="close" size={13} /></button>)}
          <button className="chip plain" onClick={() => setF(EMPTY)}>Clear all</button>
        </div>
      )}
      <ErrorNote error={searching ? searchError : error} />
      {!shown && !(searching ? searchError : error) && <Loading />}

      {items && !searching && shops.length > 0 && (
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

      {shown && (
        <>
          <h2 className="section-title">{q.trim() ? `Results for “${q.trim()}”` : searching ? "Results" : "Selling now"}</h2>
          {shown.length === 0 && <Blank icon="search" title="No results"
            line={filterCount ? "Nothing matches these filters. Try removing one." : q ? `Nothing matches "${q}". Try another word, or browse a category above.` : "Nothing in this category yet. Try another one."}
            action={filterCount ? "Clear filters" : undefined} onAction={filterCount ? () => setF(EMPTY) : undefined} />}
          {/* TikTok style, full picture (14 Nov): price pill on top coloured by kind, title and shop in a pill, views bottom right. */}
          <div className="grid2">
            {shown.map((it) => {
              const kind = priceKind(it.product);
              return (
                <button key={it.postId} className={`tile tt ${kind === "sold" ? "sold" : ""}`} onClick={() => nav(`/s/${it.shop.handle}?item=${it.product.id}`)}
                  aria-label={`${it.product.title}, ${R(bids[it.product.id] ?? it.product.priceCents)}. @${it.shop.handle}${views[it.product.id] !== undefined ? `. ${views[it.product.id]} views` : ""}`}>
                  <div className="media"><ProductArt productId={it.product.id} video={it.video} fallback={it.video.demo?.bg ?? swatch(it.product.id)} />
                    <TileTags product={it.product} bidCents={bids[it.product.id]} />
                    <span className="tt-cap">
                      <span className="tt-text"><b>{it.product.title}</b><small>@{it.shop.handle}{it.product.sizes.length > 0 && ` · ${it.product.sizes.slice(0, 3).join(", ")}`}</small></span>
                      {views[it.product.id] !== undefined && <span className="tt-views"><Icon name="play" size={10} />{shortCount(views[it.product.id])}</span>}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          {searching && more && shown.length > 0 && <button className="btn block" style={{ marginTop: 16 }} onClick={loadMore}>Show more</button>}
        </>
      )}

      {items && !searching && (
        <p className="small muted" style={{ margin: "22px 16px 0", textAlign: "center" }}>Trusted sellers also run timed auctions. Look for the Bid button.</p>
      )}
      {editing && <FilterSheet value={f} onDone={(v) => { setF(v); setEditing(false); }} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Sort, size, price and where it ships from. Changes apply when you tap Show results. */
function FilterSheet({ value, onDone, onClose }: { value: Filters; onDone: (f: Filters) => void; onClose: () => void }) {
  const [f, setF] = useState<Filters>(value);
  const [sizes] = useLoad(() => api.searchSizes(), []);
  const [minText, setMinText] = useState(value.minCents != null ? String(value.minCents / 100) : "");
  const [maxText, setMaxText] = useState(value.maxCents != null ? String(value.maxCents / 100) : "");
  const rand = (t: string) => { const n = Math.round(Number(t.replace(/[^0-9]/g, ""))); return t.trim() && n >= 0 ? n * 100 : null; };
  const pickPrice = (min: number | null, max: number | null) => {
    const same = f.minCents === min && f.maxCents === max;
    setF({ ...f, minCents: same ? null : min, maxCents: same ? null : max });
    setMinText(same || min == null ? "" : String(min / 100)); setMaxText(same || max == null ? "" : String(max / 100));
  };
  return (
    <Sheet title="Filters" onClose={onClose} footer={
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={() => { setF(EMPTY); setMinText(""); setMaxText(""); }}>Clear</button>
        <button className="btn grow green" onClick={() => {
          let min = rand(minText), max = rand(maxText);
          if (min != null && max != null && min > max) [min, max] = [max, min];
          onDone({ ...f, minCents: min, maxCents: max });
        }}>Show results</button>
      </div>
    }>
      <div className="filter-group">
        <h3>Sort by</h3>
        <div className="chips wrap" role="radiogroup" aria-label="Sort by">
          {SORTS.map((x) => <button key={x.id} role="radio" aria-checked={(f.sort ?? "best") === x.id} className="chip" aria-pressed={(f.sort ?? "best") === x.id} onClick={() => setF({ ...f, sort: x.id })}>{x.label}</button>)}
        </div>
      </div>
      <div className="filter-group">
        <h3>Size</h3>
        {!sizes ? <Loading /> : sizes.length === 0 ? <p className="small muted">No sizes listed right now.</p> : (
          <div className="chips wrap" role="group" aria-label="Size">
            {sizes.map((z) => <button key={z} className="chip" aria-pressed={f.size === z} onClick={() => setF({ ...f, size: f.size === z ? null : z })}>{z}</button>)}
          </div>
        )}
      </div>
      <div className="filter-group">
        <h3>Price</h3>
        <div className="chips wrap" role="group" aria-label="Price">
          {PRICES.map((p) => <button key={p.label} className="chip" aria-pressed={f.minCents === p.min && f.maxCents === p.max} onClick={() => pickPrice(p.min, p.max)}>{p.label}</button>)}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 10 }}>
          <Field label="Lowest (R)"><input value={minText} onChange={(e) => setMinText(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} inputMode="numeric" placeholder="Any" /></Field>
          <Field label="Highest (R)"><input value={maxText} onChange={(e) => setMaxText(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} inputMode="numeric" placeholder="Any" /></Field>
        </div>
      </div>
      <div className="filter-group">
        <h3>Ships from</h3>
        <div className="chips wrap" role="group" aria-label="Ships from">
          {PROVINCES.map((p) => <button key={p.id} className="chip" aria-pressed={f.province === p.id} onClick={() => setF({ ...f, province: f.province === p.id ? null : p.id as Province })}>{p.name}</button>)}
        </div>
      </div>
    </Sheet>
  );
}

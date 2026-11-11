// Seller stats: how many people saw your posts, what they did, and what sold, for the last 7, 30 or 90 days.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type SellerStats } from "../../api";
import { useLoad } from "../../session";
import { BackButton, ErrorNote, Loading, R, Segmented } from "../../components/ui";
import { ProductArt } from "../../components/Scene";

const PERIODS = [{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }] as const;
const short = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

export function SellerStatsScreen() {
  const [days, setDays] = useState<"7" | "30" | "90">("7");
  const [st, error] = useLoad(() => api.sellerStats(Number(days) as 7 | 30 | 90), [days]);
  const nav = useNavigate();
  return (
    <div className="screen">
      <BackButton to="/me" label="Shop" />
      <h1>Stats</h1>
      <Segmented value={days} onChange={(v) => setDays(v as typeof days)} options={PERIODS.map((p) => ({ value: p.id, label: p.label }))} label="Period" />
      <ErrorNote error={error} />
      {!st && !error && <Loading />}
      {st && (
        <>
          <div className="stat-tiles">
            <Tile label="Sales" value={R(st.salesCents)} sub={`${st.orders} ${st.orders === 1 ? "order" : "orders"}`} />
            <Tile label="Views" value={st.views.toLocaleString("en-ZA")} sub={`${st.viewers.toLocaleString("en-ZA")} ${st.viewers === 1 ? "person" : "people"}`} />
            <Tile label="Buyers" value={String(st.buyers)} sub={st.viewers ? `${Math.round((st.buyers / st.viewers) * 1000) / 10}% of people who saw` : "No views yet"} />
            <Tile label="Followers" value={String(st.followers)} sub={st.newFollowers ? `${st.newFollowers} new` : "No new ones"} />
          </div>

          <Bars title="Views" series={st.series.map((d) => ({ day: d.day, v: d.views }))} fmt={(v) => `${v} ${v === 1 ? "view" : "views"}`} />
          <Bars title="Sales" series={st.series.map((d) => ({ day: d.day, v: d.salesCents }))} fmt={(v) => R(v)} />

          <div className="group" style={{ marginTop: 18 }}>
            <Row t="Likes" v={st.likes} />
            <Row t="Reposts" v={st.reposts} />
            <Row t="Returns asked for" v={st.returns} />
            <Row t="Live shows" v={st.liveShows} />
          </div>

          <h3 className="section-title">Top items</h3>
          {st.top.length === 0 ? <p className="small muted">Nothing seen or sold in this time yet. Post a video or go live to get noticed.</p> : (
            <div className="group">
              {st.top.map((t) => (
                <button key={t.productId} className="cell" onClick={() => nav(`/me`)}>
                  <span className="stat-thumb"><ProductArt productId={t.productId} fallback="#888" /></span>
                  <span className="grow"><span className="t" style={{ display: "block" }}>{t.title}</span>
                    <span className="s" style={{ display: "block" }}>{t.views} {t.views === 1 ? "view" : "views"} · {t.orders} sold</span></span>
                  <b className="num">{R(t.salesCents)}</b>
                </button>
              ))}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 14 }}>A view counts once a day for each signed in person who watches your post for 2 seconds. Your own views don't count. Sales are item prices, before fees and delivery.</p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="stat-tile"><span className="small muted">{label}</span><b className="num">{value}</b><span className="small muted">{sub}</span></div>;
}
function Row({ t, v }: { t: string; v: number }) {
  return <div className="cell"><span className="grow t">{t}</span><b className="num">{v}</b></div>;
}

/** One measure per chart: thin bars from the baseline, tap a bar to see its day and value. */
function Bars({ title, series, fmt }: { title: string; series: { day: string; v: number }[]; fmt: (v: number) => string }) {
  const [pick, setPick] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((d) => d.v));
  const total = series.reduce((n, d) => n + d.v, 0);
  const shown = pick != null ? series[pick] : null;
  return (
    <section className="stat-chart" aria-label={`${title} by day`}>
      <div className="row between">
        <h3>{title}</h3>
        <span className="small muted">{shown ? `${short(shown.day)}: ${fmt(shown.v)}` : `Total ${fmt(total)}`}</span>
      </div>
      <div className="stat-bars" style={{ gap: series.length > 40 ? 1 : 2 }} onMouseLeave={() => setPick(null)}>
        {series.map((d, i) => (
          <button key={d.day} className={pick === i ? "on" : ""} aria-label={`${short(d.day)}, ${fmt(d.v)}`}
            onClick={() => setPick(pick === i ? null : i)} onMouseEnter={() => setPick(i)}>
            <i style={{ height: d.v ? `${Math.max(3, (d.v / max) * 100)}%` : 0 }} />
          </button>
        ))}
      </div>
      <div className="row between small muted"><span>{short(series[0]?.day ?? "")}</span><span>{short(series[series.length - 1]?.day ?? "")}</span></div>
      <table className="visually-hidden"><caption>{title} by day</caption><tbody>{series.map((d) => <tr key={d.day}><td>{d.day}</td><td>{fmt(d.v)}</td></tr>)}</tbody></table>
    </section>
  );
}

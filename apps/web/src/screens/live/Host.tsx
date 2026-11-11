// The seller's side of a live show: camera, Go live, pin an item, run a quick auction, read and tidy the chat, end.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { bidStep, LIVE_AUCTION_SECONDS } from "@app/core";
import { api, type LiveSummary, type MyShop } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { Blank, ErrorNote, Loading, R, Sheet } from "../../components/ui";
import { useAuctions, useNow } from "../../components/Auction";
import { ProductArt } from "../../components/Scene";
import { useLiveRoom } from "./useLiveRoom";
import { LiveAuctionCard, LiveBadge, LiveChat, PinnedCard } from "./parts";
import { showTime, useShow } from "./Watch";

type Item = MyShop["products"][number];

export function HostLive() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { toast } = useSession();
  const { show, chat, reload } = useShow(id);
  const [shop, , reloadShop] = useLoad(() => api.myShop(), []);
  const open = show?.status === "live" || show?.status === "scheduled";
  const room = useLiveRoom(id, "host", !!show?.mine && open);
  const auctionId = show?.auction?.product.id;
  const [auctions] = useAuctions(auctionId ? [auctionId] : [], 1000);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"pin" | "auction" | "end" | null>(null);
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const live = show?.status === "live";
  const viewers = room.state === "on" ? room.viewers : show?.peakViewers ?? 0;

  // Tell the server how many are watching, so the end of show summary has the peak.
  useEffect(() => {
    if (!live || room.state !== "on") return;
    const t = window.setInterval(() => api.reportLiveViewers(id, room.viewers).catch(() => {}), 15000);
    return () => window.clearInterval(t);
  }, [live, room.state, room.viewers, id]);

  if (show === undefined) return <div className="live-screen"><div className="live-center"><Loading /></div></div>;
  if (!show || !show.mine) return (
    <div className="live-screen"><div className="live-center"><Blank onVideo icon="live" title="That isn't your show" line="Only the shop that made a show can host it." action="Go back" onAction={() => nav("/")} /></div></div>
  );

  const items = (shop?.products ?? []).filter((p) => p.status === "live" && p.mode === "buy_now" && p.stock > 0);
  const info = auctionId ? auctions[auctionId] : undefined;
  const auctionOpen = info?.state === "open" && !!info.endsAt && new Date(info.endsAt).getTime() > now;
  const run = async (what: () => Promise<unknown>, done?: string) => {
    setBusy(true); setError(null);
    try { await what(); if (done) toast(done); await reload(); reloadShop(); }
    catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Try again."); }
    finally { setBusy(false); }
  };

  if (summary) return (
    <div className="live-screen live-wait">
      <div className="live-center">
        <div className="live-summary">
          <Icon name="check" size={40} strokeWidth={2} />
          <h1>{summary.cancelled ? "Show cancelled" : "That's a wrap"}</h1>
          {!summary.cancelled && (
            <div className="group">
              <div className="cell"><span>Time live</span><b>{summary.minutes} min</b></div>
              <div className="cell"><span>Most watching at once</span><b>{summary.peakViewers}</b></div>
              <div className="cell"><span>Orders</span><b>{summary.orders}</b></div>
              <div className="cell"><span>Sales</span><b className="num">{R(summary.salesCents)}</b></div>
              <div className="cell"><span>Auctions sold</span><b>{summary.auctionsWon} of {summary.auctions}</b></div>
            </div>
          )}
          <button className="btn green block big" onClick={() => nav("/me?tab=selling")}>Done</button>
        </div>
      </div>
    </div>
  );

  if (!open) return (
    <div className="live-screen"><div className="live-center"><Blank onVideo icon="live" title="This show has ended" line="Start a new one from the + button." action="Done" onAction={() => nav("/me")} /></div></div>
  );

  return (
    <div className="live-screen host">
      <div className="live-video">
        {(room.state === "on" || room.state === "demo") && <video ref={room.videoRef} autoPlay playsInline muted className={room.front ? "mirror" : ""} />}
        {room.state === "connecting" && <div className="live-center"><Loading /></div>}
        {room.state === "error" && (
          <div className="live-center"><Blank onVideo icon="camera" title="Camera isn't ready" line={room.error ?? "Try again."} action="Try again" onAction={room.retry} /></div>
        )}
      </div>
      <div className="live-shade" aria-hidden="true" />

      <div className="live-top">
        {live ? <LiveBadge viewers={viewers} startedAt={show.startedAt} /> : <span className="live-pill off">Not live yet</span>}
        <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
          <button className="vround vglass" onClick={room.flip} aria-label="Flip camera"><Icon name="flip" /></button>
          {room.state === "on" && <button className="vround vglass" onClick={room.toggleMute} aria-pressed={room.muted} aria-label={room.muted ? "Turn sound on" : "Mute"}><Icon name={room.muted ? "mute" : "sound"} /></button>}
          <button className="live-end" onClick={() => setSheet("end")}>{live ? "End" : "Cancel"}</button>
        </div>
      </div>
      {room.state === "demo" && <span className="live-demo-tag vglass">Demo: nothing is sent</span>}

      {!live ? (
        <div className="live-bottom start">
          <div className="live-ready">
            <b>{show.title}</b>
            <span>{new Date(show.startsAt).getTime() > Date.now() + 60e3 ? `Planned for ${showTime(show.startsAt)}. You can start early.` : "Your followers get a notice when you go live."}</span>
          </div>
          <ErrorNote error={error} />
          <button className="btn go-live block" disabled={busy || (room.state !== "on" && room.state !== "demo")}
            onClick={() => run(() => api.goLive(id), "You're live")}>
            <span className="dot-live" />Go live
          </button>
        </div>
      ) : (
        <div className="live-bottom">
          <LiveChat showId={show.id} messages={chat} onSent={reload} canHide />
          {show.auction && info && (auctionOpen || (info.endsAt && now - new Date(info.endsAt).getTime() < 20_000)) ? (
            <LiveAuctionCard item={show.auction} artId={show.pinned?.product.id} info={info} now={now} host />
          ) : show.pinned ? (
            <PinnedCard item={show.pinned} action={<button className="btn vglass" onClick={() => run(() => api.pinLiveItem(id, null), "Item taken down")}>Unpin</button>} />
          ) : null}
          <ErrorNote error={error} />
          <div className="live-tools">
            <button className="btn vglass" onClick={() => setSheet("pin")}><Icon name="pin" size={18} />Pin item</button>
            <button className="btn vglass" onClick={() => setSheet("auction")} disabled={auctionOpen}><Icon name="clock" size={18} />Auction</button>
          </div>
        </div>
      )}

      {sheet === "pin" && (
        <Sheet title="Pin an item" onClose={() => setSheet(null)}>
          {items.length === 0 ? <Blank icon="bag" title="No items with stock" line="Live Buy now items with stock show here." /> : (
            <div className="group">
              {items.map((p) => (
                <button key={p.id} className="cell live-pick" onClick={() => { setSheet(null); run(() => api.pinLiveItem(id, p.id), "Pinned"); }}>
                  <span className="live-pick-art"><ProductArt productId={p.id} fallback="#555" /></span>
                  <span className="grow"><b>{p.title}</b><span className="small muted">{R(p.priceCents)} · {p.stock} left</span></span>
                  {show.pinned?.product.id === p.id && <Icon name="check" size={18} />}
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
      {sheet === "auction" && (
        <StartAuction items={items} pinnedId={show.pinned?.product.id ?? null} onClose={() => setSheet(null)}
          onStart={(productId, cents, secs, sudden) => { setSheet(null); run(() => api.startLiveAuction(id, productId, cents, secs, sudden), "Auction started"); }} />
      )}
      {sheet === "end" && (
        <Sheet title={live ? "End the show?" : "Cancel this show?"} onClose={() => setSheet(null)}
          footer={<button className="btn danger block big" disabled={busy} onClick={async () => {
            setBusy(true);
            try { const s = await api.endShow(id); room.stop(); setSheet(null); setSummary(s); }
            catch (e) { setError(e instanceof Error ? e.message : "Couldn't end the show."); setSheet(null); }
            finally { setBusy(false); }
          }}>{live ? "End show" : "Cancel show"}</button>}>
          <p className="muted">{live ? (auctionOpen ? "An auction is still running. It finishes on its own, and the winner can still pay." : "Everyone watching sees that the show has ended.") : "People who asked for a reminder won't be told."}</p>
        </Sheet>
      )}
    </div>
  );
}

/** Pick an item, a starting bid, how long, and whether the clock can reset. */
function StartAuction({ items, pinnedId, onClose, onStart }: {
  items: Item[]; pinnedId: string | null; onClose: () => void; onStart: (productId: string, cents: number, seconds: number, sudden: boolean) => void;
}) {
  const [pick, setPick] = useState<string | null>(pinnedId && items.some((p) => p.id === pinnedId) ? pinnedId : items[0]?.id ?? null);
  const item = items.find((p) => p.id === pick);
  const suggested = item ? Math.max(2000, Math.round(item.priceCents / 2 / 1000) * 1000) : 2000;
  const [start, setStart] = useState<number | null>(null);
  const cents = start ?? suggested;
  const [secs, setSecs] = useState<number>(30);
  const [sudden, setSudden] = useState(false);
  const designer = item?.label === "authentic_designer";
  return (
    <Sheet title="Start an auction" onClose={onClose}
      footer={<button className="btn amber block big" disabled={!item || designer} onClick={() => item && onStart(item.id, cents, secs, sudden)}>Start {secs} second auction</button>}>
      {items.length === 0 ? <Blank icon="bag" title="No items with stock" line="Auctions sell one unit of a live Buy now item." /> : (
        <>
          <div className="field"><label>Item</label></div>
          <div className="live-pick-row" role="radiogroup" aria-label="Item">
            {items.map((p) => (
              <button key={p.id} role="radio" aria-checked={p.id === pick} className={`live-pick-chip ${p.id === pick ? "on" : ""}`} onClick={() => { setPick(p.id); setStart(null); }}>
                <span className="live-pick-art"><ProductArt productId={p.id} fallback="#555" /></span><span>{p.title}</span>
              </button>
            ))}
          </div>
          {designer && <div className="note amber">Designer items can't be auctioned live yet. Sell them with Buy now.</div>}
          <div className="field"><label>Starting bid</label></div>
          <div className="bid-stepper">
            <button className="step-btn" onClick={() => setStart(Math.max(2000, cents - bidStep(cents - 1)))} disabled={cents <= 2000} aria-label="Lower"><Icon name="minus" size={22} strokeWidth={2.4} /></button>
            <div className="step-amt"><span className="amt">{R(cents)}</span><div className="small muted">{item ? `Listed at ${R(item.priceCents)}` : ""}</div></div>
            <button className="step-btn up" onClick={() => setStart(cents + bidStep(cents))} aria-label="Raise"><Icon name="plus" size={22} strokeWidth={2.4} /></button>
          </div>
          <div className="field"><label>How long</label></div>
          <div className="quick-bids" role="radiogroup" aria-label="How long">
            {LIVE_AUCTION_SECONDS.map((s) => <button key={s} role="radio" aria-checked={secs === s} aria-pressed={secs === s} onClick={() => setSecs(s)}>{s} seconds</button>)}
          </div>
          <div className="max-card">
            <div><div className="t">Sudden death</div>
              <div className="small muted">{sudden ? "The clock never resets. The top bid when it hits zero wins." : "Off: a bid in the last 10 seconds resets the clock to 10."}</div></div>
            <button className="switch" role="switch" aria-checked={sudden} aria-label="Sudden death" onClick={() => setSudden(!sudden)} />
          </div>
          <p className="small muted">One unit comes off this listing's stock. If nobody wins, or the winner doesn't pay within 2 hours, it goes back.</p>
        </>
      )}
    </Sheet>
  );
}

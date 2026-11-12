import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showTime } from "../live/Watch";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FEATURES } from "../../features";
import { goLiveBlockers, liveStock, MIN_LIVE_STOCK } from "@app/core";
import { api } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { ErrorNote, Loading, useGoBack } from "../../components/ui";
import { CreateListing } from "./Create";
import { EditVideo } from "./EditVideo";
import type { EditDraft } from "../../api";
import { useTabSwipe } from "../../components/gestures";

type Mode = "camera" | "create" | "live";

/**
 * The + tab, like TikTok: Camera, Create and Live, switched at the bottom.
 * Camera takes a photo (tap) or video (hold) and hands it to Create, which is the listing form.
 */
export function Post() {
  const [params, setParams] = useSearchParams();
  // Live shows once it's released to everyone, or early for an account our team switched it on for.
  const [features] = useLoad(() => api.myFeatures(), []);
  // Wait for this account's switches, so a Live tab that is switched off never flashes up.
  const liveOn = !!features && (features.live === "on" || (FEATURES.live && features.live !== "off"));
  const MODES = (liveOn ? ["camera", "create", "live"] : ["camera", "create"]) as Mode[];
  const mode: Mode = MODES.find((m) => m === params.get("mode")) ?? "camera";
  const setMode = (m: Mode) => { setSub(false); setParams(m === "camera" ? {} : { mode: m }, { replace: true }); };
  // Cover first (a video or a photo), then extra photos. Only the cover can be a video.
  const [media, setMedia] = useState<File[]>([]);
  const [fromCamera, setFromCamera] = useState(false);
  const addShot = (f: File) => setMedia((cur) => {
    if (f.type.startsWith("video/")) return [f, ...cur.filter((x) => !x.type.startsWith("video/"))];
    return [...cur, f].slice(0, 10);
  });
  // On a later page (a camera review or a later Create step) the Camera, Create, Live switch hides.
  const [sub, setSub] = useState(false);
  // The video editor: what it's editing, and the finished edit. A new cover video drops an old edit.
  const [editing, setEditing] = useState<{ files: File[]; inApp: boolean[] } | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const shotInApp = useRef(new WeakSet<File>());
  useEffect(() => { if (edit && media[0] !== edit.files[0]) setEdit(null); }, [media, edit]);
  const editCover = () => {
    if (edit && media[0] === edit.files[0]) return setEditing({ files: edit.files, inApp: edit.list.clips.map((c) => c.inApp) });
    if (media[0]) setEditing({ files: [media[0]], inApp: [shotInApp.current.has(media[0])] });
  };
  const [shop] = useLoad(() => api.myShop(), []);
  const nav = useNavigate();
  const close = useGoBack("/");
  const dark = mode !== "create";
  const swipeModes = useTabSwipe(MODES, mode, setMode); // swipe between Camera, Create and Live

  if (shop === undefined) return <div className="post dark"><div className="cam"><div className="cam-msg"><Loading /></div></div></div>;
  // Only sellers can post. Without an open shop, ask first; "No" leaves you where you were.
  if (!shop || shop.status !== "open") return <div className="post dark"><SellerGate open onClose={close} /></div>;

  return (
    <div className={`post ${dark ? "dark" : ""}`} {...(sub || mode === "create" ? {} : swipeModes)}>
      {editing && (
        <EditVideo files={editing.files} inApp={editing.inApp} shop={shop} itemTitle="" initial={edit && editing.files === edit.files ? edit.list : null}
          onCancel={() => setEditing(null)}
          onDone={(d) => { setEditing(null); setMedia((cur) => [d.files[0], ...cur.filter((x) => !x.type.startsWith("video/"))]); setEdit(d); setFromCamera(true); setMode("create"); }} />
      )}
      {mode === "camera" && !editing && <Camera onReview={setSub}
        onDone={(f, inApp) => { if (inApp) shotInApp.current.add(f); addShot(f); setFromCamera(true); setMode("create"); }}
        onEdit={(f, inApp) => { if (inApp) shotInApp.current.add(f); setEditing({ files: [f], inApp: [inApp] }); }} />}
      {mode === "create" && (
        <CreateListing shop={shop} media={media} onMedia={setMedia} startAtDetails={fromCamera} edit={edit} onEdit={editCover}
          onCamera={() => { setFromCamera(false); setMode("camera"); }} onStep={(n) => { setSub(n > 0); if (n === 0) setFromCamera(false); }} />
      )}
      {mode === "live" && <GoLive onCreate={() => setMode("create")} />}

      {!sub && !editing && (
        <>
          <button className={`post-close ${dark ? "vglass" : "glass"}`} onClick={close} aria-label="Close"><Icon name="close" size={20} /></button>
          <div className={`post-modes ${dark ? "vglass" : "glass"}`} role="tablist" aria-label="Post">
            {MODES.map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
                {m === "live" && <span className="dot-live" />}{m === "camera" ? "Camera" : m === "create" ? "Create" : "Live"}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** "Only sellers can post." Yes opens the shop sign up; No closes and changes nothing. */
export function SellerGate({ open, onClose, onYes, unfinished }: { open: boolean; onClose: () => void; onYes?: () => void; unfinished?: boolean }) {
  const nav = useNavigate();
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet glass" role="dialog" aria-modal="true" aria-label="Open a shop?" style={{ color: "var(--ink)" }}>
        <div className="grabber" />
        <div className="gate">
          <span className="pprompt-ic"><Icon name="store" size={22} /></span>
          <h2>{unfinished ? "Finish opening your shop?" : "Open a shop?"}</h2>
          <p>Only sellers can post items or go live. Opening a shop takes a few minutes, and the first 50 shops pay 0% for 3 months.</p>
        </div>
        <div className="sheet-foot stack" style={{ gap: 8 }}>
          <button className="btn green block big" onClick={() => { onYes?.(); nav("/sell/start"); }}>Yes, open my shop</button>
          <button className="btn block" onClick={onClose}>No, not now</button>
        </div>
      </div>
    </div>
  );
}

const LIMITS = [15, 60, 180] as const;
const HOLD_MS = 250;

/**
 * Draws a camera frame upright at 9:16, cropped to fill like the preview. Phones (iPhones especially) hand the browser
 * landscape frames even when you hold the phone upright, so photos and videos are made from this, never the raw camera.
 */
function drawPortrait(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, w: number, h: number, mirror: boolean, zoom = 1) {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return;
  const k = Math.max(w / vw, h / vh) * zoom; // cover, like object-fit: cover on the preview, then the digital zoom
  const dw = vw * k, dh = vh * k;
  ctx.save();
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); } // match the mirrored selfie preview
  ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** Phone style camera: gallery on the left, shutter in the middle, flip on the right. Tap for a photo, hold to record. */
function Camera({ onDone, onEdit, onReview }: { onDone: (file: File, inApp: boolean) => void; onEdit: (file: File, inApp: boolean) => void; onReview: (on: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const holdTimer = useRef<number>();
  const startedAt = useRef(0);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>(60);
  const [state, setState] = useState<"starting" | "ready" | "recording" | "unavailable">("starting");
  const [why, setWhy] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [shot, setShot] = useState<File | null>(null);
  const fromGallery = useRef(false);
  // Zoom: the camera's own zoom where the phone allows it (sharper), otherwise digital (crops into the picture).
  // What you see is what's recorded, and you can zoom while recording.
  const [zoom, setZoomState] = useState(1);
  const zoomRef = useRef(1);
  const nativeZoom = useRef<{ min: number; max: number } | null>(null);
  const maxZoom = nativeZoom.current ? Math.min(8, nativeZoom.current.max) : 5;
  const setZoom = (z: number) => {
    const next = Math.round(Math.min(maxZoom, Math.max(1, z)) * 10) / 10;
    zoomRef.current = next;
    setZoomState(next);
    const track = streamRef.current?.getVideoTracks()[0];
    if (nativeZoom.current && track) track.applyConstraints({ advanced: [{ zoom: Math.max(nativeZoom.current.min, next) } as MediaTrackConstraintSet] }).catch(() => {});
  };
  const digital = nativeZoom.current ? 1 : zoom; // how much the picture itself is scaled
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onFeedDown = (e: React.PointerEvent) => { pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
  const onFeedMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (!pinch.current) pinch.current = { d0: d || 1, z0: zoomRef.current };
    setZoom(pinch.current.z0 * (d / pinch.current.d0));
  };
  const onFeedUp = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; };

  // Start (or restart after a flip) the camera.
  useEffect(() => {
    let cancelled = false;
    const stop = () => streamRef.current?.getTracks().forEach((t) => t.stop());
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setWhy("This browser can't open the camera."); return setState("unavailable"); }
      try {
        let stream: MediaStream;
        try {
          // Ask for the most the camera has; drawPortrait crops it upright to 9:16 either way.
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: true });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } }); // no microphone: video without sound
        }
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        stop();
        streamRef.current = stream;
        const caps = (stream.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number } };
        nativeZoom.current = caps.zoom && caps.zoom.max > 1 ? { min: caps.zoom.min, max: caps.zoom.max } : null;
        zoomRef.current = 1; setZoomState(1);
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        setState("ready");
      } catch (e: any) {
        setWhy(e?.name === "NotAllowedError" ? "Camera access is off. Allow it in your browser settings, or pick from your gallery." : "The camera isn't available here. Pick a photo or video from your gallery.");
        setState("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [facing]);
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  // After Retake the preview is a new video element: plug the running camera back into it.
  useEffect(() => {
    const v = videoRef.current;
    if (!shot && v && streamRef.current && v.srcObject !== streamRef.current) { v.srcObject = streamRef.current; v.play().catch(() => {}); }
  }, [shot]);

  // Recording clock, and stop at the limit.
  useEffect(() => {
    if (state !== "recording") return;
    const t = window.setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setElapsed(s);
      if (s >= limit) recRef.current?.stop();
    }, 100);
    return () => window.clearInterval(t);
  }, [state, limit]);

  const takePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    // Upright 9:16, as sharp as the camera allows (up to 1080 by 1920).
    const short = Math.min(1080, Math.min(v.videoWidth, v.videoHeight));
    c.width = short; c.height = Math.round(short * 16 / 9);
    drawPortrait(c.getContext("2d")!, v, c.width, c.height, facing === "user", nativeZoom.current ? 1 : zoomRef.current);
    c.toBlob((b) => b && setShot(new File([b], `photo-${Date.now()}.jpg`, { type: "image/jpeg" })), "image/jpeg", 0.9);
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") return takePhoto();
    const type = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
    // Record what the preview shows: frames drawn upright at 9:16 onto a canvas, plus the microphone.
    const v = videoRef.current;
    let recordStream = stream;
    let stopDrawing = () => {};
    const canvas = document.createElement("canvas");
    if (v && v.videoWidth && typeof canvas.captureStream === "function") {
      const short = Math.min(720, Math.min(v.videoWidth, v.videoHeight));
      canvas.width = short; canvas.height = Math.round(short * 16 / 9);
      const ctx = canvas.getContext("2d")!;
      let raf = 0;
      const draw = () => { drawPortrait(ctx, v, canvas.width, canvas.height, facing === "user", nativeZoom.current ? 1 : zoomRef.current); raf = requestAnimationFrame(draw); };
      draw();
      stopDrawing = () => cancelAnimationFrame(raf);
      recordStream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...stream.getAudioTracks()]);
    }
    const rec = new MediaRecorder(recordStream, type ? { mimeType: type, videoBitsPerSecond: 4_000_000 } : { videoBitsPerSecond: 4_000_000 });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stopDrawing();
      if (recordStream !== stream) recordStream.getVideoTracks().forEach((t) => t.stop());
      setState("ready");
      setElapsed(0);
      const mime = rec.mimeType || type || "video/webm";
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      if (chunks.length) setShot(new File(chunks, `video-${Date.now()}.${ext}`, { type: mime.split(";")[0] }));
    };
    recRef.current = rec;
    startedAt.current = Date.now();
    rec.start(250);
    setState("recording");
  };

  const onDown = (e: React.PointerEvent) => {
    if (state !== "ready") return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    holdTimer.current = window.setTimeout(() => { holdTimer.current = undefined; startRecording(); }, HOLD_MS);
  };
  const onUp = () => {
    if (holdTimer.current) { window.clearTimeout(holdTimer.current); holdTimer.current = undefined; takePhoto(); return; }
    if (recRef.current && recRef.current.state === "recording") recRef.current.stop();
  };

  const pick = (f: File | undefined) => { if (f) { fromGallery.current = true; setShot(f); } };
  useEffect(() => onReview(!!shot), [shot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (shot) return <Review file={shot} onRetake={() => { fromGallery.current = false; setShot(null); }}
    onUse={() => onDone(shot, !fromGallery.current)} onEdit={() => onEdit(shot, !fromGallery.current)} />;

  const pct = Math.min(1, elapsed / limit);
  return (
    <div className="cam">
      <video ref={videoRef} className={`cam-feed ${facing === "user" ? "mirror" : ""}`} muted playsInline autoPlay
        style={digital > 1 ? { transform: `scale(${digital})${facing === "user" ? " scaleX(-1)" : ""}` } : undefined} />
      <div className="cam-pinch" onPointerDown={onFeedDown} onPointerMove={onFeedMove} onPointerUp={onFeedUp} onPointerCancel={onFeedUp} aria-hidden="true" />
      {state === "starting" && <div className="cam-msg">Opening camera…</div>}
      {state === "unavailable" && (
        <div className="cam-msg">
          <Icon name="lock" size={26} />
          <span>{why}</span>
          <label className="btn vglass">Choose from gallery<input type="file" accept="image/*,video/*" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
        </div>
      )}
      {state === "recording" && <div className="cam-timer"><span className="dot-live" />{Math.floor(elapsed)}s of {limit}s</div>}

      <div className="cam-bottom">
        {(state === "ready" || state === "recording") && (
          <div className="cam-zoom" role="group" aria-label="Zoom">
            {[1, 2, 3].filter((z) => z <= maxZoom).map((z) => {
              // The button for the range you're in lights up and shows the exact zoom while pinching (1.6×).
              const on = z === Math.min(3, Math.max(1, Math.floor(zoom + 0.05)));
              return (
                <button key={z} aria-pressed={on} onClick={() => setZoom(z)} aria-label={`Zoom ${z} times`}>
                  {on && Math.abs(zoom - z) >= 0.05 ? `${zoom.toFixed(1)}×` : `${z}×`}
                </button>
              );
            })}
          </div>
        )}
        {state !== "recording" && (
          <div className="cam-limits" role="group" aria-label="Video length limit">
            {LIMITS.map((l) => (
              <button key={l} aria-pressed={limit === l} onClick={() => setLimit(l)}>{l < 60 ? `${l}s` : `${l / 60}m`}</button>
            ))}
          </div>
        )}
        <div className="cam-controls">
          <label className="cam-side" aria-label="Gallery">
            <Icon name="grid" size={24} />
            <input type="file" accept="image/*,video/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <button className={`shutter ${state === "recording" ? "rec" : ""}`} disabled={state !== "ready" && state !== "recording"}
            onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => e.preventDefault()}
            aria-label="Tap for a photo, hold to record a video"
            style={{ background: state === "recording" ? `conic-gradient(#ff3b30 ${pct * 360}deg, rgba(255,255,255,0.35) 0)` : undefined }}>
            <span />
          </button>
          <button className="cam-side" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} disabled={state === "recording"} aria-label="Flip camera">
            <Icon name="flip" size={24} />
          </button>
        </div>
        <div className="cam-hint">Tap for a photo, hold for a video</div>
      </div>
    </div>
  );
}

function Review({ file, onRetake, onUse, onEdit }: { file: File; onRetake: () => void; onUse: () => void; onEdit: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="cam">
      {file.type.startsWith("image/") ? <img className="cam-feed" src={url} alt="Your photo" /> : <video className="cam-feed" src={url} autoPlay loop playsInline controls={false} />}
      <div className="cam-bottom">
        <div className="row" style={{ gap: 10, justifyContent: "center", marginBottom: 4 }}>
          <button className="btn vglass" onClick={onRetake}><Icon name="back" size={18} />Retake</button>
          {file.type.startsWith("video/") && <button className="btn vglass" onClick={onEdit}><Icon name="cut" size={18} />Edit</button>}
          <button className="btn green" onClick={onUse}>Next<Icon name="chevron" size={18} /></button>
        </div>
      </div>
    </div>
  );
}

/** Live: checks the shop can go live (stock first), then start now or plan a show. Planned shows are listed to start or cancel. */
function GoLive({ onCreate }: { onCreate: () => void }) {
  const [shop] = useLoad(() => api.myShop(), []);
  const [features] = useLoad(() => api.myFeatures(), []);
  const [shows, , reloadShows] = useLoad(() => api.liveShows(), []);
  const { toast } = useSession();
  const [tried, setTried] = useState(false);
  const [title, setTitle] = useState("");
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState(() => { const d = new Date(Date.now() + 86400e3); d.setHours(18, 0, 0, 0); return toLocalInput(d); });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const stock = shop ? liveStock(shop.products) : 0;
  const blockers = useCallback(() => {
    if (!shop || shop.status !== "open") return ["Open your shop first. Then list at least 5 items to go live."];
    const state = { verified: shop.checks.idStatus === "approved" && shop.checks.bankStatus === "approved", goodOrders: shop.goodOrders,
      trustScore: shop.trustScore, category: shop.category, foodCertApproved: shop.checks.certStatus === "approved", overrides: features };
    return goLiveBlockers(state, stock);
  }, [shop, stock, features]);
  if (shop === undefined) return <div className="cam"><div className="cam-msg"><Loading /></div></div>;
  const list = blockers();
  const mine = (shows ?? []).filter((x) => x.mine);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const sid = await api.createShow(title, later ? new Date(when).toISOString() : null);
      if (later) { toast("Show planned. Followers can ask for a reminder."); setTitle(""); setLater(false); setTried(false); reloadShows(); }
      else nav(`/live/host/${sid}`);
    } catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <div className="cam live-bg">
      <div className="live-panel">
        <span className="live-badge"><span className="dot-live" />LIVE</span>
        <b>Sell live with Buy now cards and quick auctions</b>
        <span className="muted-on-video">You need at least {MIN_LIVE_STOCK} items in stock, or {MIN_LIVE_STOCK} of one item. You have {stock}.</span>
        <div className="stock-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (stock / MIN_LIVE_STOCK) * 100)}%` }} /></div>
        <button className="btn go-live" onClick={() => setTried(true)}>Go live</button>
        {mine.length > 0 && (
          <div className="live-mine">
            {mine.map((x) => (
              <div key={x.id} className="live-later-row vglass">
                <span className="live-later-main"><span><b>{x.title}</b><span>{x.status === "live" ? "Live now" : showTime(x.startsAt)}</span></span></span>
                <button className="btn small green" onClick={() => nav(`/live/host/${x.id}`)}>{x.status === "live" ? "Open" : "Start"}</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {tried && (
        <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setTried(false)}>
          <div className="sheet glass" role="dialog" aria-modal="true" aria-label={list.length ? "Can't go live yet" : "Start a show"}>
            <div className="grabber" />
            <div className="sheet-head"><h2>{list.length ? "Can't go live yet" : "Start a show"}</h2>
              <button className="icon-btn" onClick={() => setTried(false)} aria-label="Close"><Icon name="close" /></button></div>
            <div className="sheet-body stack">
              {list.length ? list.map((b) => <div key={b} className="note amber">{b}</div>) : (
                <>
                  <div className="field">
                    <label htmlFor="show-title">Show title</label>
                    <input id="show-title" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder="Friday thrift drop" enterKeyHint="done" />
                  </div>
                  <div className="seg-row" role="radiogroup" aria-label="When">
                    <button role="radio" aria-checked={!later} className={!later ? "on" : ""} onClick={() => setLater(false)}>Now</button>
                    <button role="radio" aria-checked={later} className={later ? "on" : ""} onClick={() => setLater(true)}>Later</button>
                  </div>
                  {later && (
                    <div className="field">
                      <label htmlFor="show-when">Starts</label>
                      <input id="show-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                    </div>
                  )}
                  <p className="small muted">{later ? "Followers see it in the Live tab and can ask for a reminder." : "Next you'll see your camera. Nothing goes out until you tap Go live."}</p>
                  <ErrorNote error={error} />
                </>
              )}
            </div>
            <div className="sheet-foot">
              {list.length > 0 ? (!shop || shop.status !== "open"
                ? <button className="btn green block big" onClick={() => nav("/sell/start")}>Open my shop</button>
                : <button className="btn green block big" onClick={() => { setTried(false); onCreate(); }}>Create a listing</button>)
                : <button className="btn green block big" disabled={busy || title.trim().length < 3} onClick={submit}>{later ? "Plan show" : "Open camera"}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A date for an <input type="datetime-local">, in the phone's own time. */
function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { goLiveBlockers, liveStock, MIN_LIVE_STOCK } from "@app/core";
import { api } from "../../api";
import { useLoad } from "../../session";
import { Icon } from "../../components/Icon";
import { Loading } from "../../components/ui";
import { CreateListing } from "./Create";

type Mode = "camera" | "create" | "live";

/**
 * The + tab, like TikTok: Camera, Create and Live, switched at the bottom.
 * Camera takes a photo (tap) or video (hold) and hands it to Create, which is the listing form.
 */
export function Post() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = (["camera", "create", "live"] as const).find((m) => m === params.get("mode")) ?? "camera";
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
  const [shop] = useLoad(() => api.myShop(), []);
  const nav = useNavigate();
  const close = () => (window.history.length > 1 ? nav(-1) : nav("/"));
  const dark = mode !== "create";

  if (shop === undefined) return <div className="post dark"><div className="cam"><div className="cam-msg"><Loading /></div></div></div>;
  // Only sellers can post. Without an open shop, ask first; "No" leaves you where you were.
  if (!shop || shop.status !== "open") return <div className="post dark"><SellerGate open onClose={close} /></div>;

  return (
    <div className={`post ${dark ? "dark" : ""}`}>
      {mode === "camera" && <Camera onReview={setSub} onDone={(f) => { addShot(f); setFromCamera(true); setMode("create"); }} />}
      {mode === "create" && (
        <CreateListing shop={shop} media={media} onMedia={setMedia} startAtDetails={fromCamera}
          onCamera={() => { setFromCamera(false); setMode("camera"); }} onStep={(n) => { setSub(n > 0); if (n === 0) setFromCamera(false); }} />
      )}
      {mode === "live" && <GoLive onCreate={() => setMode("create")} />}

      {!sub && (
        <>
          <button className={`post-close ${dark ? "vglass" : "glass"}`} onClick={close} aria-label="Close"><Icon name="close" size={20} /></button>
          <div className={`post-modes ${dark ? "vglass" : "glass"}`} role="tablist" aria-label="Post">
            {(["camera", "create", "live"] as const).map((m) => (
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

/** Phone style camera: gallery on the left, shutter in the middle, flip on the right. Tap for a photo, hold to record. */
function Camera({ onDone, onReview }: { onDone: (file: File) => void; onReview: (on: boolean) => void }) {
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

  // Start (or restart after a flip) the camera.
  useEffect(() => {
    let cancelled = false;
    const stop = () => streamRef.current?.getTracks().forEach((t) => t.stop());
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setWhy("This browser can't open the camera."); return setState("unavailable"); }
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 } }, audio: true });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } }); // no microphone: video without sound
        }
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        stop();
        streamRef.current = stream;
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
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    if (facing === "user") { ctx.translate(c.width, 0); ctx.scale(-1, 1); } // match the mirrored preview
    ctx.drawImage(v, 0, 0);
    c.toBlob((b) => b && setShot(new File([b], `photo-${Date.now()}.jpg`, { type: "image/jpeg" })), "image/jpeg", 0.9);
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") return takePhoto();
    const type = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
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

  const pick = (f: File | undefined) => f && setShot(f);
  useEffect(() => onReview(!!shot), [shot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (shot) return <Review file={shot} onRetake={() => setShot(null)} onUse={() => onDone(shot)} />;

  const pct = Math.min(1, elapsed / limit);
  return (
    <div className="cam">
      <video ref={videoRef} className={`cam-feed ${facing === "user" ? "mirror" : ""}`} muted playsInline autoPlay />
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

function Review({ file, onRetake, onUse }: { file: File; onRetake: () => void; onUse: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="cam">
      {file.type.startsWith("image/") ? <img className="cam-feed" src={url} alt="Your photo" /> : <video className="cam-feed" src={url} autoPlay loop playsInline controls={false} />}
      <div className="cam-bottom">
        <div className="row" style={{ gap: 10, justifyContent: "center", marginBottom: 4 }}>
          <button className="btn vglass" onClick={onRetake}><Icon name="back" size={18} />Retake</button>
          <button className="btn green" onClick={onUse}>Next<Icon name="chevron" size={18} /></button>
        </div>
      </div>
    </div>
  );
}

/** Live: checks stock first. Streaming itself is coming next. */
function GoLive({ onCreate }: { onCreate: () => void }) {
  const [shop] = useLoad(() => api.myShop(), []);
  const [tried, setTried] = useState(false);
  const nav = useNavigate();
  const stock = shop ? liveStock(shop.products) : 0;
  const blockers = useCallback(() => {
    if (!shop || shop.status !== "open") return ["Open your shop first. Then list at least 5 items to go live."];
    const state = { verified: shop.checks.idStatus === "approved" && shop.checks.bankStatus === "approved", goodOrders: shop.goodOrders,
      trustScore: shop.trustScore, category: shop.category, foodCertApproved: shop.checks.certStatus === "approved" };
    return goLiveBlockers(state, stock);
  }, [shop, stock]);
  if (shop === undefined) return <div className="cam"><div className="cam-msg"><Loading /></div></div>;
  const list = blockers();

  return (
    <div className="cam live-bg">
      <div className="live-panel">
        <span className="live-badge"><span className="dot-live" />LIVE</span>
        <b>Sell live with pop up Buy now cards</b>
        <span className="muted-on-video">You need at least {MIN_LIVE_STOCK} items in stock, or {MIN_LIVE_STOCK} of one item. You have {stock}.</span>
        <div className="stock-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (stock / MIN_LIVE_STOCK) * 100)}%` }} /></div>
        <button className="btn go-live" onClick={() => setTried(true)}>Go live</button>
      </div>

      {tried && (
        <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setTried(false)}>
          <div className="sheet glass" role="dialog" aria-modal="true" aria-label={list.length ? "Can't go live yet" : "Going live"}>
            <div className="grabber" />
            <div className="sheet-head"><h2>{list.length ? "Can't go live yet" : "You're ready to go live"}</h2>
              <button className="icon-btn" onClick={() => setTried(false)} aria-label="Close"><Icon name="close" /></button></div>
            <div className="sheet-body stack">
              {list.length ? list.map((b) => <div key={b} className="note amber">{b}</div>)
                : <div className="note green">Your stock and record are ready. Live streaming with pop up Buy now cards is coming next, and you'll be one of the first to get it.</div>}
            </div>
            {list.length > 0 && (
              <div className="sheet-foot">
                {!shop || shop.status !== "open"
                  ? <button className="btn green block big" onClick={() => nav("/sell/start")}>Open my shop</button>
                  : <button className="btn green block big" onClick={() => { setTried(false); onCreate(); }}>Create a listing</button>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

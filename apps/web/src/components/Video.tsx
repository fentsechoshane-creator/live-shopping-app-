import { useEffect, useRef, useState } from "react";
import { api, type VideoSource } from "../api";
import { useSession } from "../session";
import { Scene, type SceneKind } from "./Scene";
import { Icon } from "./Icon";

/** 75 seconds shows as 1:15. */
export const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

/**
 * Plays a Mux stream (HLS) or a direct file, like TikTok: plays while on screen, tap to pause,
 * a sound button, and a bar you can drag to rewind, with the time and the full length.
 * Photo posts become a slideshow; demo posts show a drawn scene.
 */
export function Video({ src, label, productId }: { src: VideoSource; label: string; productId?: string }) {
  const hlsUrl = src.muxPlaybackId ? `https://stream.mux.com/${src.muxPlaybackId}.m3u8` : null;
  if (!hlsUrl && !src.url && src.demo?.scene) return <div className="placeholder"><Scene kind={src.demo.scene as SceneKind} animated label={label} /></div>;
  if (!hlsUrl && !src.url) {
    return (
      <div className="placeholder" style={{ background: `radial-gradient(120% 90% at 50% 25%, ${src.demo?.bg ?? "#333"}, #0e0e10)` }} role="img" aria-label={label}>
        <div className="silhouette" />
        <span style={{ position: "relative" }}>{src.demo?.label ?? label}</span>
      </div>
    );
  }
  if (src.kind === "image" && src.url) return <Slides cover={src.url} productId={productId} label={label} />;
  return <Player hlsUrl={hlsUrl} url={src.url ?? null} poster={src.muxPlaybackId ? `https://image.mux.com/${src.muxPlaybackId}/thumbnail.jpg?width=480` : undefined} label={label} />;
}

function Player({ hlsUrl, url, poster, label }: { hlsUrl: string | null; url: string | null; poster?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const { dataSaver } = useSession();
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const userPaused = useRef(false);

  // HLS for Mux streams (Safari plays it natively).
  useEffect(() => {
    const v = ref.current;
    if (!v || !hlsUrl) return;
    let destroy = () => {};
    if (v.canPlayType("application/vnd.apple.mpegurl")) v.src = hlsUrl;
    else
      import("hls.js").then(({ default: Hls }) => {
        if (!Hls.isSupported()) return;
        const hls = new Hls({ capLevelToPlayerSize: true });
        hls.loadSource(hlsUrl);
        hls.attachMedia(v);
        if (dataSaver) hls.on(Hls.Events.MANIFEST_PARSED, () => { hls.autoLevelCapping = 0; }); // data saver: lowest quality
        destroy = () => hls.destroy();
      });
    return () => destroy();
  }, [hlsUrl, dataSaver]);

  // Play only while on screen. Coming back on screen starts from where it was, unless you paused it.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.6 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (!onScreen) { v.pause(); return; }
    if (userPaused.current) return;
    // Sound is always on, like TikTok: the phone's volume buttons control it.
    // Browsers only allow sound after the first tap, so until then a video may start silent and the first tap turns sound on.
    v.muted = false;
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => {});
    });
  }, [onScreen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // After the first tap anywhere, unmute this video if it's on screen.
    const unlock = () => { const v = ref.current; if (v && v.muted) { v.muted = false; if (!v.paused) v.play().catch(() => { v.muted = true; }); } };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    return () => window.removeEventListener("pointerdown", unlock, { capture: true });
  }, []);

  // Gestures: tap to pause, double tap left to go back 10 seconds (right: forward 10), hold for 2x speed.
  const [flash, setFlash] = useState<string | null>(null);
  const [fast, setFast] = useState(false);
  const tapTimer = useRef<number>();
  const holdTimer = useRef<number>();
  const held = useRef(false);
  const lastTap = useRef(0);
  const showFlash = (t: string) => { setFlash(t); window.setTimeout(() => setFlash((f) => (f === t ? null : f)), 650); };
  const onLayerDown = (e: React.PointerEvent) => {
    held.current = false;
    holdTimer.current = window.setTimeout(() => {
      const v = ref.current;
      if (!v) return;
      held.current = true;
      v.playbackRate = 2;
      if (v.paused) { userPaused.current = false; v.play().catch(() => {}); }
      setFast(true);
    }, 450);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const endHold = () => {
    window.clearTimeout(holdTimer.current);
    if (held.current && ref.current) { ref.current.playbackRate = 1; setFast(false); }
  };
  const onLayerUp = (e: React.PointerEvent) => {
    endHold();
    if (held.current) return; // that was a hold, not a tap
    const now = Date.now();
    const v = ref.current;
    if (now - lastTap.current < 300 && v) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = 0;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const back = e.clientX - r.left < r.width / 2;
      v.currentTime = Math.max(0, Math.min(length || v.duration || 0, v.currentTime + (back ? -10 : 10)));
      setTime(v.currentTime);
      showFlash(back ? "back" : "fwd");
      return;
    }
    lastTap.current = now;
    if (v && v.muted) { v.muted = false; return; } // first tap turns sound on instead of pausing
    tapTimer.current = window.setTimeout(toggle, 280); // wait a moment in case it's a double tap
  };
  useEffect(() => () => { window.clearTimeout(tapTimer.current); window.clearTimeout(holdTimer.current); }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { userPaused.current = false; v.play().catch(() => {}); }
    else { userPaused.current = true; v.pause(); }
  };
  // Drag the bar to rewind or skip ahead.
  const seekTo = (clientX: number) => {
    const v = ref.current, bar = barRef.current;
    if (!v || !bar || !length) return;
    const r = bar.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * length;
    v.currentTime = t;
    setTime(t);
  };
  const onBarDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setScrubbing(true);
    seekTo(e.clientX);
  };

  const pct = length ? (time / length) * 100 : 0;
  // Move the bar every frame (60 times a second) straight from the video, so it glides instead of stepping.
  const fillRef = useRef<HTMLSpanElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = ref.current;
      if (v && v.duration && !scrubbing) {
        const p = Math.min(1, v.currentTime / v.duration);
        if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
        if (knobRef.current) knobRef.current.style.left = `${p * 100}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    if (onScreen && !paused) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onScreen, paused, scrubbing]);
  return (
    <>
      <video ref={ref} src={hlsUrl ? undefined : url ?? undefined} poster={poster} loop playsInline aria-label={label}
        onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
        onTimeUpdate={(e) => !scrubbing && setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setLength(e.currentTarget.duration)} onDurationChange={(e) => setLength(e.currentTarget.duration)} />
      <button className="tap-layer" onPointerDown={onLayerDown} onPointerUp={onLayerUp} onPointerCancel={endHold}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
        onContextMenu={(e) => e.preventDefault()} aria-label={paused ? "Play" : "Pause"}>
        {flash && <span className={`seek-flash ${flash}`}><Icon name={flash === "back" ? "rewind" : "forward"} size={22} />{flash === "back" ? "10s" : "10s"}</span>}
        {fast && <span className="speed-chip vglass">2x <Icon name="forward" size={14} /></span>}
        {paused && onScreen && userPaused.current && <span className="big-play vglass"><Icon name="play" size={30} /></span>}
        {scrubbing && <span className="vtime">{clock(time)} / {clock(length)}</span>}
      </button>
      <div className={`vbar ${scrubbing ? "drag" : ""}`}>
        <div className="vtrack" ref={barRef} role="slider" aria-label="Video position" aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} of ${clock(length)}`} tabIndex={0}
          onPointerDown={onBarDown} onPointerMove={(e) => scrubbing && seekTo(e.clientX)}
          onPointerUp={() => setScrubbing(false)} onPointerCancel={() => setScrubbing(false)}
          onKeyDown={(e) => {
            const v = ref.current;
            if (!v) return;
            if (e.key === "ArrowLeft") v.currentTime = Math.max(0, v.currentTime - 5);
            if (e.key === "ArrowRight") v.currentTime = Math.min(length, v.currentTime + 5);
          }}>
          <span className="vfill" ref={fillRef} style={{ transform: `scaleX(${pct / 100})` }} />
          <span className="vknob" ref={knobRef} style={{ left: `${pct}%` }} />
        </div>
      </div>
    </>
  );
}

/** Photo posts: swipe through the cover and extra photos, with dots. Moves on by itself every 4 seconds until you swipe. */
function Slides({ cover, productId, label }: { cover: string; productId?: string; label: string }) {
  const [extra, setExtra] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  useEffect(() => { if (productId) api.productPhotos(productId).then(setExtra).catch(() => {}); }, [productId]);
  const photos = [cover, ...extra];
  useEffect(() => {
    if (photos.length < 2) return;
    const t = window.setInterval(() => {
      const el = ref.current;
      if (!el || touched.current) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return; // not on screen
      el.scrollTo({ left: ((index + 1) % photos.length) * el.clientWidth, behavior: "smooth" });
    }, 4000);
    return () => window.clearInterval(t);
  }, [index, photos.length]);
  return (
    <>
      <div className="slides" ref={ref} onPointerDown={() => (touched.current = true)}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
        {photos.map((p, i) => <img key={p} src={p} alt={`${label}, photo ${i + 1} of ${photos.length}`} />)}
      </div>
      {photos.length > 1 && (
        <div className="slide-dots" aria-hidden="true">
          {photos.map((p, i) => <span key={p} className={i === index ? "on" : ""} />)}
          <em>{index + 1}/{photos.length}</em>
        </div>
      )}
    </>
  );
}

/** Length of a video, for tiles and previews ("0:45"). Loads only the file's details, not the video. */
export function useVideoLength(url: string | null | undefined) {
  const [len, setLen] = useState<number | null>(null);
  useEffect(() => {
    if (!url) return;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = url;
    v.onloadedmetadata = () => setLen(Number.isFinite(v.duration) ? v.duration : null);
    return () => { v.removeAttribute("src"); v.load(); };
  }, [url]);
  return len;
}

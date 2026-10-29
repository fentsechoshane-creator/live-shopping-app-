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
  const { dataSaver, soundOn, setSoundOn } = useSession();
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
    v.muted = !soundOn;
    v.play().catch(() => {
      // Phones block sound until you tap. Play silently and show the sound button as off.
      v.muted = true;
      if (soundOn) setSoundOn(false);
      v.play().catch(() => {});
    });
  }, [onScreen, soundOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { userPaused.current = false; v.play().catch(() => {}); }
    else { userPaused.current = true; v.pause(); }
  };
  const toggleSound = () => {
    const v = ref.current;
    const on = !soundOn;
    setSoundOn(on);
    if (v) { v.muted = !on; if (on && v.paused && !userPaused.current) v.play().catch(() => {}); }
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
  return (
    <>
      <video ref={ref} src={hlsUrl ? undefined : url ?? undefined} poster={poster} muted={!soundOn} loop playsInline aria-label={label}
        onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
        onTimeUpdate={(e) => !scrubbing && setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setLength(e.currentTarget.duration)} onDurationChange={(e) => setLength(e.currentTarget.duration)} />
      <button className="tap-layer" onClick={toggle} aria-label={paused ? "Play" : "Pause"}>
        {paused && onScreen && userPaused.current && <span className="big-play vglass"><Icon name="play" size={30} /></span>}
        {(scrubbing || (paused && userPaused.current)) && <span className="vtime">{clock(time)} / {clock(length)}</span>}
      </button>
      <button className="sound-btn vglass" onClick={toggleSound} aria-label={soundOn ? "Sound off" : "Sound on"} aria-pressed={soundOn}>
        <Icon name={soundOn ? "sound" : "mute"} size={18} />
      </button>
      <div className={`vbar ${scrubbing || paused ? "big" : ""}`}>
        {!scrubbing && !paused && length > 0 && <span className="vlen">{clock(length - time)}</span>}
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
          <span className="vfill" style={{ width: `${pct}%` }} />
          <span className="vknob" style={{ left: `${pct}%` }} />
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

import { useEffect, useRef, useState } from "react";
import { clipLength, clipStartsAt, editLength, locate } from "@app/core";
import type { PlayEdit, VideoSource } from "../api";
import { useSession } from "../session";
import { Icon } from "./Icon";

export interface ClipPlayerApi { seek: (t: number) => void }

/**
 * Plays an edit from the video editor: the clips one after another, each from its start to its end, with sound on
 * or off per clip. Photos show for their length. Loops at the end. Nothing was re-rendered: this is the "edit list"
 * idea in docs/VIDEO_EDITING.md. Tap to pause; the thin bar at the bottom shows where you are in the whole video.
 */
export function ClipPlayer({ edit, label, onTime, apiRef }: {
  edit: PlayEdit; label: string;
  /** Called a few times a second with the moment on the whole timeline and the clip that's playing. */
  onTime?: (t: number, index: number) => void;
  apiRef?: (api: ClipPlayerApi) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const tapRef = useRef<HTMLButtonElement>(null);
  const onScreenRef = useRef(false);
  const { dataSaver } = useSession();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const pendingSeek = useRef<number | null>(null);
  const imageClock = useRef<{ started: number; offset: number } | null>(null);
  const userPaused = useRef(false);
  const soundUnlocked = useRef(false);
  const clip = edit.clips[Math.min(index, edit.clips.length - 1)];
  // The editor changes trims while playing, so the clock reads the latest edit, not the one it started with.
  const live = useRef({ edit, clip });
  live.current = { edit, clip };
  const isImage = clip?.video.kind === "image";
  const total = editLength(edit);
  const startsAt = clipStartsAt(edit, index);

  const next = () => setIndex((i) => (i + 1) % Math.max(1, live.current.edit.clips.length));
  // Clips removed in the editor: stay in range.
  useEffect(() => { if (index >= edit.clips.length) setIndex(0); }, [edit.clips.length, index]);

  // Load this clip's source (HLS for Mux, a plain file otherwise) and jump to its start.
  useEffect(() => {
    const v = ref.current;
    if (!v || !clip || isImage) return;
    let destroy = () => {};
    const hls = sourceOf(clip.video).hls;
    const start = () => {
      v.currentTime = pendingSeek.current ?? clip.start;
      pendingSeek.current = null;
      if (onScreenRef.current && !userPaused.current) play();
    };
    v.addEventListener("loadedmetadata", start, { once: true });
    if (hls && !v.canPlayType("application/vnd.apple.mpegurl")) {
      import("hls.js").then(({ default: Hls }) => {
        if (!Hls.isSupported()) return;
        const h = new Hls({ capLevelToPlayerSize: true });
        h.loadSource(hls);
        h.attachMedia(v);
        if (dataSaver) h.on(Hls.Events.MANIFEST_PARSED, () => { h.autoLevelCapping = 0; });
        destroy = () => h.destroy();
      });
    } else {
      v.src = hls ?? sourceOf(clip.video).url ?? "";
    }
    return () => { v.removeEventListener("loadedmetadata", start); destroy(); };
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // Photos: shown for their length on a simple clock.
  useEffect(() => {
    if (!isImage) { imageClock.current = null; return; }
    imageClock.current = { started: performance.now(), offset: (pendingSeek.current ?? clip.start) - clip.start };
    pendingSeek.current = null;
  }, [index, isImage]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = clip.muted || !soundUnlocked.current;
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  };

  // Only play while on screen.
  useEffect(() => {
    const el = tapRef.current?.parentElement;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { onScreenRef.current = e.isIntersecting; setOnScreen(e.isIntersecting); }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const v = ref.current;
    if (!v || isImage) return;
    if (!onScreen) v.pause();
    else if (!userPaused.current) play();
  }, [onScreen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const unlock = () => { soundUnlocked.current = true; const v = ref.current; if (v && !clip?.muted) v.muted = false; };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    return () => window.removeEventListener("pointerdown", unlock, { capture: true });
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // The clock: move to the next clip at this clip's end, report the time, glide the bar.
  useEffect(() => {
    let raf = 0, lastReport = 0;
    const tick = (now: number) => {
      const v = ref.current;
      const { edit, clip } = live.current;
      const startsAt = clipStartsAt(edit, Math.min(index, edit.clips.length - 1));
      const total = editLength(edit);
      if (!clip) return;
      let local = 0;
      if (isImage) {
        const c = imageClock.current;
        if (c && onScreen && !userPaused.current) local = c.offset + (now - c.started) / 1000;
        else if (c) { c.started = now - c.offset * 1000; local = c.offset; }
        if (c) c.offset = local;
        if (local >= clipLength(clip)) { next(); return; }
      } else if (v && v.readyState >= 1) {
        local = v.currentTime - clip.start;
        if (v.currentTime >= clip.end - 0.04) {
          if (edit.clips.length === 1) { v.currentTime = clip.start; local = 0; }
          else { next(); return; }
        }
      }
      const t = Math.max(0, startsAt + local);
      if (fillRef.current && total) fillRef.current.style.transform = `scaleX(${Math.min(1, t / total)})`;
      if (now - lastReport > 200) { lastReport = now; onTime?.(t, index); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, onScreen, isImage]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = (t: number) => {
    const at = locate(edit, Math.max(0, Math.min(total - 0.05, t)));
    if (at.index === index) {
      if (isImage && imageClock.current) imageClock.current = { started: performance.now(), offset: at.sourceTime - clip.start };
      else if (ref.current) ref.current.currentTime = at.sourceTime;
    } else { pendingSeek.current = at.sourceTime; setIndex(at.index); }
  };
  useEffect(() => { apiRef?.({ seek }); });

  const toggle = () => {
    soundUnlocked.current = true;
    const v = ref.current;
    if (paused) { userPaused.current = false; setPaused(false); if (v && !isImage) { v.muted = clip.muted; v.play().catch(() => {}); } }
    else { userPaused.current = true; setPaused(true); v?.pause(); }
  };

  return (
    <>
      {isImage
        ? <img className="clip-photo" src={sourceOf(clip.video).url ?? ""} alt={label} />
        : <video ref={ref} playsInline aria-label={label} preload="auto"
            poster={clip?.video.muxPlaybackId ? `https://image.mux.com/${clip.video.muxPlaybackId}/thumbnail.jpg?width=480&time=${clip.start}` : undefined} />}
      <button ref={tapRef} className="tap-layer" onClick={toggle} aria-label={paused ? "Play" : "Pause"}>
        {paused && <span className="big-play vglass"><Icon name="play" size={30} /></span>}
      </button>
      <div className="vbar" aria-hidden="true">
        <div className="vtrack clips">
          {edit.clips.map((c, i) => <i key={i} style={{ flexGrow: clipLength(c) }} />)}
          <span className="vfill" ref={fillRef} />
        </div>
      </div>
    </>
  );
}

function sourceOf(v: VideoSource): { hls: string | null; url: string | null } {
  return { hls: v.muxPlaybackId ? `https://stream.mux.com/${v.muxPlaybackId}.m3u8` : null, url: v.url ?? null };
}

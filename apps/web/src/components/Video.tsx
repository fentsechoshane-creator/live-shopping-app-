import { useEffect, useRef } from "react";
import type { VideoSource } from "../api";

/** Plays a Mux stream (HLS), a direct file, or shows the demo placeholder. Plays only while on screen. */
export function Video({ src, label }: { src: VideoSource; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const hlsUrl = src.muxPlaybackId ? `https://stream.mux.com/${src.muxPlaybackId}.m3u8` : null;
  const poster = src.muxPlaybackId ? `https://image.mux.com/${src.muxPlaybackId}/thumbnail.jpg?width=480` : undefined;

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
        destroy = () => hls.destroy();
      });
    return () => destroy();
  }, [hlsUrl]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.6 });
    io.observe(v);
    return () => io.disconnect();
  }, []);

  if (!hlsUrl && !src.url) {
    return <div className="placeholder" style={{ background: src.demo?.bg ?? "#333" }} role="img" aria-label={label}>{src.demo?.label ?? label}</div>;
  }
  return <video ref={ref} src={hlsUrl ? undefined : src.url ?? undefined} poster={poster} muted loop playsInline aria-label={label} />;
}

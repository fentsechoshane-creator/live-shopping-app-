import { useEffect, useRef } from "react";
import type { VideoSource } from "../api";
import { useSession } from "../session";
import { Scene, type SceneKind } from "./Scene";

/** Plays a Mux stream (HLS), a direct file, or shows the demo placeholder. Plays only while on screen. */
export function Video({ src, label }: { src: VideoSource; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const { dataSaver } = useSession();
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
        // Data saver: stay on the lowest quality.
        if (dataSaver) hls.on(Hls.Events.MANIFEST_PARSED, () => { hls.autoLevelCapping = 0; });
        destroy = () => hls.destroy();
      });
    return () => destroy();
  }, [hlsUrl, dataSaver]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.6 });
    io.observe(v);
    return () => io.disconnect();
  }, []);

  if (!hlsUrl && !src.url && src.demo?.scene) return <div className="placeholder"><Scene kind={src.demo.scene as SceneKind} animated label={label} /></div>;
  if (!hlsUrl && !src.url) {
    return (
      <div className="placeholder" style={{ background: `radial-gradient(120% 90% at 50% 25%, ${src.demo?.bg ?? "#333"}, #0e0e10)` }} role="img" aria-label={label}>
        <div className="silhouette" />
        <span style={{ position: "relative" }}>{src.demo?.label ?? label}</span>
      </div>
    );
  }
  if (src.kind === "image" && src.url) return <img src={src.url} alt={label} className="photo-post" />;
  return <video ref={ref} src={hlsUrl ? undefined : src.url ?? undefined} poster={poster} muted loop playsInline aria-label={label} />;
}

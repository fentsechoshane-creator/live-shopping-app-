// Connects this phone to a live show's video on LiveKit. The seller sends camera and sound; viewers watch.
// The LiveKit library is loaded only when someone opens a live, so the rest of the app stays small.
// In the demo (no video service) the seller sees their own camera as a preview, and viewers see a sample video.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";

export type RoomState = "idle" | "connecting" | "on" | "demo" | "error";

export function useLiveRoom(showId: string, role: "host" | "viewer", active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const roomRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioEls = useRef<HTMLMediaElement[]>([]);
  const [state, setState] = useState<RoomState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [viewers, setViewers] = useState(0);
  const [needsTap, setNeedsTap] = useState(false);
  const [muted, setMuted] = useState(false);
  const [front, setFront] = useState(true);

  const stop = useCallback(() => {
    roomRef.current?.disconnect?.();
    roomRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioEls.current.forEach((el) => el.remove());
    audioEls.current = [];
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setState("connecting");
    try {
      const access = await api.liveToken(showId, role);
      if (!access) {
        // Demo: the seller sees their own camera; nothing is sent anywhere.
        if (role === "host" && navigator.mediaDevices?.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }).catch(() => null);
          if (stream) { streamRef.current = stream; if (videoRef.current) videoRef.current.srcObject = stream; }
        }
        setState("demo");
        return;
      }
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track: any) => {
        if (track.kind === Track.Kind.Video && videoRef.current) track.attach(videoRef.current);
        if (track.kind === Track.Kind.Audio) { const el = track.attach(); el.style.display = "none"; document.body.appendChild(el); audioEls.current.push(el); }
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsTap(!room.canPlaybackAudio));
      room.on(RoomEvent.Disconnected, () => setState((s) => (s === "on" ? "idle" : s)));
      await room.connect(access.url, access.token);
      if (role === "host") {
        await room.localParticipant.setCameraEnabled(true, { facingMode: "user", resolution: { width: 720, height: 1280 } });
        await room.localParticipant.setMicrophoneEnabled(true);
        const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (pub?.track && videoRef.current) pub.track.attach(videoRef.current);
      } else {
        setNeedsTap(!room.canPlaybackAudio);
      }
      setState("on");
    } catch (e) {
      stop();
      const msg = e instanceof Error ? e.message : "";
      setError(/Permission|NotAllowed/i.test(msg) ? "Allow camera and microphone for myHaul in your phone's settings, then try again." : msg || "Couldn't connect to the live video. Check your signal and try again.");
      setState("error");
    }
  }, [showId, role, stop]);

  useEffect(() => {
    if (active) start();
    return stop;
  }, [active, start, stop]);

  // The <video> only appears once connected, so attach the camera (or the stream) when it does.
  useEffect(() => {
    if (state !== "on" && state !== "demo") return;
    const el = videoRef.current;
    if (!el) return;
    if (streamRef.current) { el.srcObject = streamRef.current; el.play?.().catch(() => {}); return; }
    const room = roomRef.current;
    if (role === "host" && room) {
      import("livekit-client").then(({ Track }) => room.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.attach(el));
    } else if (room) {
      for (const p of room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) if (pub.track && pub.kind === "video") pub.track.attach(el);
    }
  }, [state, role]);

  // How many people are watching (everyone in the room except the seller).
  useEffect(() => {
    if (state !== "on") return;
    const t = window.setInterval(() => setViewers(Math.max(0, (roomRef.current?.numParticipants ?? 1) - 1)), 3000);
    return () => window.clearInterval(t);
  }, [state]);

  const startAudio = useCallback(async () => {
    try { await roomRef.current?.startAudio?.(); setNeedsTap(false); } catch { /* the next tap tries again */ }
  }, []);
  const toggleMute = useCallback(async () => {
    const next = !muted;
    setMuted(next);
    await roomRef.current?.localParticipant?.setMicrophoneEnabled(!next).catch(() => {});
  }, [muted]);
  const flip = useCallback(async () => {
    const next = !front;
    setFront(next);
    const room = roomRef.current;
    if (room) {
      const { Track } = await import("livekit-client");
      const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      await track?.restartTrack({ facingMode: next ? "user" : "environment" }).catch(() => {});
    } else if (streamRef.current && navigator.mediaDevices?.getUserMedia) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next ? "user" : "environment" }, audio: false }).catch(() => null);
      if (s) { streamRef.current = s; if (videoRef.current) videoRef.current.srcObject = s; }
    }
  }, [front]);

  return { videoRef, state, error, viewers, needsTap, startAudio, muted, toggleMute, front, flip, retry: start, stop };
}

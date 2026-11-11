import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { confirmFeel, tap } from "../native";
import { Icon } from "./Icon";

/** How long to hold before a bid goes in. One place to change it. */
export const HOLD_MS = 3000;

type Phase = "idle" | "holding" | "sending" | "done";

/**
 * Press and hold to bid. At rest the button switches between the price and "Hold to bid" like a live sign; while you
 * hold it counts down. A quick tap (when onTap is given) opens the bid sheet to pick your own amount.
 * Press and hold to bid. A thin amber glass ring closes around the button while you hold; let go early and nothing
 * happens. When the ring closes the phone gives a firm tap and the bid goes in, without leaving the screen.
 * Works with a finger, a mouse, or holding Space or Enter on a keyboard.
 */
export function HoldToBid({ label, price, verb = "Bid", onConfirm, onTap, disabled, block, glass, onNeedUser }: {
  /** The word in the countdown: "Bid R720 in 3", or "Max R900 in 3". */
  verb?: string;
  /** Full words for screen readers, like "Hold to bid R720". */
  label: string;
  /** The amount shown on the button, like "R720". */
  price: string;
  /** A quick tap, not a hold. */
  onTap?: () => void;
  /** Dark glass, for use over video. */
  glass?: boolean;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  block?: boolean;
  /** Return true to stop (for example to ask the person to sign in first). */
  onNeedUser?: () => boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [left, setLeft] = useState(HOLD_MS / 1000);
  const [flip, setFlip] = useState(false);
  const downAt = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const timers = useRef<number[]>([]);
  const grad = `hold-${useId().replace(/:/g, "")}`;
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };

  useLayoutEffect(() => {
    const el = btn.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => clear, []);
  // The live sign: price, then "Hold to bid", every couple of seconds while nothing is happening.
  useEffect(() => {
    if (phase !== "idle" || disabled) { setFlip(false); return; }
    const t = window.setInterval(() => setFlip((f) => !f), 2600);
    return () => window.clearInterval(t);
  }, [phase, disabled]);

  const start = () => {
    if (disabled || phaseRef.current !== "idle") return;
    if (onNeedUser?.()) return;
    setPhase("holding");
    downAt.current = Date.now();
    setLeft(HOLD_MS / 1000);
    tap();
    // A light tick each second so you can feel it counting, then the bid.
    for (let s = 1; s < HOLD_MS / 1000; s++) timers.current.push(window.setTimeout(() => { tap(); setLeft(HOLD_MS / 1000 - s); }, s * 1000));
    timers.current.push(window.setTimeout(async () => {
      clear();
      setPhase("sending");
      confirmFeel();
      try {
        await onConfirm();
        setPhase("done");
        timers.current.push(window.setTimeout(() => setPhase("idle"), 1600));
      } catch { setPhase("idle"); }
    }, HOLD_MS));
  };
  const cancel = () => {
    if (phaseRef.current !== "holding") return;
    clear(); setPhase("idle");
    if (onTap && Date.now() - downAt.current < 300) onTap();
  };

  // Which text is showing now, and which was showing just before (so it can leave upwards).
  const face = phase === "idle" ? (flip ? "hold" : "price") : phase;
  const prevFace = useRef(face);
  const lastFace = useRef(face);
  if (lastFace.current !== face) { prevFace.current = lastFace.current; lastFace.current = face; }
  const cls = (k: string) => (k === face ? "on" : k === prevFace.current ? "was" : "");

  const pad = 4, w = size.w + pad * 2 - 3, h = size.h + pad * 2 - 3;
  const secs = HOLD_MS / 1000;
  return (
    <span className={`hold ${block ? "block" : ""}`} data-phase={phase}>
      <button ref={btn} type="button" className={`btn amber hold-btn ${glass ? "on-video" : ""} ${block ? "block big" : ""}`} disabled={disabled || phase === "sending"}
        aria-label={phase === "done" ? "Bid placed" : `${label}. Press and hold for ${secs} seconds to confirm${onTap ? ", or tap to pick your own amount" : ""}.`}
        onPointerDown={(e) => { e.stopPropagation(); if (e.button > 0) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } start(); }}
        onPointerUp={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(); } }}
        onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") cancel(); }}
        onClick={(e) => e.preventDefault()}>
        {/* Every face is always there, stacked: the one leaving slides up and fades, the new one comes up from below. */}
        <span className="hold-face">
          <span className={cls("price")}><i className="hold-dot" />{price}</span>
          <span className={cls("hold")}><Icon name="clock" size={16} />Hold to bid</span>
          <span className={cls("holding")}>{verb} {price} in <b className="hold-count">{[3, 2, 1].map((n) => <i key={n} className={left === n ? "on" : left === n - 1 ? "was" : ""}>{n}</i>)}</b></span>
          <span className={cls("sending")}>Placing bid…</span>
          <span className={cls("done")}><Icon name="check" size={17} strokeWidth={3} />Bid placed</span>
        </span>
      </button>
      {size.w > 0 && (
        <svg className="hold-ring" width={size.w + pad * 2} height={size.h + pad * 2} aria-hidden="true">
          <defs>
            <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fde68a" />
              <stop offset="0.45" stopColor="#ff9f0a" />
              <stop offset="0.75" stopColor="#fff7d6" />
              <stop offset="1" stopColor="#f59e0b" />
            </linearGradient>
          </defs>
          <rect className="track" x="1.5" y="1.5" width={w} height={h} rx={h / 2} pathLength={100} />
          <rect className="fill" x="1.5" y="1.5" width={w} height={h} rx={h / 2} pathLength={100} stroke={`url(#${grad})`}
            style={{ transitionDuration: phase === "holding" ? `${HOLD_MS}ms, 200ms` : undefined }} />
        </svg>
      )}
    </span>
  );
}

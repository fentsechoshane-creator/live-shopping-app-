import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { confirmFeel, tap } from "../native";
import { Icon } from "./Icon";

/** How long to hold before a bid goes in. One place to change it. */
export const HOLD_MS = 3000;

type Phase = "idle" | "holding" | "sending" | "done";

/**
 * Press and hold to bid. A thin amber glass ring closes around the button while you hold; let go early and nothing
 * happens. When the ring closes the phone gives a firm tap and the bid goes in, without leaving the screen.
 * Works with a finger, a mouse, or holding Space or Enter on a keyboard.
 */
export function HoldToBid({ label, onConfirm, disabled, block, onNeedUser }: {
  label: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  block?: boolean;
  /** Return true to stop (for example to ask the person to sign in first). */
  onNeedUser?: () => boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [phase, setPhaseState] = useState<Phase>("idle");
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

  const start = () => {
    if (disabled || phaseRef.current !== "idle") return;
    if (onNeedUser?.()) return;
    setPhase("holding");
    tap();
    // A light tick each second so you can feel it counting, then the bid.
    for (let s = 1; s < HOLD_MS / 1000; s++) timers.current.push(window.setTimeout(() => tap(), s * 1000));
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
  const cancel = () => { if (phaseRef.current !== "holding") return; clear(); setPhase("idle"); };

  const pad = 4, w = size.w + pad * 2 - 3, h = size.h + pad * 2 - 3;
  const secs = HOLD_MS / 1000;
  return (
    <span className={`hold ${block ? "block" : ""}`} data-phase={phase}>
      <button ref={btn} type="button" className={`btn amber hold-btn ${block ? "block big" : ""}`} disabled={disabled || phase === "sending"}
        aria-label={phase === "done" ? "Bid placed" : `${label}. Press and hold for ${secs} seconds to confirm.`}
        onPointerDown={(e) => { e.stopPropagation(); if (e.button > 0) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } start(); }}
        onPointerUp={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(); } }}
        onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") cancel(); }}
        onClick={(e) => e.preventDefault()}>
        {phase === "done" ? <><Icon name="check" size={18} strokeWidth={3} />Bid placed</>
          : phase === "sending" ? "Placing bid…"
          : phase === "holding" ? <><Icon name="clock" size={18} />Keep holding</>
          : <><Icon name="clock" size={18} />{label}</>}
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

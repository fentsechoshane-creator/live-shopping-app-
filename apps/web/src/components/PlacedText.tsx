import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { EditMark } from "@app/core";

/** Dark text on light colours, light on dark, for the "box" style. */
const readableOn = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0b0b0f" : "#ffffff";
};

/**
 * Text placed on a video, CapCut style: anywhere (x, y), any size and angle, plain, on a box, or outlined.
 * Sized against the video itself (container units), so it looks the same in the editor and full screen in the feed.
 * Older posts used a band (top, middle, bottom) instead of x and y; those still show where they were.
 */
export function PlacedText({ m, selected, onPointerDown, onClick }: {
  m: EditMark; selected?: boolean;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onClick?: () => void;
}) {
  const colour = m.color ?? "#ffffff";
  const style = m.style ?? "plain";
  const x = m.x ?? 0.5;
  const y = m.y ?? (m.pos === "top" ? 0.16 : m.pos === "bottom" ? 0.7 : 0.42);
  const css: CSSProperties = {
    left: `${x * 100}%`, top: `${y * 100}%`,
    transform: `translate(-50%, -50%) rotate(${m.rot ?? 0}deg)`,
    fontSize: `calc(5.6cqw * ${m.size ?? 1})`,
    ...(style === "box" ? { background: colour, color: readableOn(colour) } : { color: colour }),
    ...(style === "outline" ? { WebkitTextStroke: `0.06em ${readableOn(colour) === "#ffffff" ? "#ffffff" : "#0b0b0f"}`, paintOrder: "stroke fill" } : {}),
  };
  return (
    <div className={`placed-text pt-${style} ${selected ? "selected" : ""} ${onPointerDown ? "movable" : ""}`} style={css}
      onPointerDown={onPointerDown} onClick={onClick} role={onClick ? "button" : undefined} aria-label={onClick ? `Text: ${m.text}` : undefined}>
      {m.text}
    </div>
  );
}

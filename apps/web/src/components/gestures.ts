import { useRef } from "react";

/**
 * Swipe handlers for an element: left, right, down or up. Only fires when the move is clearly in one
 * direction, so normal scrolling still works. Ignores swipes that start inside [data-noswipe] (like photo slideshows).
 */
export function useSwipe({ onLeft, onRight, onDown, onUp, threshold = 60 }: {
  onLeft?: () => void; onRight?: () => void; onDown?: () => void; onUp?: () => void; threshold?: number;
}) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      if ((e.target as HTMLElement).closest("[data-noswipe]")) { start.current = null; return; }
      const p = e.touches[0];
      start.current = { x: p.clientX, y: p.clientY, t: Date.now() };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - s.x, dy = p.clientY - s.y;
      if (Date.now() - s.t > 800) return; // a slow drag is not a swipe
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? onLeft : onRight)?.();
      else if (Math.abs(dy) > threshold && Math.abs(dy) > Math.abs(dx) * 1.5) (dy > 0 ? onDown : onUp)?.();
    },
  };
}

/** Step through a list of tabs with swipes: left goes to the next, right to the one before. */
export function useTabSwipe<T extends string>(tabs: readonly T[], current: T, set: (t: T) => void) {
  const i = tabs.indexOf(current);
  return useSwipe({
    onLeft: () => i < tabs.length - 1 && set(tabs[i + 1]),
    onRight: () => i > 0 && set(tabs[i - 1]),
  });
}

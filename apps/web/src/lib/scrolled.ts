import { useEffect, useRef, useState } from "react";

/**
 * True once the element has scrolled up under the frozen top bar, like Instagram's profile: the name then shows small
 * in the top bar. Works on any scrolling page because it watches the element, not a scroll position.
 */
export function useScrolledPast<T extends HTMLElement>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting && e.boundingClientRect.top < 120), { rootMargin: "-110px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, past];
}

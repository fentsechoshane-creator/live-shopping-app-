import { useEffect, useState } from "react";
import { api } from "../api";
/** A round profile photo, or the first letter of the name when there's no photo. */
export function Avatar({ url, name, size, className = "avatar" }: { url?: string | null; name: string; size?: number; className?: string }) {
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.42) } : undefined;
  return (
    <span className={`${className} ${url ? "has-photo" : ""}`} style={style} aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" /> : (name.replace(/^@/, "")[0] ?? "?").toUpperCase()}
    </span>
  );
}

// Shop profile photos, loaded once per shop and shared by every screen (14 Nov: "everywhere an account shows, show its photo").
const shopFaceCache = new Map<string, string | null>();
export function useShopAvatars(shopIds: (string | null | undefined)[]): Record<string, string> {
  const ids = [...new Set(shopIds.filter((x): x is string => !!x))];
  const key = ids.join(",");
  const [, bump] = useState(0);
  useEffect(() => {
    const missing = ids.filter((id) => !shopFaceCache.has(id));
    if (!missing.length) return;
    let live = true;
    api.shopAvatars(missing).then((found) => {
      missing.forEach((id) => shopFaceCache.set(id, found[id] ?? null));
      if (live) bump((n) => n + 1);
    }).catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const out: Record<string, string> = {};
  ids.forEach((id) => { const u = shopFaceCache.get(id); if (u) out[id] = u; });
  return out;
}

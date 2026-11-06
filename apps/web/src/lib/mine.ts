// Which shop is yours, so your own posts show seller tools instead of Buy, Follow and Message (like Depop's Edit on
// your own listing, or TikTok never asking you to follow yourself).
import { useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";

let cache: { userId: string; shopId: Promise<string | null> } | null = null;

/** Your shop's id, or null when you're signed out or have no shop. Loaded once per account. */
export function useMyShopId(): string | null {
  const { user } = useSession();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!user) { cache = null; setId(null); return; }
    if (!cache || cache.userId !== user.id) {
      cache = { userId: user.id, shopId: api.myShop().then((s) => s?.id ?? null).catch(() => null) };
    }
    let live = true;
    cache.shopId.then((v) => { if (live) setId(v); });
    return () => { live = false; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return id;
}

/** True when this shop is yours. */
export function useIsMine(shopId: string | undefined): boolean {
  const mine = useMyShopId();
  return !!mine && !!shopId && mine === shopId;
}

/** Call after opening a shop so "yours" is known straight away. */
export function forgetMyShop() { cache = null; }

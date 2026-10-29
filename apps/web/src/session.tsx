import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Reaction, type User } from "./api";

interface Session {
  user: User | null;
  ready: boolean;
  toast: (msg: string) => void;
  /** Shops the user follows. */
  following: Set<string>;
  toggleFollow: (shopId: string) => Promise<void>;
  /** Posts the user liked and reposted. */
  liked: Set<string>;
  reposted: Set<string>;
  toggleReaction: (postId: string, kind: Reaction) => Promise<void>;
  /** Lower video quality on mobile data. Saved on this phone only. */
  dataSaver: boolean;
  setDataSaver: (on: boolean) => void;
  /** Video sound for the whole app, like TikTok. Remembered on this phone. */
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** Side menu with settings, opened from the profile. */
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}

const Ctx = createContext<Session>({
  user: null, ready: false, toast: () => {}, following: new Set(), toggleFollow: async () => {},
  liked: new Set(), reposted: new Set(), toggleReaction: async () => {},
  dataSaver: false, setDataSaver: () => {}, soundOn: false, setSoundOn: () => {}, menuOpen: false, setMenuOpen: () => {},
});

const readPref = (k: string) => {
  try { return localStorage.getItem(k) === "1"; } catch { return false; }
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [reposted, setReposted] = useState<Set<string>>(new Set());
  const [dataSaver, setDataSaverState] = useState(readPref("lsa-data-saver"));
  const [menuOpen, setMenuOpen] = useState(false);
  const [soundOn, setSoundOnState] = useState(readPref("lsa-sound"));
  const setSoundOn = (on: boolean) => {
    setSoundOnState(on);
    try { localStorage.setItem("lsa-sound", on ? "1" : "0"); } catch { /* ignore */ }
  };

  useEffect(() => {
    api.currentUser().then((u) => { setUser(u); setReady(true); });
    return api.onAuthChange(setUser);
  }, []);

  useEffect(() => {
    if (!user) { setLiked(new Set()); setReposted(new Set()); return setFollowing(new Set()); }
    api.following().then((shops) => setFollowing(new Set(shops.map((s) => s.id)))).catch(() => {});
    api.reactions().then((r) => { setLiked(new Set(r.liked)); setReposted(new Set(r.reposted)); }).catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3000);
  }, []);

  const toggleFollow = useCallback(async (shopId: string) => {
    const on = following.has(shopId);
    setFollowing((prev) => { const n = new Set(prev); on ? n.delete(shopId) : n.add(shopId); return n; });
    try {
      await (on ? api.unfollow(shopId) : api.follow(shopId));
    } catch (e: any) {
      setFollowing((prev) => { const n = new Set(prev); on ? n.add(shopId) : n.delete(shopId); return n; });
      toast(e?.message ?? "Could not update. Try again.");
    }
  }, [following, toast]);

  const toggleReaction = useCallback(async (postId: string, kind: Reaction) => {
    const set = kind === "like" ? setLiked : setReposted;
    const on = !(kind === "like" ? liked : reposted).has(postId);
    const flip = (add: boolean) => set((prev) => { const n = new Set(prev); add ? n.add(postId) : n.delete(postId); return n; });
    flip(on);
    try {
      await api.react(postId, kind, on);
      if (kind === "repost" && on) toast("Reposted to your profile");
    } catch (e: any) {
      flip(!on);
      toast(e?.message ?? "Could not update. Try again.");
    }
  }, [liked, reposted, toast]);

  const setDataSaver = (on: boolean) => {
    setDataSaverState(on);
    try { localStorage.setItem("lsa-data-saver", on ? "1" : "0"); } catch { /* ignore */ }
  };

  return (
    <Ctx.Provider value={{ user, ready, toast, following, toggleFollow, liked, reposted, toggleReaction, dataSaver, setDataSaver, soundOn, setSoundOn, menuOpen, setMenuOpen }}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);

/** Small helper for screens that load data: returns [data, error, reload]. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): [T | undefined, string | null, () => void] {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    fn().then((d) => live && setData(d)).catch((e) => live && setError(e.message ?? String(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return [data, error, () => setN((x) => x + 1)];
}

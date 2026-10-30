import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Category, type MyProfile, type Reaction, type User } from "./api";
import { keepInterests, savedInterests } from "./lib/rank";

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
  /** Shops whose owner you blocked: hidden from your feed. */
  blockedShops: Set<string>;
  refreshBlocks: () => void;
  /** Lower video quality on mobile data. Saved on this phone only. */
  dataSaver: boolean;
  setDataSaver: (on: boolean) => void;
  /** Video sound for the whole app, like TikTok. Remembered on this phone. */
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** Side menu with settings, opened from the profile. */
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  /** Run `action` now if signed in. Otherwise open the sign in sheet over the current screen and run it straight after. */
  withUser: (action?: () => void, why?: string) => void;
  /** Set while the sign in sheet is open: the reason shown at the top. */
  signInAsk: string | null;
  closeSignIn: () => void;
  /** Categories picked on the welcome screens. Kept on this phone and on the account. */
  interests: Category[];
  setInterests: (list: Category[]) => void;
  /** The signed in person's profile: name, @username, photo. Null while loading or signed out. */
  profile: MyProfile | null;
  refreshProfile: () => Promise<void>;
  /** A new account that still needs its name, username and age check (shown as the Create account steps). */
  needsSetup: boolean;
}

const Ctx = createContext<Session>({
  user: null, ready: false, toast: () => {}, following: new Set(), toggleFollow: async () => {},
  liked: new Set(), reposted: new Set(), toggleReaction: async () => {}, blockedShops: new Set(), refreshBlocks: () => {},
  dataSaver: false, setDataSaver: () => {}, soundOn: false, setSoundOn: () => {}, menuOpen: false, setMenuOpen: () => {},
  withUser: () => {}, signInAsk: null, closeSignIn: () => {}, interests: [], setInterests: () => {},
  profile: null, refreshProfile: async () => {}, needsSetup: false,
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
  const [blockedShops, setBlockedShops] = useState<Set<string>>(new Set());
  const refreshBlocks = useCallback(() => {
    api.blocked().then((b) => setBlockedShops(new Set(b.map((x) => x.shopId).filter((x): x is string => !!x)))).catch(() => {});
  }, []);
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

  const [interests, setInterestsState] = useState<Category[]>(savedInterests());
  const setInterests = useCallback((list: Category[]) => {
    setInterestsState(list);
    keepInterests(list);
    api.saveInterests(list).catch(() => {});
  }, []);
  // Interests picked before signing in follow you onto the account.
  useEffect(() => { if (user && interests.length) api.saveInterests(interests).catch(() => {}); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The profile (name, @username, photo). New accounts have no username yet, so they get the Create account steps.
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const refreshProfile = useCallback(async () => {
    try { setProfile(await api.myProfile()); } catch { setProfile(null); }
  }, []);
  useEffect(() => { if (user) refreshProfile(); else setProfile(null); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsSetup = !!user && !!profile && profile.id === user.id && !profile.setUp;

  // Signing in from a sheet keeps you where you were, then finishes what you tapped (like, follow, buy, message).
  // A brand new account sets up its name and username first, then the action runs.
  const [signInAsk, setSignInAsk] = useState<string | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const withUser = useCallback((action?: () => void, why?: string) => {
    if (user && !needsSetup) return action?.();
    pending.current = action ?? null;
    if (!user) setSignInAsk(why ?? "Sign in to continue");
  }, [user, needsSetup]);
  const closeSignIn = useCallback(() => { pending.current = null; setSignInAsk(null); }, []);
  useEffect(() => { if (user) setSignInAsk(null); }, [user?.id]);
  const ready2 = !!user && !!profile && profile.id === user.id && profile.setUp;
  useEffect(() => {
    if (!ready2) return;
    const act = pending.current;
    pending.current = null;
    if (act) window.setTimeout(act, 50);
  }, [ready2]);

  useEffect(() => {
    if (!user) { setLiked(new Set()); setReposted(new Set()); setBlockedShops(new Set()); return setFollowing(new Set()); }
    api.following().then((shops) => setFollowing(new Set(shops.map((s) => s.id)))).catch(() => {});
    api.reactions().then((r) => { setLiked(new Set(r.liked)); setReposted(new Set(r.reposted)); }).catch(() => {});
    refreshBlocks();
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
    <Ctx.Provider value={{ user, ready, toast, following, toggleFollow, liked, reposted, toggleReaction, blockedShops, refreshBlocks, dataSaver, setDataSaver, soundOn, setSoundOn, menuOpen, setMenuOpen, withUser, signInAsk, closeSignIn, interests, setInterests, profile, refreshProfile, needsSetup }}>
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

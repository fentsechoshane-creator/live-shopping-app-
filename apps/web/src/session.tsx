import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api";

interface Session {
  user: User | null;
  ready: boolean;
  toast: (msg: string) => void;
}

const Ctx = createContext<Session>({ user: null, ready: false, toast: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.currentUser().then((u) => { setUser(u); setReady(true); });
    return api.onAuthChange(setUser);
  }, []);

  const toast = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3200);
  }, []);

  return (
    <Ctx.Provider value={{ user, ready, toast }}>
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

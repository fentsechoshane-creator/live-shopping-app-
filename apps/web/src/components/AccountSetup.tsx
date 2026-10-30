import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { cleanHandle, handleIdeas, handleProblem } from "../lib/handle";
import { squarePhoto } from "../lib/image";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { ErrorNote, useAction } from "./ui";

/** How old someone is today, from a yyyy-mm-dd birthday. */
function ageFrom(birthday: string) {
  const b = new Date(birthday + "T00:00:00");
  if (Number.isNaN(b.getTime())) return -1;
  const t = new Date();
  return t.getFullYear() - b.getFullYear() - (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate()) ? 1 : 0);
}

/**
 * Create account, after the email code, like Instagram and TikTok:
 * 1. Birthday (an age check: 18 and over; the date itself isn't saved).
 * 2. Name and a unique @username, checked while you type, with free suggestions. Agreeing to the terms.
 * 3. Profile photo (optional).
 */
export function AccountSetup() {
  const { user, profile, refreshProfile, toast } = useSession();
  const [step, setStep] = useState(0);
  const [birthday, setBirthday] = useState("");
  const age = birthday ? ageFrom(birthday) : null;
  const tooYoung = age !== null && age >= 0 && age < 18;
  const startName = profile?.displayName && !profile.displayName.includes("@") ? profile.displayName : "";
  const [name, setName] = useState(startName);
  const [handle, setHandle] = useState("");
  const [touched, setTouchedState] = useState(false);
  const touchedRef = useRef(false); // read inside timers, so a late suggestion never overwrites what was typed
  const setTouched = (v: boolean) => { touchedRef.current = v; setTouchedState(v); };
  const [check, setCheck] = useState<{ handle: string; free: boolean } | null>(null);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, error, run, setError } = useAction();

  // Username ideas from the name (and email), keeping only the free ones.
  const candidates = useMemo(() => handleIdeas(name || startName, user?.email), [name, user?.email]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (step !== 1) return;
    const t = window.setTimeout(() => {
      api.availableHandles(candidates).then((free) => {
        setIdeas(free.slice(0, 4));
        if (!touchedRef.current && free[0]) setHandle(free[0]); // suggest the first free one until they type their own
      }).catch(() => {});
    }, 300);
    return () => window.clearTimeout(t);
  }, [candidates, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live check of the username being typed.
  const problem = handle ? handleProblem(handle) : null;
  useEffect(() => {
    setCheck(null);
    if (!handle || problem) return;
    const t = window.setTimeout(() => {
      api.availableHandles([handle]).then((free) => setCheck({ handle, free: free.includes(handle) })).catch(() => {});
    }, 350);
    return () => window.clearTimeout(t);
  }, [handle, problem]);
  const taken = check?.handle === handle && !check.free;
  const free = check?.handle === handle && check.free;

  const create = () => run(async () => {
    await api.completeAccount(name.trim(), handle, !tooYoung && age !== null && age >= 18, true);
    setStep(2);
  });
  const finish = (withPhoto: boolean) => run(async () => {
    if (withPhoto && photo) await api.setAvatar(photo.blob);
    await refreshProfile();
    toast(`Welcome to myHaul, @${handle}`);
  });
  const pick = async (f: File | undefined) => {
    if (!f) return;
    const blob = await squarePhoto(f);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
  };

  return (
    <div className="setup" role="dialog" aria-modal="true" aria-label="Create your account">
      <div className="setup-top">
        {step === 1 ? <button className="bare" onClick={() => { setError(null); setStep(0); }} aria-label="Back"><Icon name="back" /></button> : <span />}
        <span className="welcome-dots dark" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className={i === step ? "on" : ""} />)}</span>
        {step === 0 ? <button className="link" onClick={() => api.signOut()}>Log out</button> : <span />}
      </div>

      {step === 0 && (
        <form className="setup-body" onSubmit={(e) => { e.preventDefault(); if (age !== null && age >= 18) setStep(1); }}>
          <h1>When's your birthday?</h1>
          <p className="muted">It isn't shown on your profile. We only use it to check you're 18 or older.</p>
          <label className="visually-hidden" htmlFor="bday">Birthday</label>
          <input id="bday" className="setup-input" type="date" value={birthday} max={new Date().toISOString().slice(0, 10)} min="1900-01-01"
            onChange={(e) => setBirthday(e.target.value)} />
          {tooYoung && <div className="error" role="alert">You need to be 18 or older to use myHaul.</div>}
          <div className="setup-foot">
            <button className="btn green block big" disabled={age === null || age < 18}>Next</button>
          </div>
        </form>
      )}

      {step === 1 && (
        <form className="setup-body" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <h1>Pick your name and username</h1>
          <p className="muted">Your username is how people find and tag you. You can change it later, once every 30 days.</p>
          <ErrorNote error={error} />
          <label className="setup-label" htmlFor="setup-name">Name</label>
          <input id="setup-name" className="setup-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
            autoComplete="name" placeholder="Your name" enterKeyHint="next" autoFocus />
          <label className="setup-label" htmlFor="setup-handle">Username</label>
          <div className={`handle-input ${free ? "ok" : taken || (touched && problem) ? "bad" : ""}`}>
            <span>@</span>
            <input id="setup-handle" value={handle} onChange={(e) => { setTouched(true); setHandle(cleanHandle(e.target.value)); }}
              autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={30} placeholder="username" aria-describedby="handle-status" />
            {free && <span className="state ok" aria-hidden="true"><Icon name="check" size={16} strokeWidth={3} /></span>}
            {taken && <span className="state bad" aria-hidden="true"><Icon name="close" size={16} strokeWidth={3} /></span>}
          </div>
          <div id="handle-status" className={`small ${free ? "ok-text" : "bad-text"}`} aria-live="polite">
            {touched && problem ? problem : taken ? `@${handle} is taken. Try one of these:` : free ? `@${handle} is available` : " "}
          </div>
          {ideas.filter((i) => i !== handle).length > 0 && (
            <div className="chips" style={{ marginTop: 6 }} role="group" aria-label="Free usernames">
              {ideas.filter((i) => i !== handle).slice(0, 3).map((i) => <button key={i} type="button" className="chip" onClick={() => { setTouched(true); setHandle(i); }}>@{i}</button>)}
            </div>
          )}
          <div className="setup-foot">
            <p className="small muted" style={{ textAlign: "center", margin: "0 0 10px" }}>
              By tapping Create account, you agree to our <a href="/privacy.html" target="_blank" rel="noreferrer">Terms and Privacy Policy</a>.
            </p>
            <button className="btn green block big" disabled={busy || !name.trim() || !free}>{busy ? "Creating…" : "Create account"}</button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="setup-body" style={{ alignItems: "center", textAlign: "center" }}>
          <h1>Add a profile photo</h1>
          <p className="muted">Buyers and sellers trust faces. You can change it any time.</p>
          <ErrorNote error={error} />
          <button className="setup-photo" onClick={() => fileRef.current?.click()} aria-label={photo ? "Change photo" : "Choose a photo"}>
            {photo ? <Avatar url={photo.url} name={name} className="pavatar big" /> : <span className="pavatar big empty"><Icon name="user" size={44} /></span>}
            <span className="cam"><Icon name="plus" size={16} strokeWidth={3} /></span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <b style={{ marginTop: 10 }}>{name}</b>
          <span className="muted">@{handle}</span>
          <div className="setup-foot" style={{ width: "100%" }}>
            {photo
              ? <button className="btn green block big" disabled={busy} onClick={() => finish(true)}>{busy ? "Saving…" : "Done"}</button>
              : <button className="btn green block big" onClick={() => fileRef.current?.click()}>Choose a photo</button>}
            <button className="link" style={{ marginTop: 14 }} disabled={busy} onClick={() => finish(false)}>Skip for now</button>
          </div>
        </div>
      )}
    </div>
  );
}

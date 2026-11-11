// Sign in and Sign up, as two tabs (Ofentse, 11 Nov 2026).
// Sign in: username or email, and password. Forgot password: a code by email, then a new password.
// Sign up: everything is checked on this one page before the account is made:
//   name, email (confirmed with a 6 digit code, or the link in the email), a free @username, password twice,
//   birthday (18 or older) and the terms. Then Sign up, then the optional steps (photo, delivery address).
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { cleanHandle, handleIdeas, handleProblem } from "../lib/handle";
import { passwordChecks, passwordProblem } from "../lib/password";
import { ageFrom, BirthdayPicker } from "./AccountSetup";
import { Icon } from "./Icon";
import { ErrorNote, Field, FieldWith, Segmented, useAction } from "./ui";

type Tab = "in" | "up";
const SEEN = "myhaul-has-account";
const seenBefore = () => { try { return localStorage.getItem(SEEN) === "1"; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN, "1"); } catch { /* private mode */ } };

export function AuthForm({ onDone, start }: { onDone: () => void; start?: Tab }) {
  const [tab, setTab] = useState<Tab>(start ?? (seenBefore() ? "in" : "up"));
  return (
    <div className="auth">
      <Segmented<Tab> label="Sign in or sign up" value={tab} onChange={setTab} options={[{ value: "in", label: "Sign in" }, { value: "up", label: "Sign up" }]} />
      {api.mode === "demo" && <div className="note amber" style={{ margin: "12px 0 0" }}>Demo: the email code is <b>123456</b>. Older demo accounts sign in with the password <b>123456</b>. To try the seller side, sign in as <b>lebo@shop.demo</b>.</div>}
      {tab === "in" ? <SignInTab onDone={() => { markSeen(); onDone(); }} toSignUp={() => setTab("up")} />
        : <SignUpTab onDone={() => { markSeen(); onDone(); }} toSignIn={() => setTab("in")} />}
    </div>
  );
}

/** A password box with a Show button. */
function PasswordInput({ value, onChange, label, autoComplete }: { value: string; onChange: (v: string) => void; label: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <FieldWith label={label}>{(id) => (
      <span className="pw-input">
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} type={show ? "text" : "password"} autoComplete={autoComplete} maxLength={72} />
        <button type="button" className="link" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button>
      </span>
    )}</FieldWith>
  );
}

/** Ticks under the password: 8 or more characters, a letter and a number, and both boxes the same. */
function PasswordRules({ password, again }: { password: string; again?: string }) {
  const rows = [...passwordChecks(password), ...(again !== undefined ? [{ ok: !!again && again === password, label: "Both passwords match" }] : [])];
  return (
    <ul className="pw-rules" aria-live="polite">
      {rows.map((r) => <li key={r.label} className={r.ok ? "ok" : ""}><span className="tick" aria-hidden="true">{r.ok && <Icon name="check" size={11} strokeWidth={3.4} />}</span><span className="visually-hidden">{r.ok ? "Done: " : "Needed: "}</span>{r.label}</li>)}
    </ul>
  );
}

function SignInTab({ onDone, toSignUp }: { onDone: () => void; toSignUp: () => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const { busy, error, run } = useAction();
  if (forgot) return <ForgotPassword email={login.includes("@") ? login : ""} onDone={onDone} onBack={() => setForgot(false)} />;
  return (
    <form className="auth-body" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.signInWithPassword(login, password); onDone(); }); }}>
      <ErrorNote error={error} />
      <Field label="Username or email">
        <input value={login} onChange={(e) => setLogin(e.target.value.trim())} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          autoComplete="username" inputMode="email" placeholder="@username or you@example.com" required />
      </Field>
      <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      <button className="btn green block big" disabled={busy || login.length < 3 || !password}>{busy ? "Signing in…" : "Sign in"}</button>
      <div className="row between" style={{ marginTop: 14 }}>
        <button type="button" className="link" onClick={() => setForgot(true)}>Forgot password?</button>
        <button type="button" className="link" onClick={toSignUp}>New here? Sign up</button>
      </div>
    </form>
  );
}

/** Forgot password (and accounts made before passwords): a code by email, then pick a new password. */
function ForgotPassword({ email: start, onDone, onBack }: { email: string; onDone: () => void; onBack: () => void }) {
  const { toast } = useSession();
  const [email, setEmail] = useState(start);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const { busy, error, run } = useAction();
  const verify = (c: string) => run(async () => { await api.verifyCode(email, c); setStep("password"); });
  return (
    <div className="auth-body">
      <button type="button" className="link back-link" onClick={onBack}><Icon name="back" size={16} />Back to sign in</button>
      <ErrorNote error={error} />
      {step === "email" && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.sendCode(email, { create: false }); setStep("code"); }); }}>
          <p className="muted" style={{ marginTop: 0 }}>We'll email you a 6 digit code. Then you pick a new password.</p>
          <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value.trim())} type="email" inputMode="email" autoComplete="email" required autoFocus /></Field>
          <button className="btn green block big" disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Email me a code"}</button>
        </form>
      )}
      {step === "code" && (
        <form onSubmit={(e) => { e.preventDefault(); verify(code); }}>
          <p className="muted" style={{ marginTop: 0 }}>Type the 6 digit code we sent to {email}.</p>
          <Field label="Code"><input value={code} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6 && !busy) verify(v); }}
            inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus /></Field>
          <button className="btn green block big" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Next"}</button>
          <button type="button" className="link" style={{ marginTop: 14 }} disabled={busy} onClick={() => run(async () => { await api.sendCode(email, { create: false }); setCode(""); toast("New code sent"); })}>Send a new code</button>
        </form>
      )}
      {step === "password" && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.setPassword(password); toast("Password saved. You're signed in."); onDone(); }); }}>
          <p className="muted" style={{ marginTop: 0 }}>Pick a new password. You'll use it with your username or email next time.</p>
          <PasswordInput label="New password" value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordInput label="New password again" value={again} onChange={setAgain} autoComplete="new-password" />
          <PasswordRules password={password} again={again} />
          <button className="btn green block big" disabled={busy || !!passwordProblem(password) || password !== again}>{busy ? "Saving…" : "Save and sign in"}</button>
        </form>
      )}
    </div>
  );
}

function SignUpTab({ onDone, toSignIn }: { onDone: () => void; toSignIn: () => void }) {
  const { user, setSigningUp, setAfterSignUp, refreshProfile, toast } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [handle, setHandle] = useState("");
  const [touched, setTouched] = useState(false);
  const [check, setCheck] = useState<{ handle: string; free: boolean } | null>(null);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [birthday, setBirthday] = useState("");
  const age = birthday ? ageFrom(birthday) : null;
  const code$ = useAction();
  const { busy, error, run } = useAction();
  const verifying = useRef(false);

  // While this form has a confirmed email, the separate Create account screens stay away.
  useEffect(() => () => setSigningUp(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendCode = () => code$.run(async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Check your email address.");
    await api.sendCode(email, { create: true });
    setCodeSent(true); setCode("");
  });
  const verify = (c: string) => {
    if (verifying.current) return;
    verifying.current = true;
    setSigningUp(true);
    code$.run(async () => {
      try {
        await api.verifyCode(email, c);
        // This email already has a finished account: they're signed in, so just carry on.
        const p = await api.myProfile().catch(() => null);
        if (p?.setUp) { setSigningUp(false); await refreshProfile(); toast(`You already have an account, @${p.handle}. You're signed in.`); onDone(); return; }
        setVerified(true);
      } catch (e) { setSigningUp(false); throw e; } finally { verifying.current = false; }
    });
  };
  // The link in the email works too: it signs this browser in, which counts as confirmed.
  useEffect(() => {
    if (!user || verified || !codeSent) return;
    if ((user.email ?? "").toLowerCase() === email.toLowerCase()) { setSigningUp(true); setVerified(true); }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Username: suggestions from the name and email, and a live check of what's typed.
  const candidates = useMemo(() => handleIdeas(name, email.includes("@") ? email : undefined), [name, email]);
  useEffect(() => {
    if (!name && !email) return;
    const t = window.setTimeout(() => {
      api.availableHandles(candidates).then((free) => { setIdeas(free.slice(0, 4)); if (!touched && free[0]) setHandle(free[0]); }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [candidates]); // eslint-disable-line react-hooks/exhaustive-deps
  const problem = handle ? handleProblem(handle) : null;
  useEffect(() => {
    setCheck(null);
    if (!handle || problem) return;
    const t = window.setTimeout(() => { api.availableHandles([handle]).then((free) => setCheck({ handle, free: free.includes(handle) })).catch(() => {}); }, 350);
    return () => window.clearTimeout(t);
  }, [handle, problem]);
  const free = check?.handle === handle && check.free;
  const taken = check?.handle === handle && !check.free;

  const missing = [
    !name.trim() && "your name",
    !verified && "a confirmed email",
    !free && "a free username",
    (!!passwordProblem(password) || password !== again) && "a password",
    !(age !== null && age >= 18) && "your birthday",
  ].filter(Boolean) as string[];

  const signUp = () => run(async () => {
    await api.setPassword(password);
    await api.completeAccount(name.trim(), handle, true, true);
    await refreshProfile();
    setSigningUp(false);
    setAfterSignUp(true); // the optional photo and delivery steps, with Skip for now
    onDone();
  });

  return (
    <form className="auth-body" onSubmit={(e) => { e.preventDefault(); if (!missing.length) signUp(); }}>
      <ErrorNote error={error} />
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" placeholder="Your name" /></Field>

      <FieldWith label="Email">{(id) => (
        <span className={`email-input ${verified ? "ok" : ""}`}>
          <input id={id} value={email} onChange={(e) => { setEmail(e.target.value.trim()); setCodeSent(false); }} type="email" inputMode="email" autoComplete="email"
            placeholder="you@example.com" readOnly={verified} aria-describedby="email-status" />
          {verified ? <span className="state ok"><Icon name="check" size={16} strokeWidth={3} /></span>
            : <button type="button" className="btn green small" disabled={code$.busy || !email.includes("@")} onClick={sendCode}>{codeSent ? "Resend" : "Send code"}</button>}
        </span>
      )}</FieldWith>
      <div id="email-status" className={`small ${verified ? "ok-text" : "muted"}`} style={{ margin: "-6px 2px 10px" }} aria-live="polite">
        {verified ? "Email confirmed" : codeSent ? `We sent a 6 digit code to ${email}. Type it below, or tap the link in the email.` : "We'll send a code to confirm it's yours."}
      </div>
      <ErrorNote error={code$.error} />
      {codeSent && !verified && (
        <Field label="Code from the email">
          <input value={code} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6) verify(v); }}
            inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" autoFocus />
        </Field>
      )}

      <FieldWith label="Username">{(id) => (
        <span className={`handle-input ${free ? "ok" : taken || (touched && problem) ? "bad" : ""}`}>
          <span>@</span>
          <input id={id} value={handle} onChange={(e) => { setTouched(true); setHandle(cleanHandle(e.target.value)); }} autoCapitalize="none" autoCorrect="off"
            spellCheck={false} maxLength={30} placeholder="username" aria-describedby="handle-status" autoComplete="off" />
          {free && <span className="state ok" aria-hidden="true"><Icon name="check" size={16} strokeWidth={3} /></span>}
          {taken && <span className="state bad" aria-hidden="true"><Icon name="close" size={16} strokeWidth={3} /></span>}
        </span>
      )}</FieldWith>
      <div id="handle-status" className={`small ${free ? "ok-text" : "bad-text"}`} style={{ margin: "-6px 2px 8px" }} aria-live="polite">
        {touched && problem ? problem : taken ? `@${handle} is taken. Try one of these:` : free ? `@${handle} is available` : " "}
      </div>
      {ideas.filter((i) => i !== handle).length > 0 && (taken || !handle) && (
        <div className="chips" style={{ margin: "0 0 10px" }} role="group" aria-label="Free usernames">
          {ideas.filter((i) => i !== handle).slice(0, 3).map((i) => <button key={i} type="button" className="chip" onClick={() => { setTouched(true); setHandle(i); }}>@{i}</button>)}
        </div>
      )}

      <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="new-password" />
      <PasswordInput label="Password again" value={again} onChange={setAgain} autoComplete="new-password" />
      <PasswordRules password={password} again={again} />

      <div className="field"><label>Birthday</label>
        <BirthdayPicker value={birthday} onChange={setBirthday} />
        <div className={`small ${age === null ? "muted" : age < 18 ? "bad-text" : "ok-text"}`} style={{ margin: "6px 2px 0", textAlign: "center" }} role={age !== null && age < 18 ? "alert" : undefined}>
          {age === null ? "Only to check you're 18 or older. Never shown." : age < 18 ? "You need to be 18 or older to use myHaul." : `You're ${age}`}
        </div>
      </div>

      <p className="small muted" style={{ textAlign: "center", margin: "16px 0 10px" }}>
        By tapping Sign up, you agree to our <a href="/terms.html" target="_blank" rel="noreferrer">Terms of Use</a> and <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.
      </p>
      <button className="btn green block big" disabled={busy || missing.length > 0}>{busy ? "Making your account…" : "Sign up"}</button>
      {missing.length > 0 && <p className="small muted" style={{ textAlign: "center", margin: "8px 0 0" }}>Still needed: {missing.join(", ")}.</p>}
      <button type="button" className="link" style={{ marginTop: 14, display: "block", marginInline: "auto" }} onClick={toSignIn}>Already have an account? Sign in</button>
    </form>
  );
}

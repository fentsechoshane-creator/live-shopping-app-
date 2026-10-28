import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Category, type MyShop } from "../../api";
import { useSession } from "../../session";
import { Choice, ErrorNote, Field, Loading, Progress, useAction } from "../../components/ui";

const CATEGORIES: { id: Category; title: string; sub: string }[] = [
  { id: "clothes", title: "Clothes and thrift", sub: "Pre loved and new fashion" },
  { id: "beauty", title: "Hair and beauty", sub: "Bundles, wigs and skincare" },
  { id: "food", title: "Food and bakes", sub: "Made to order in Cape Town" },
  { id: "designer", title: "Designer resale", sub: "Checked for authenticity" },
];
const BANKS = ["Absa", "Capitec", "FNB", "Nedbank", "Standard Bank", "TymeBank", "African Bank", "Discovery Bank", "Investec"];
const RULES = [
  ["Pack every order on video", "It protects you if a buyer says something was missing."],
  ["Show every flaw", "Items that do not match the listing can be returned."],
  ["Ship within 2 days", "Unshipped orders are refunded automatically after 3 days."],
  ["No fakes or replicas", "Copies of brands are counterfeit goods. Your shop is closed if you sell them."],
  ["6% fee per sale", "Only when you sell. No monthly fees. You are paid once the buyer's return window closes."],
];

export function Onboarding() {
  const [shop, setShop] = useState<MyShop | null | undefined>(undefined);
  const [category, setCategory] = useState<Category | null>(null);
  const [step, setStep] = useState(1);
  const nav = useNavigate();
  const reload = () => api.myShop().then((s) => {
    setShop(s);
    if (!s) return setStep(category ? 2 : 1);
    if (s.status !== "onboarding") return nav("/sell", { replace: true });
    if (s.checks.idStatus === "not_started") return setStep(3);
    if (s.checks.bankStatus === "not_started") return setStep(4);
    setStep(5);
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);
  if (shop === undefined) return <div className="screen"><Loading /></div>;

  return (
    <div className="screen">
      <div className="row between">
        <button className="link" onClick={() => (step > 1 && step <= 2 ? setStep(step - 1) : nav("/me"))}>← Back</button>
        <span className="small muted">You can finish later</span>
      </div>
      <Progress step={step} of={5} />
      <div className="step-label">Step {step} of 5</div>
      {step === 1 && <StepCategory value={category} onPick={(c) => { setCategory(c); setStep(2); }} />}
      {step === 2 && <StepName category={category ?? shop?.category ?? "clothes"} onDone={reload} />}
      {step === 3 && <StepId food={shop?.category === "food"} onDone={reload} />}
      {step === 4 && <StepBank onDone={reload} />}
      {step === 5 && <StepRules onDone={() => nav("/sell", { replace: true })} />}
    </div>
  );
}

function StepCategory({ value, onPick }: { value: Category | null; onPick: (c: Category) => void }) {
  return (
    <>
      <h1>What will you sell?</h1>
      <p className="muted">Pick your main category. It sets the right rules, like food safety for bakers.</p>
      {CATEGORIES.map((c) => <Choice key={c.id} on={value === c.id} onClick={() => onPick(c.id)} title={c.title} sub={c.sub} />)}
    </>
  );
}

function StepName({ category, onDone }: { category: Category; onDone: () => void }) {
  const { user } = useSession();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const { busy, error, run } = useAction();
  useEffect(() => { if (!handle) setHandle(name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 30)); }, [name]); // eslint-disable-line
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.startShop(name.trim(), handle, category); onDone(); }); }}>
      <h1>Name your shop</h1>
      <p className="muted">Buyers see this on every video. Signed in as {user?.email ?? user?.phone}.</p>
      <ErrorNote error={error} />
      <Field label="Shop name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></Field>
      <Field label="Shop handle" hint="Letters, numbers and dots. Your link: /s/handle">
        <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} pattern="[a-z0-9._]{3,30}" required />
      </Field>
      <button className="btn green block big" disabled={busy}>Continue</button>
    </form>
  );
}

function StepId({ food, onDone }: { food: boolean; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [idDoc, setIdDoc] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const { busy, error, run } = useAction();
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.submitId(phone, idDoc!, selfie!); onDone(); }); }}>
      <h1>Verify your ID</h1>
      <p className="muted">Every seller is verified. It keeps fake shops and scams out. Your ID is only seen by our team.</p>
      <ErrorNote error={error} />
      <Field label="Cell number"><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" required /></Field>
      <Field label="Photo of your ID or passport"><input type="file" accept="image/*,application/pdf" onChange={(e) => setIdDoc(e.target.files?.[0] ?? null)} required /></Field>
      <Field label="Selfie holding your ID"><input type="file" accept="image/*" capture="user" onChange={(e) => setSelfie(e.target.files?.[0] ?? null)} required /></Field>
      {food && <div className="note" style={{ marginBottom: 14 }}>Bakers: you will also upload your Certificate of Acceptability before you can take orders.</div>}
      <button className="btn green block big" disabled={busy || !idDoc || !selfie}>{busy ? "Uploading…" : "Continue"}</button>
    </form>
  );
}

function StepBank({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ bankName: "", accountNumber: "", accountType: "SAVINGS" as "SAVINGS" | "CHEQUE", givenName: "", familyName: "", idNumber: "" });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.addBank({ ...f, idNumber: f.idNumber || undefined }); onDone(); }); }}>
      <h1>Where we pay you</h1>
      <p className="muted">Your bank details go straight to our escrow partner, TradeSafe. We only keep the last 4 digits.</p>
      <ErrorNote error={error} />
      <Field label="Bank"><select value={f.bankName} onChange={set("bankName")} required><option value="">Pick your bank</option>{BANKS.map((b) => <option key={b}>{b}</option>)}</select></Field>
      <Field label="Account number"><input value={f.accountNumber} onChange={set("accountNumber")} inputMode="numeric" required /></Field>
      <Field label="Account type"><select value={f.accountType} onChange={set("accountType")}><option value="SAVINGS">Savings</option><option value="CHEQUE">Cheque or current</option></select></Field>
      <div className="row">
        <div className="grow"><Field label="First name"><input value={f.givenName} onChange={set("givenName")} autoComplete="given-name" required /></Field></div>
        <div className="grow"><Field label="Surname"><input value={f.familyName} onChange={set("familyName")} autoComplete="family-name" required /></Field></div>
      </div>
      <Field label="SA ID number (optional)" hint="Helps the escrow partner match your account faster."><input value={f.idNumber} onChange={set("idNumber")} inputMode="numeric" maxLength={13} /></Field>
      <button className="btn green block big" disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
    </form>
  );
}

function StepRules({ onDone }: { onDone: () => void }) {
  const [ticked, setTicked] = useState<boolean[]>(RULES.map(() => false));
  const { busy, error, run } = useAction();
  const all = ticked.every(Boolean);
  return (
    <>
      <h1>Seller rules</h1>
      <p className="muted">Tick each one to open your shop.</p>
      <ErrorNote error={error} />
      {RULES.map(([t, s], i) => (
        <button key={t} type="button" className="choice" aria-pressed={ticked[i]} onClick={() => setTicked(ticked.map((v, j) => (j === i ? !v : v)))}>
          <span className="row" style={{ alignItems: "flex-start" }}>
            <span className={`dot ${ticked[i] ? "done" : ""}`}>{ticked[i] ? "✓" : ""}</span>
            <span><b>{t}</b><small>{s}</small></span>
          </span>
        </button>
      ))}
      <button className="btn green block big" disabled={!all || busy} onClick={() => run(async () => { await api.acceptRules(); await api.openShop(); onDone(); })}>Open my shop</button>
    </>
  );
}

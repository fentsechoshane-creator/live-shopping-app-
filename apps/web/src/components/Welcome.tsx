import { useState } from "react";
import { WELCOME_CREDIT } from "@app/core";
import type { Category } from "../api";
import { Icon } from "./Icon";
import { R } from "./ui";
import { useSwipe } from "./gestures";
import { useSession } from "../session";

const WELCOMED = "lsa-welcomed";
export const hasSeenWelcome = () => { try { return localStorage.getItem(WELCOMED) === "1"; } catch { return true; } };

const INTERESTS: { id: Category; label: string; sub: string }[] = [
  { id: "clothes", label: "Thrift", sub: "Pre loved and vintage" },
  { id: "designer", label: "Designer", sub: "Checked resale" },
  { id: "beauty", label: "Hair and beauty", sub: "Wigs, skin, nails" },
  { id: "food", label: "Bakes", sub: "Cakes made to order" },
];

const SLIDES = [
  { icon: "play", title: "Shop from short videos", body: "Watch local sellers show the real item. See something you like? Tap Buy now without leaving the video." },
  { icon: "shield", title: "Your money is held safely", body: "We only pay the seller after your return window closes. Change your mind on a Buy now item? Send it back within 7 days." },
  { icon: "wallet", title: `${R(WELCOME_CREDIT)} off your first order`, body: `Welcome credit comes off by itself on a first order of R200 or more. Nothing to type in.` },
];

/** First open: three short screens, then pick what you like so For You isn't random on day one. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const { interests, setInterests } = useSession();
  const [picked, setPicked] = useState<Category[]>(interests);
  const last = step === SLIDES.length;
  const finish = (list: Category[]) => {
    setInterests(list);
    try { localStorage.setItem(WELCOMED, "1"); } catch { /* ignore */ }
    onDone();
  };
  const swipe = useSwipe({ onLeft: () => !last && setStep(step + 1), onRight: () => step > 0 && setStep(step - 1) });
  const toggle = (c: Category) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-label="Welcome to myHaul" {...swipe}>
      <div className="welcome-top">
        <span className="welcome-dots" aria-hidden="true">{[...SLIDES, null].map((_, i) => <span key={i} className={i === step ? "on" : ""} />)}</span>
        {!last && <button className="link on-dark" onClick={() => setStep(SLIDES.length)}>Skip</button>}
      </div>
      {!last ? (
        <div className="welcome-body" key={step}>
          <span className="welcome-icon vglass"><Icon name={SLIDES[step].icon} size={30} /></span>
          <h1>{SLIDES[step].title}</h1>
          <p>{SLIDES[step].body}</p>
        </div>
      ) : (
        <div className="welcome-body" key="pick">
          <h1>What do you like?</h1>
          <p>Pick as many as you want. We'll show you more of these first.</p>
          <div className="interest-grid" role="group" aria-label="Interests">
            {INTERESTS.map((c) => (
              <button key={c.id} type="button" className="interest vglass" aria-pressed={picked.includes(c.id)} onClick={() => toggle(c.id)}>
                <b>{c.label}</b><span>{c.sub}</span>
                {picked.includes(c.id) && <span className="tick"><Icon name="check" size={14} strokeWidth={3} /></span>}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="welcome-foot">
        {!last
          ? <button className="btn green block big" onClick={() => setStep(step + 1)}>Next</button>
          : <button className="btn green block big" onClick={() => finish(picked)}>{picked.length ? "Start watching" : "Show me everything"}</button>}
      </div>
    </div>
  );
}

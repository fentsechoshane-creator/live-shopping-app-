import { useEffect, useState } from "react";
import type { Category } from "../api";
import { Icon } from "./Icon";
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
  { icon: "check", title: "Every seller is checked", body: "We check each seller's ID and bank account before they can sell, and every order is filmed when it's packed." },
];

/** First open: three short screens, pick what you like (so For You isn't random on day one), then a TikTok style
 * "swipe up" lesson over the feed. Swiping it away lands on the first video the ranking picked for you. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const { interests, setInterests } = useSession();
  const [picked, setPicked] = useState<Category[]>(interests);
  const PICK = SLIDES.length, COACH = SLIDES.length + 1;
  const finish = () => {
    try { localStorage.setItem(WELCOMED, "1"); } catch { /* ignore */ }
    onDone();
  };
  // Saving the interests here re-ranks the feed behind the lesson, so the first video is already the right one.
  const toCoach = () => { setInterests(picked); setStep(COACH); };
  const swipe = useSwipe({ onLeft: () => step < PICK && setStep(step + 1), onRight: () => step > 0 && step <= PICK && setStep(step - 1) });
  const coachSwipe = useSwipe({ onUp: finish, threshold: 40 });
  const toggle = (c: Category) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  // Laptops and keyboards: scroll or press down to do the same.
  useEffect(() => {
    if (step !== COACH) return;
    const key = (e: KeyboardEvent) => { if (["ArrowDown", "ArrowUp", " ", "Enter", "PageDown"].includes(e.key)) { e.preventDefault(); finish(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  if (step === COACH) return (
    <div className="coach" role="dialog" aria-modal="true" aria-label="How to watch" {...coachSwipe}
      onWheel={(e) => { if (Math.abs(e.deltaY) > 20) finish(); }}>
      <div className="coach-hand" aria-hidden="true">
        <span className="coach-trail" />
        <span className="coach-finger" />
      </div>
      <h1>Swipe up for more</h1>
      <p>Every video is something you can buy. Swipe up to see the next one, and tap Buy now when you find something you love.</p>
      <button className="visually-hidden" onClick={finish}>Start watching</button>
    </div>
  );

  const last = step === PICK;
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-label="Welcome to myHaul" {...swipe}>
      <div className="welcome-top">
        <span className="welcome-dots" aria-hidden="true">{[...SLIDES, null].map((_, i) => <span key={i} className={i === step ? "on" : ""} />)}</span>
        {!last && <button className="link on-dark" onClick={() => setStep(PICK)}>Skip</button>}
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
        <button className="btn green block big" onClick={() => (last ? toCoach() : setStep(step + 1))}>
          {!last ? "Next" : picked.length ? "Next" : "Show me everything"}
        </button>
      </div>
    </div>
  );
}

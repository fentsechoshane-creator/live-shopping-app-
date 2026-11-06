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

/** Three quick screens: a word or two and a small picture each, over the real feed. */
const SLIDES: { title: string; line: string; art: "buy" | "safe" | "checked" }[] = [
  { title: "Watch. Tap. Buy.", line: "Real sellers, real items, on video.", art: "buy" },
  { title: "Your money is safe", line: "The seller is paid after your return window.", art: "safe" },
  { title: "Checked sellers", line: "ID, bank and every parcel on video.", art: "checked" },
];

function SlideArt({ art }: { art: (typeof SLIDES)[number]["art"] }) {
  if (art === "buy") return (
    <div className="wart wart-buy" aria-hidden="true">
      <span className="wart-play vglass"><Icon name="play" size={22} /></span>
      <span className="wart-chip vglass"><span className="sw" /><b>Denim jacket</b><em>R450</em></span>
      <span className="wart-btn"><Icon name="bag" size={15} />Buy now</span>
    </div>
  );
  if (art === "safe") return (
    <div className="wart wart-safe" aria-hidden="true">
      <span className="wart-shield"><Icon name="shield" size={34} /></span>
      <span className="wart-steps">
        <i className="on">Paid</i><span /><i className="on">Held</i><span /><i>Seller paid</i>
      </span>
    </div>
  );
  return (
    <div className="wart wart-checked" aria-hidden="true">
      {["ID checked", "Bank checked", "Packed on video"].map((t, i) => (
        <span key={t} className="wart-tick vglass" style={{ animationDelay: `${i * 120}ms` }}><Icon name="check" size={14} strokeWidth={3} />{t}</span>
      ))}
    </div>
  );
}

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
        <svg className="coach-finger" viewBox="0 0 24 24" width="44" height="44">
          <path d="M10 9.5V4a2 2 0 0 0-4 0v10l-1.4-1.4a2 2 0 0 0-2.8 2.8l3.6 3.6C6.9 20.5 8.7 22 12 22h2a8 8 0 0 0 8-8v-3a2 2 0 0 0-4 0v-1a2 2 0 0 0-4 0v-1a2 2 0 0 0-4 0z"
            fill="#fff" stroke="rgba(0,0,0,0.55)" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="coach-label vglass">Swipe up</span>
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
          <SlideArt art={SLIDES[step].art} />
          <h1>{SLIDES[step].title}</h1>
          <p>{SLIDES[step].line}</p>
        </div>
      ) : (
        <div className="welcome-body" key="pick">
          <h1>What do you like?</h1>
          <p>Pick any. We'll show these first.</p>
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

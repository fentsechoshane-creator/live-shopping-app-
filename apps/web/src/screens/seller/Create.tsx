import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LISTING_LABELS, rand, validateListing, type Condition, type ListingLabel } from "@app/core";
import { api, type MyShop } from "../../api";
import { useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { ErrorNote, R, useAction } from "../../components/ui";

const CONDITIONS: { value: Condition; label: string }[] = [
  { value: "like_new", label: "Like new" }, { value: "good", label: "Good" }, { value: "fair", label: "Fair" },
];
const QUICK_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const STEPS = ["Media", "What is it", "Price", "More", "Review"] as const;

/**
 * Create a listing one small step at a time, like Vinted and Depop:
 * 0 photo or video, 1 what it is, 2 price and stock, 3 extra details (optional), 4 review and post.
 * Step 0 is the first page (the Camera, Create, Live switch shows); later steps hide it and Back goes one step back.
 */
export function CreateListing({ shop, media, onMedia, onCamera, onStep }: {
  shop: MyShop; media: File | null; onMedia: (f: File | null) => void; onCamera: () => void; onStep: (step: number) => void;
}) {
  const food = shop.category === "food";
  const founding = !!shop.foundingUntil && new Date(shop.foundingUntil) > new Date();
  const [step, setStepState] = useState(media ? 1 : 0);
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState<ListingLabel>("new");
  const [condition, setCondition] = useState<Condition | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState(1);
  const [sizes, setSizes] = useState<string[]>([]);
  const [leadDays, setLeadDays] = useState(2);
  const [allergens, setAllergens] = useState("");
  const [description, setDescription] = useState("");
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState(0);
  const { busy, error, run, setError } = useAction();
  const { toast } = useSession();
  const nav = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);

  const setStep = (n: number) => { setError(null); setStepState(n); bodyRef.current?.scrollTo({ top: 0 }); };
  useEffect(() => onStep(step), [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const priceCents = rand(Number(price) || 0);
  const fee = founding ? 0 : Math.round(priceCents * 0.06);
  const mode = food ? "order_now" : "buy_now";
  const preview = useMemo(() => (media ? URL.createObjectURL(media) : null), [media]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Check each step as you leave it, so problems show where they happen.
  const stepErrors = (n: number): string[] => {
    if (n === 0) return media ? [] : ["Add a photo or video first."];
    if (n === 1) {
      if (title.trim().length < 3) return ["Give it a short title, like “Vintage denim jacket, size M”."];
      return validateListing({ title, description: "", price: 100, label, condition: condition ?? undefined, hasProof: !!proof, mode })
        .filter((e) => !/price/i.test(e));
    }
    if (n === 2) return validateListing({ title, description, price: priceCents, label, condition: condition ?? undefined, hasProof: !!proof, mode })
      .filter((e) => /price/i.test(e));
    return [];
  };
  const next = () => {
    const errs = stepErrors(step);
    if (errs.length) return setError(errs[0]);
    setStep(step + 1);
  };
  const post = () => run(async () => {
    const errs = validateListing({ title, description, price: priceCents, label, condition: condition ?? undefined, hasProof: !!proof, mode });
    if (errs.length) throw new Error(errs[0]);
    const res = await api.createListing({
      title: title.trim(), description: description.trim(), priceCents, mode, label: food ? "new" : label, condition,
      sizes, stock: food ? 99 : stock, leadDays: food ? leadDays : null, allergens: food ? allergens.trim() || null : null,
      caption: caption.trim() || title.trim(),
    }, media, proof, setProgress);
    toast(res.live ? "Your item is live" : res.message ?? "Saved as a draft");
    nav("/me");
  });

  const pickRef = useRef<HTMLInputElement>(null);
  const isImage = media?.type.startsWith("image/");

  return (
    <div className="wizard">
      {step > 0 && (
        <div className="wz-top">
          <button className="bare" onClick={() => setStep(step - 1)} aria-label="Back"><Icon name="back" /></button>
          <div className="wz-progress" aria-label={`Step ${step} of ${STEPS.length - 1}`}>
            {STEPS.slice(1).map((_, i) => <span key={i} className={i < step ? "on" : ""} />)}
          </div>
          <span className="wz-count">{step} of {STEPS.length - 1}</span>
        </div>
      )}

      <div className="wz-body" ref={bodyRef}>
        <ErrorNote error={error} />

        {step === 0 && (
          <div className="wz-media">
            <h1>Create a listing</h1>
            <p className="muted">Start with a short video or a photo. Show the whole item and every mark.</p>
            {media && preview ? (
              <div className="wz-preview">
                {isImage ? <img src={preview} alt="Your photo" /> : <video src={preview} muted playsInline loop autoPlay />}
                <button className="btn vglass wz-change" onClick={() => onMedia(null)}>Change</button>
              </div>
            ) : (
              <div className="wz-pick">
                <button className="wz-big" onClick={onCamera}><Icon name="live" size={26} /><b>Use the camera</b><span>Tap for a photo, hold for a video</span></button>
                <button className="wz-big" onClick={() => pickRef.current?.click()}><Icon name="grid" size={26} /><b>Choose from gallery</b><span>A photo or video you already have</span></button>
              </div>
            )}
            <input ref={pickRef} type="file" accept="image/*,video/*" hidden aria-label="Photo or video"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { onMedia(f); setError(null); } }} />
          </div>
        )}

        {step === 1 && (
          <>
            <h1>What are you selling?</h1>
            <label className="wz-label" htmlFor="wz-title">Title</label>
            <input id="wz-title" className="wz-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus
              placeholder={food ? "Celebration cake, 20 cm" : "Vintage denim jacket, size M"} />
            {!food && (
              <>
                <div className="wz-label">It is</div>
                <div className="wz-options" role="radiogroup" aria-label="Type of item">
                  {(Object.keys(LISTING_LABELS) as ListingLabel[]).map((l) => (
                    <button key={l} role="radio" aria-checked={label === l} className="wz-option" onClick={() => setLabel(l)}>
                      <span className="radio" /><span className="grow"><b>{LISTING_LABELS[l].label}</b><small>{LISTING_LABELS[l].help}</small></span>
                    </button>
                  ))}
                </div>
                {label === "pre_loved" && (
                  <>
                    <div className="wz-label">Condition</div>
                    <div className="seg" role="group" aria-label="Condition">
                      {CONDITIONS.map((c) => <button key={c.value} aria-pressed={condition === c.value} onClick={() => setCondition(c.value)}>{c.label}</button>)}
                    </div>
                  </>
                )}
                {label === "authentic_designer" && (
                  <label className="wz-file">
                    <Icon name="shield" size={20} /><span className="grow"><b>{proof ? proof.name : "Add proof it is authentic"}</b><small>Receipt, tags or certificate. Only our team sees it.</small></span>
                    <input type="file" accept="image/*,application/pdf" hidden aria-label="Proof it is authentic" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
                  </label>
                )}
                {label === "unbranded_dupe" && <div className="note amber" style={{ marginTop: 12 }}>No brand names or logos anywhere. Copies with brand marks are not allowed and close your shop.</div>}
              </>
            )}
            {food && (
              <>
                <div className="wz-label">Days notice you need</div>
                <Stepper value={leadDays} min={1} max={14} onChange={setLeadDays} label="Days notice" />
              </>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h1>{food ? "Price and allergens" : "Price and stock"}</h1>
            <label className="wz-label" htmlFor="wz-price">Price</label>
            <div className="wz-price">
              <span>R</span>
              <input id="wz-price" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0" autoFocus aria-label="Price (rand)" />
            </div>
            <div className="wz-hint">{priceCents ? `You get ${R(priceCents - fee)} after the ${founding ? "0% founding" : "6%"} fee. Delivery is paid by the buyer.` : "Buyers also pay delivery and a small protection fee."}</div>
            {!food ? (
              <>
                <div className="wz-label">How many do you have?</div>
                <Stepper value={stock} min={1} max={999} onChange={setStock} label="Stock" />
                <div className="wz-label">Sizes <span className="muted">(optional)</span></div>
                <div className="chips">
                  {QUICK_SIZES.map((s) => (
                    <button key={s} className="chip" aria-pressed={sizes.includes(s)}
                      onClick={() => setSizes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))}>{s}</button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <label className="wz-label" htmlFor="wz-allergens">Allergens</label>
                <input id="wz-allergens" className="wz-input" value={allergens} onChange={(e) => setAllergens(e.target.value)} placeholder="Gluten, eggs, dairy, nuts" />
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h1>Tell buyers more</h1>
            <p className="muted" style={{ marginTop: -4 }}>Both are optional. You can skip this.</p>
            <label className="wz-label" htmlFor="wz-caption">Caption</label>
            <input id="wz-caption" className="wz-input" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={150} placeholder={title || "3 ways to style it"} />
            <label className="wz-label" htmlFor="wz-desc">Description</label>
            <textarea id="wz-desc" className="wz-input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Material, fit, measurements, any marks" />
          </>
        )}

        {step === 4 && (
          <>
            <h1>Check and post</h1>
            <div className="wz-review">
              <div className="wz-thumb">{media && preview && (isImage ? <img src={preview} alt="" /> : <video src={preview} muted playsInline />)}</div>
              <div className="group grow">
                <ReviewRow t="Title" v={title} onEdit={() => setStep(1)} />
                {!food && <ReviewRow t="Type" v={`${LISTING_LABELS[label].label}${condition && label === "pre_loved" ? `, ${CONDITIONS.find((c) => c.value === condition)?.label.toLowerCase()}` : ""}`} onEdit={() => setStep(1)} />}
                <ReviewRow t="Price" v={`${R(priceCents)} (you get ${R(priceCents - fee)})`} onEdit={() => setStep(2)} />
                {!food && <ReviewRow t="Stock" v={`${stock}${sizes.length ? ` · ${sizes.join(", ")}` : ""}`} onEdit={() => setStep(2)} />}
                {food && <ReviewRow t="Notice" v={`${leadDays} days${allergens ? ` · ${allergens}` : ""}`} onEdit={() => setStep(1)} />}
                <ReviewRow t="Caption" v={caption || title} onEdit={() => setStep(3)} />
              </div>
            </div>
            <div className="note" style={{ marginTop: 12 }}>The buyer's money is held safely and paid to you after the return window closes.</div>
            {busy && media && <div className="note" style={{ marginTop: 10 }}>Uploading… {progress}%</div>}
          </>
        )}
      </div>

      {step > 0 && (
        <div className="wz-foot">
          {step < 4
            ? <button className="btn green block big" onClick={next}>{step === 3 && !caption && !description ? "Skip" : "Next"}</button>
            : <button className="btn green block big" onClick={post} disabled={busy}>{busy ? "Posting…" : "Post listing"}</button>}
        </div>
      )}
      {step === 0 && media && (
        <div className="wz-foot above-modes"><button className="btn green block big" onClick={next}>Next</button></div>
      )}
    </div>
  );
}

function ReviewRow({ t, v, onEdit }: { t: string; v: string; onEdit: () => void }) {
  return (
    <button className="cell" onClick={onEdit} aria-label={`Edit ${t.toLowerCase()}`}>
      <span className="grow"><span className="s" style={{ display: "block" }}>{t}</span><span className="t" style={{ display: "block" }}>{v}</span></span>
      <span className="link" style={{ fontSize: 13 }}>Edit</span>
    </button>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Less ${label.toLowerCase()}`}>−</button>
      <b aria-live="polite">{value}</b>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>+</button>
    </div>
  );
}

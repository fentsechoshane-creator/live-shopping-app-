import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AUCTION_DAYS, canUse, PARCEL_SIZE_IDS, PARCEL_SIZES, type ParcelSize, LISTING_LABELS, rand, reserveProblem, validateListing, type Condition, type ListingLabel } from "@app/core";
import { api, type EditDraft, type ListingSuggestion, type MyShop } from "../../api";
import { clearDraft, loadDraft, loadDraftMedia, saveDraft, saveDraftMedia, snapshot, type DraftFields } from "../../lib/draft";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { Choice, ErrorNote, R, useAction } from "../../components/ui";

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
export function CreateListing({ shop, media, onMedia, onCamera, onStep, startAtDetails, edit, onEdit }: {
  shop: MyShop; media: File[]; onMedia: (files: File[]) => void; onCamera: () => void; onStep: (step: number) => void; startAtDetails?: boolean;
  /** The edit from the video editor, if the cover video was edited. */
  edit?: EditDraft | null;
  /** Open the video editor on the cover video. */
  onEdit?: () => void;
}) {
  const food = shop.category === "food";
  // Made to order is open to home and beauty shops too (13 Nov). It ships by courier once made, unlike food.
  const madeOk = shop.category === "home" || shop.category === "beauty";
  const [made, setMade] = useState(false);
  // Appliances (plug in or batteries): new and sealed, with a receipt or warranty card our team checks.
  const [appliance, setAppliance] = useState(false);
  const sealedRule = shop.category === "beauty" || shop.category === "fragrance";
  const founding = !!shop.foundingUntil && new Date(shop.foundingUntil) > new Date();
  const [step, setStepState] = useState(startAtDetails && media.length ? 1 : 0);
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState<ListingLabel>("new");
  const [condition, setCondition] = useState<Condition | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState(1);
  const [sizes, setSizes] = useState<string[]>([]);
  const [leadDays, setLeadDays] = useState(2);
  // Courier size: decides the delivery price the buyer pays. Picking too small means the courier's extra comes off your payout.
  const [parcelSize, setParcelSize] = useState<ParcelSize | null>(null);
  const [allergens, setAllergens] = useState("");
  const [description, setDescription] = useState("");
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState(0);
  const { busy, error, run, setError } = useAction();
  const { toast, user } = useSession();
  const nav = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);

  const setStep = (n: number) => { setError(null); setStepState(n); bodyRef.current?.scrollTo({ top: 0 }); };
  useEffect(() => onStep(step), [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const priceCents = rand(Number(price) || 0);
  const fee = founding ? 0 : Math.round(priceCents * 0.06);
  // How it sells: Buy now, or a timed auction once the shop has 5 good orders.
  const [auction, setAuction] = useState(false);
  const [auctionDays, setAuctionDays] = useState<number>(3);
  const [reserve, setReserve] = useState("");
  const reserveCents = reserve ? rand(Number(reserve) || 0) : null;
  // Team switches can unlock auctions early or turn them off for this shop.
  const [features] = useLoad(() => api.myFeatures(), []);
  const auctionUnlock = canUse("timed_auction", { verified: shop.checks.idStatus === "approved" && shop.checks.bankStatus === "approved",
    goodOrders: shop.goodOrders, trustScore: shop.trustScore, category: shop.category, overrides: features });
  const mode = food || made ? "order_now" : auction ? "auction" : "buy_now";
  const cover = media[0] ?? null;
  const urls = useMemo(() => media.map((m) => URL.createObjectURL(m)), [media]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const preview = urls[0] ?? null;

  // ----- Drafts: saved on this phone as you go -----
  const uid = user?.id ?? "anon";
  const [draft, setDraft] = useState<DraftFields | null>(() => (media.length ? null : loadDraft(uid)));
  const touched = !!(title || price || description || caption || media.length);
  useEffect(() => {
    if (!touched || draft) return;
    const t = window.setTimeout(() => saveDraft(uid, { title, label, condition, price, stock, sizes, leadDays, allergens, description, caption, step, parcelSize, savedAt: new Date().toISOString() }), 400);
    return () => window.clearTimeout(t);
  }, [touched, draft, uid, title, label, condition, price, stock, sizes, leadDays, allergens, description, caption, step, parcelSize]);
  useEffect(() => { if (!draft && media.length) saveDraftMedia(uid, media); }, [media, draft, uid]);
  const resumeDraft = async () => {
    if (!draft) return;
    setTitle(draft.title); setLabel(draft.label as ListingLabel); setCondition(draft.condition as Condition | null); setPrice(draft.price);
    setStock(draft.stock); setSizes(draft.sizes); setLeadDays(draft.leadDays); setAllergens(draft.allergens); setParcelSize(draft.parcelSize ?? null);
    setDescription(draft.description); setCaption(draft.caption);
    const files = await loadDraftMedia(uid);
    if (files.length) onMedia(files);
    setDraft(null);
    setStep(files.length ? Math.max(1, Math.min(4, draft.step)) : 0);
  };
  const discardDraft = () => { clearDraft(uid); setDraft(null); };

  // ----- Suggestions from the cover photo, once per cover -----
  const [sugg, setSugg] = useState<ListingSuggestion | "loading" | null>(null);
  const askedFor = useRef<File | null>(null);
  useEffect(() => {
    if (step !== 1 || !cover || title || askedFor.current === cover) return;
    askedFor.current = cover;
    setSugg("loading");
    snapshot(cover).then((img) => (img ? api.suggestListing(img) : null)).then((r) => setSugg(r)).catch(() => setSugg(null));
  }, [step, cover, title]);
  const applySuggestion = (x: ListingSuggestion) => {
    setTitle(x.title);
    if (!food) { setLabel(x.label); setCondition(x.condition); }
    setPrice(String(Math.round(x.priceCents / 100)));
    if (!description) setDescription(x.description);
    setSugg(null);
  };

  // Check each step as you leave it, so problems show where they happen.
  const stepErrors = (n: number): string[] => {
    if (n === 0) return media.length ? [] : ["Add a photo or video first."];
    if (n === 1) {
      if (title.trim().length < 3) return ["Give it a short title, like “Vintage denim jacket, size M”."];
      return validateListing({ title, description: "", price: 100, label, condition: condition ?? undefined, hasProof: !!proof, mode, appliance })
        .filter((e) => !/price/i.test(e));
    }
    if (n === 2) {
      const errs = validateListing({ title, description, price: priceCents, label, condition: condition ?? undefined, hasProof: !!proof, mode, appliance })
        .filter((e) => /price/i.test(e));
      const rp = auction ? reserveProblem(priceCents, reserveCents) : null;
      const sizeErr = !food && !parcelSize ? ["Pick a parcel size, so buyers see the right delivery price."] : [];
      return [...errs, ...(rp ? [rp] : []), ...sizeErr];
    }
    return [];
  };
  const next = () => {
    const errs = stepErrors(step);
    if (errs.length) return setError(errs[0]);
    setStep(step + 1);
  };
  const post = () => run(async () => {
    const errs = validateListing({ title, description, price: priceCents, label, condition: condition ?? undefined, hasProof: !!proof, mode, appliance });
    if (errs.length) throw new Error(errs[0]);
    const res = await api.createListing({
      title: title.trim(), description: description.trim(), priceCents, mode, label: food ? "new" : label, condition,
      sizes: auction ? sizes.slice(0, 1) : sizes, stock: food || made ? 99 : auction ? 1 : stock, leadDays: food || made ? leadDays : null, allergens: food ? allergens.trim() || null : null,
      ...(appliance ? { appliance: true } : {}),
      ...(auction ? { auctionDays, reserveCents } : {}),
      ...(!food ? { parcelSize: parcelSize ?? "small" } : {}),
      caption: caption.trim() || title.trim(),
    }, cover, proof, setProgress, media.slice(1), edit && edit.files[0] === cover ? edit : undefined);
    clearDraft(uid);
    toast(res.live ? "Your item is live" : res.message ?? "Saved as a draft");
    nav("/me");
  });

  const pickRef = useRef<HTMLInputElement>(null);
  const isImage = !!cover?.type.startsWith("image/");
  const addFiles = (files: File[]) => {
    let next = [...media];
    for (const f of files) {
      if (f.type.startsWith("video/")) {
        if (next[0]?.type.startsWith("video/")) { toast("Only the cover can be a video. Your new video is now the cover."); next[0] = f; }
        else next = [f, ...next];
      } else next.push(f);
    }
    if (next.length > 10) toast("Up to 10 photos and videos.");
    onMedia(next.slice(0, 10));
    setError(null);
  };
  const makeCover = (i: number) => onMedia([media[i], ...media.filter((_, j) => j !== i)]);
  const remove = (i: number) => onMedia(media.filter((_, j) => j !== i));

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
            <p className="muted">Show the whole item and every mark.</p>
            {draft && !media.length && (
              <div className="wz-draft">
                <span className="grow"><b>Continue your draft?</b><small>{draft.title || "Untitled item"} · saved {new Date(draft.savedAt).toLocaleString("en-ZA", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</small></span>
                <button className="btn" onClick={discardDraft}>Start over</button>
                <button className="btn green" onClick={resumeDraft}>Continue</button>
              </div>
            )}
            {cover && preview ? (
              <>
                <div className="wz-preview">
                  {isImage ? <img src={preview} alt="Cover" /> : <video src={preview} muted playsInline loop autoPlay />}
                  <span className="wz-cover-tag">Cover</span>
                  {!isImage && onEdit && (
                    <button className="wz-edit vglass" onClick={onEdit}>
                      <Icon name="cut" size={16} />{edit && edit.files[0] === cover ? `Edited · ${edit.files.length} clip${edit.files.length > 1 ? "s" : ""}` : "Edit video"}
                    </button>
                  )}
                </div>
                <div className="wz-strip" aria-label="Photos and video">
                  {media.map((m, i) => (
                    <div key={urls[i]} className={`wz-tile ${i === 0 ? "on" : ""}`}>
                      <button className="wz-tile-img" onClick={() => makeCover(i)} aria-label={i === 0 ? "Cover" : `Make photo ${i + 1} the cover`}>
                        {m.type.startsWith("image/") ? <img src={urls[i]} alt="" /> : <video src={urls[i]} muted playsInline />}
                      </button>
                      <button className="wz-x" onClick={() => remove(i)} aria-label={`Remove ${i === 0 ? "cover" : `photo ${i + 1}`}`}><Icon name="close" size={12} strokeWidth={3} /></button>
                    </div>
                  ))}
                  {media.length < 10 && (
                    <>
                      <button className="wz-add" onClick={() => pickRef.current?.click()} aria-label="Add photos"><Icon name="plus" size={20} /><span>Add</span></button>
                      <button className="wz-add" onClick={onCamera} aria-label="Take another"><Icon name="live" size={20} /><span>Camera</span></button>
                    </>
                  )}
                </div>
                <div className="wz-hint muted-hint">{media.length} of 10 · tap a photo to make it the cover</div>
              </>
            ) : (
              <div className="wz-pick">
                <button className="wz-big" onClick={onCamera}><Icon name="camera" size={26} /><b>Use the camera</b><span>Tap for a photo, hold for a video</span></button>
                <button className="wz-big" onClick={() => pickRef.current?.click()}><Icon name="grid" size={26} /><b>Choose from gallery</b><span>Up to 10 photos, or a video and photos</span></button>
              </div>
            )}
            <input ref={pickRef} type="file" accept="image/*,video/*" multiple hidden aria-label="Photo or video"
              onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </div>
        )}

        {step === 1 && (
          <>
            <h1>What are you selling?</h1>
            {sugg === "loading" && <div className="wz-sugg loading"><Icon name="spark" size={18} /><span>Reading your photo for suggestions…</span></div>}
            {sugg && sugg !== "loading" && (
              <div className="wz-sugg">
                <div className="row between"><b><Icon name="spark" size={16} /> {sugg.demo ? "Example suggestion (demo)" : "Suggested from your photo"}</b>
                  <button className="link" onClick={() => setSugg(null)}>No thanks</button></div>
                <div className="wz-sugg-body">
                  <span>{sugg.title}</span>
                  <span className="muted">{food ? "" : `${LISTING_LABELS[sugg.label].label}${sugg.condition ? `, ${sugg.condition.replace("_", " ")}` : ""} · `}{R(sugg.priceCents)}</span>
                </div>
                <button className="btn green block" onClick={() => applySuggestion(sugg)}>Use these</button>
                <small className="muted">Check them. You can change anything.</small>
              </div>
            )}
            <label className="wz-label" htmlFor="wz-title">Title</label>
            <input id="wz-title" className="wz-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus
              placeholder={food ? "Celebration cake, 20 cm" : "Vintage denim jacket, size M"} />
            {!food && (
              <>
                <div className="wz-label">It is</div>
                <div className="wz-options" role="radiogroup" aria-label="Type of item">
                  {(Object.keys(LISTING_LABELS) as ListingLabel[]).filter((l) => !appliance || l === "new").map((l) => (
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
                {shop.category === "home" && (
                  <div className="max-card" style={{ marginTop: 12 }}>
                    <div>
                      <div className="t">It's an appliance</div>
                      <div className="small muted">Plugs in or takes batteries, like a toaster or kettle. Must be new and sealed, with the receipt or warranty card.</div>
                    </div>
                    <button className="switch" role="switch" aria-checked={appliance} aria-label="It's an appliance"
                      onClick={() => { const on = !appliance; setAppliance(on); if (on) { setLabel("new"); setCondition(null); } }} />
                  </div>
                )}
                {appliance && (
                  <label className="wz-file">
                    <Icon name="shield" size={20} /><span className="grow"><b>{proof ? proof.name : "Add the receipt or warranty card"}</b><small>A photo is fine. Only our team sees it, and we check it before it goes live.</small></span>
                    <input type="file" accept="image/*,application/pdf" hidden aria-label="Receipt or warranty card" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
                  </label>
                )}
                {sealedRule && label === "pre_loved" && (
                  <div className="note amber" style={{ marginTop: 12 }}>{shop.category === "fragrance"
                    ? "Pre loved perfume must be in its original bottle. No decants or refills."
                    : "Makeup and skincare must be sealed or in original packaging where you don't touch the product, like a pump or tube."}</div>
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
            <h1>{food ? "Price and allergens" : auction ? "Auction" : made ? "Price and timing" : "Price and stock"}</h1>
            {!food && (
              <div className="seg-choice" role="radiogroup" aria-label="How it sells">
                <button role="radio" aria-checked={!auction && !made} onClick={() => { setAuction(false); setMade(false); }}><b>Buy now</b><span>Fixed price</span></button>
                {madeOk && <button role="radio" aria-checked={made} onClick={() => { setMade(true); setAuction(false); if (leadDays < 5) setLeadDays(7); }}><b>Made to order</b><span>You make it after they pay</span></button>}
                <button role="radio" aria-checked={auction} disabled={!auctionUnlock.ok} onClick={() => { setAuction(true); setMade(false); }}>
                  <b>{auctionUnlock.ok ? "Auction" : <><Icon name="lock" size={13} /> Auction</>}</b><span>{auctionUnlock.ok ? "Buyers bid" : features?.auctions === "off" ? "Turned off" : "After 5 good orders"}</span>
                </button>
              </div>
            )}
            {!food && !auctionUnlock.ok && <div className="wz-hint">{auctionUnlock.reason}</div>}
            <label className="wz-label" htmlFor="wz-price">{auction ? "Starting bid" : "Price"}</label>
            <div className="wz-price">
              <span>R</span>
              <input id="wz-price" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0" autoFocus aria-label="Price (rand)" />
            </div>
            <div className="wz-hint">{auction
              ? "Bids go up in steps of R10 (R20 from R500, R50 from R2,000). The winner pays within 2 hours. 6% fee on the final price."
              : priceCents ? `You get ${R(priceCents - fee)} after the ${founding ? "0% founding" : "6%"} fee. Delivery is paid by the buyer.` : "Buyers also pay delivery and a small protection fee."}</div>
            {auction ? (
              <>
                <label className="wz-label" htmlFor="wz-reserve">Reserve <span className="muted">(optional)</span></label>
                <div className="wz-price small">
                  <span>R</span>
                  <input id="wz-reserve" value={reserve} onChange={(e) => setReserve(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="No reserve" aria-label="Reserve (rand)" />
                </div>
                <div className="wz-hint">The lowest price you'll sell for. Buyers see whether it's been met, never the amount.</div>
                <div className="wz-label">How long?</div>
                <div className="chips" role="radiogroup" aria-label="Auction length">
                  {AUCTION_DAYS.map((d) => <button key={d} role="radio" className="chip" aria-checked={auctionDays === d} aria-pressed={auctionDays === d} onClick={() => setAuctionDays(d)}>{d} {d === 1 ? "day" : "days"}</button>)}
                </div>
                <div className="wz-label">Size <span className="muted">(optional)</span></div>
                <div className="chips">
                  {QUICK_SIZES.map((sz) => <button key={sz} className="chip" aria-pressed={sizes[0] === sz} onClick={() => setSizes(sizes[0] === sz ? [] : [sz])}>{sz}</button>)}
                </div>
              </>
            ) : !food ? (
              <>
                {made ? (
                  <>
                    <div className="wz-label">Days to make it</div>
                    <Stepper value={leadDays} min={1} max={45} onChange={setLeadDays} label="Days to make it" />
                    <div className="wz-hint">Buyers see this before they pay. It ships by courier once it's ready.</div>
                  </>
                ) : (
                  <>
                    <div className="wz-label">How many do you have?</div>
                    <Stepper value={stock} min={1} max={999} onChange={setStock} label="Stock" />
                  </>
                )}
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
            {!food && (
              <>
                <div className="wz-label">Parcel size</div>
                <div role="radiogroup" aria-label="Parcel size">
                  {PARCEL_SIZE_IDS.map((z) => (
                    <Choice key={z} on={parcelSize === z} onClick={() => setParcelSize(z)} title={PARCEL_SIZES[z].label} sub={PARCEL_SIZES[z].hint}
                      right={`R${PARCEL_SIZES[z].door / 100}`} />
                  ))}
                </div>
                <p className="small muted" style={{ marginTop: 4 }}>The buyer pays delivery by size. If the parcel is bigger or heavier than you pick, the courier's extra charge comes off your payout. Extra large is courier to your buyer's door only, too big for lockers.</p>
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h1>Tell buyers more</h1>
            <p className="muted">Both are optional.</p>
            <label className="wz-label" htmlFor="wz-caption">Caption</label>
            <input id="wz-caption" className="wz-input" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={150} placeholder={title || "3 ways to style it"} />
            <label className="wz-label" htmlFor="wz-desc">Description</label>
            <textarea id="wz-desc" className="wz-input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Material, fit, measurements, any marks" />
          </>
        )}

        {step === 4 && (
          <>
            <h1>Ready to post?</h1>
            <p className="wz-sub">This is how buyers will see it.</p>
            {/* A preview like the post in the feed: the cover, with title and price over it. */}
            <div className="post-preview">
              {cover && preview && (isImage ? <img src={preview} alt="" /> : <video src={preview} muted playsInline autoPlay loop />)}
              {media.length > 1 && <span className="pp-more">+{media.length - 1} {media.length === 2 ? "photo" : "photos"}</span>}
              {edit && edit.files[0] === cover && <span className="pp-more left"><Icon name="cut" size={12} />Edited</span>}
              <div className="pp-info">
                {!food && <span className="pp-chip">{LISTING_LABELS[label].label}{condition && label === "pre_loved" ? ` · ${CONDITIONS.find((c) => c.value === condition)?.label}` : ""}</span>}
                <b>{title}</b>
                <span className="pp-price">{auction ? `Bids from ${R(priceCents)}` : R(priceCents)}</span>
              </div>
            </div>

            <div className="sum-list" role="list">
              <SumRow k="Title" v={title} onEdit={() => setStep(1)} />
              {!food && <SumRow k="Condition" v={`${LISTING_LABELS[label].label}${condition && label === "pre_loved" ? `, ${CONDITIONS.find((c) => c.value === condition)?.label.toLowerCase()}` : ""}`} onEdit={() => setStep(1)} />}
              {auction
                ? <SumRow k="Auction" v={`From ${R(priceCents)}, ${reserveCents ? `reserve ${R(reserveCents)}` : "no reserve"}, ${auctionDays} ${auctionDays === 1 ? "day" : "days"}`} onEdit={() => setStep(2)} />
                : <SumRow k="Price" v={R(priceCents)} sub={fee > 0 ? `You get ${R(priceCents - fee)} after the 6% fee` : `No fee for founding sellers. You get all of it.`} onEdit={() => setStep(2)} />}
              {!food && !made && <SumRow k="Stock" v={`${stock} ${stock === 1 ? "item" : "items"}${sizes.length ? ` · ${sizes.join(", ")}` : ""}`} onEdit={() => setStep(2)} />}
              {made && <SumRow k="Made to order" v={`${leadDays} ${leadDays === 1 ? "day" : "days"} to make`} sub={sizes.length ? sizes.join(", ") : undefined} onEdit={() => setStep(2)} />}
              {appliance && <SumRow k="Appliance" v="New and sealed" sub={proof ? "Receipt or warranty added. We check it first." : "Add the receipt or warranty card"} onEdit={() => setStep(1)} />}
              {!food && parcelSize && <SumRow k="Parcel" v={PARCEL_SIZES[parcelSize].label} sub={`Buyers pay R${PARCEL_SIZES[parcelSize].door / 100} for courier${PARCEL_SIZES[parcelSize].locker ? `, R${PARCEL_SIZES[parcelSize].locker / 100} to a locker` : ""}`} onEdit={() => setStep(2)} />}
              {food && <SumRow k="Notice" v={`${leadDays} days`} sub={allergens || undefined} onEdit={() => setStep(1)} />}
              <SumRow k="Caption" v={caption || title} onEdit={() => setStep(3)} />
            </div>
            <p className="wz-trust"><Icon name="lock" size={14} />The buyer's money is held safely and paid to you after the return window closes.</p>
          </>
        )}
      </div>

      {step > 0 && (
        <div className="wz-foot">
          {step < 4
            ? <button className="btn green block big" onClick={next}>{step === 3 && !caption && !description ? "Skip" : "Next"}</button>
            : (
              // The upload shows inside the button: it fills as the video goes up.
              <button className={`btn green block big post-btn ${busy ? "busy" : ""}`} onClick={post} disabled={busy}
                style={busy ? { ["--p" as string]: `${Math.max(4, progress)}%` } : undefined} aria-live="polite">
                <span>{!busy ? "Post listing" : !cover || progress >= 100 ? "Posting…" : progress <= 0 ? "Getting your video ready…" : `Uploading ${progress}%`}</span>
              </button>
            )}
        </div>
      )}
      {step === 0 && media.length > 0 && (
        <div className="wz-foot above-modes"><button className="btn green block big" onClick={next}>Next</button></div>
      )}
    </div>
  );
}

function SumRow({ k, v, sub, onEdit }: { k: string; v: string; sub?: string; onEdit: () => void }) {
  return (
    <button className="sum-row" role="listitem" onClick={onEdit} aria-label={`${k}: ${v}. Change`}>
      <span className="k">{k}</span>
      <span className="v"><span className="main">{v}</span>{sub && <small>{sub}</small>}</span>
      <Icon name="chevron" size={16} />
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

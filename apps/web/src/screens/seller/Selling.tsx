import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  canUse, DELIVERY_OPTIONS, LISTING_LABELS, rand, TIER_INFO, tierFor, TRUST_POINTS, validateListing,
  type Condition, type ListingLabel,
} from "@app/core";
import { api, type MyShop } from "../../api";
import { useLoad, useSession } from "../../session";
import { ProductArt } from "../../components/Scene";
import { BackButton, Cell, ErrorNote, Field, Loading, R, TierPill, dateText, dateTimeText, swatch, useAction } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { statusPill, Timeline } from "../buyer/Orders";

export function CertUpload({ status, onDone }: { status: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const { busy, error, run } = useAction();
  if (status === "pending") return <div className="note">Certificate received. We check it within 2 working days.</div>;
  return (
    <div style={{ marginTop: 8 }}>
      <ErrorNote error={error} />
      <Field label="Certificate of Acceptability" hint="From your municipality. Needed before you can take food orders.">
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <button className="btn dark block" disabled={!file || busy} onClick={() => run(async () => { await api.submitFoodCert(file!); onDone(); })}>Upload certificate</button>
    </div>
  );
}

const CONDITIONS: Condition[] = ["new", "like_new", "good", "fair"];

export function NewListing() {
  const [shop] = useLoad(() => api.myShop(), []);
  const food = shop?.category === "food";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [label, setLabel] = useState<ListingLabel>("new");
  const [condition, setCondition] = useState<Condition | null>(null);
  const [sizes, setSizes] = useState("");
  const [stock, setStock] = useState("1");
  const [leadDays, setLeadDays] = useState("2");
  const [allergens, setAllergens] = useState("");
  const [caption, setCaption] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const { busy, error, run, setError } = useAction();
  const { toast } = useSession();
  const nav = useNavigate();
  const priceCents = rand(Number(price) || 0);
  const fee = Math.round(priceCents * 0.06);
  const founding = !!shop?.foundingUntil && new Date(shop.foundingUntil) > new Date();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const mode = food ? "order_now" : "buy_now";
    const errs = validateListing({ title, description, price: priceCents, label, condition: condition ?? undefined, hasProof: !!proof, mode });
    if (errs.length) return setError(errs[0]);
    run(async () => {
      const res = await api.createListing({
        title: title.trim(), description: description.trim(), priceCents, mode, label, condition,
        sizes: sizes.split(",").map((s) => s.trim()).filter(Boolean), stock: food ? 99 : Math.max(1, Number(stock) || 1),
        leadDays: food ? Number(leadDays) || 2 : null, allergens: food ? allergens || null : null, caption: caption.trim() || title.trim(),
      }, video, proof, setProgress);
      toast(res.live ? "Your item is live" : res.message ?? "Saved as a draft");
      nav("/me?tab=selling");
    });
  };

  if (shop === undefined) return <div className="screen"><Loading /></div>;
  if (!shop || shop.status === "onboarding") return <Navigate to="/sell/start" replace />;
  return (
    <form className="screen" onSubmit={submit}>
      <BackButton />
      <h1 style={{ marginTop: 6 }}>List an item</h1>
      <ErrorNote error={error} />
      <Field label="Video" hint="Short and honest. Show the whole item and every flaw. Up to 60 seconds works best.">
        <input type="file" accept="video/*" capture="environment" onChange={(e) => setVideo(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={food ? "Celebration cake, 20 cm" : "Vintage denim jacket, size M"} required /></Field>
      <Field label="Price (rand)" hint={priceCents ? `You get ${R(priceCents - (founding ? 0 : fee))} after the ${founding ? "0% founding" : "6%"} fee, plus delivery.` : undefined}>
        <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="450" required />
      </Field>
      {!food && (
        <>
          <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>What is it?</h3>
          {(Object.keys(LISTING_LABELS) as ListingLabel[]).map((l) => (
            <button key={l} type="button" className="choice" aria-pressed={label === l} onClick={() => setLabel(l)}>
              <span><b>{LISTING_LABELS[l].label}</b><small>{LISTING_LABELS[l].help}</small></span>
            </button>
          ))}
          {label === "pre_loved" && (
            <div className="chips" role="group" aria-label="Condition" style={{ margin: "4px 0 14px" }}>
              {CONDITIONS.map((c) => <button key={c} type="button" className="chip" aria-pressed={condition === c} onClick={() => setCondition(c)}>{c.replace("_", " ")}</button>)}
            </div>
          )}
          {label === "authentic_designer" && (
            <Field label="Proof it is authentic" hint="Receipt, tags or certificate. Only our team sees it.">
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
            </Field>
          )}
          <div className="note amber" style={{ margin: "4px 0 14px" }}>Replicas and items with copied logos are not allowed, even if labelled. Your shop will be closed.</div>
          <Field label="Sizes (comma separated)"><input value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="S, M, L" /></Field>
          <Field label="How many do you have?"><input value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></Field>
        </>
      )}
      {food && (
        <>
          <Field label="Days notice needed"><input value={leadDays} onChange={(e) => setLeadDays(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></Field>
          <Field label="Allergens" hint="Shown to buyers before they order."><input value={allergens} onChange={(e) => setAllergens(e.target.value)} placeholder="Gluten, eggs, dairy, nuts" /></Field>
        </>
      )}
      <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Video caption"><input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="3 ways to style it" /></Field>
      {busy && video && <div className="note" style={{ marginBottom: 12 }}>Uploading video… {progress}%</div>}
      <button className="btn green block big" disabled={busy}>{busy ? "Posting…" : "Post listing"}</button>
    </form>
  );
}

export function SellerOrders() {
  const [orders, error] = useLoad(() => api.sellerOrders(), []);
  return (
    <div className="screen">
      <BackButton to="/me?tab=selling" label="Shop" />
      <h1 style={{ marginTop: 6 }}>Orders</h1>
      <ErrorNote error={error} />
      {!orders && !error && <Loading />}
      {orders?.length === 0 && <div className="empty">No orders yet. Post videos to get your first sale.</div>}
      {orders?.map((o) => (
        <Link key={o.id} to={`/sell/orders/${o.id}`} className="list-item">
          <div className="grow">
            <b>{o.product.title}</b>{o.size && <span className="small muted"> · size {o.size}</span>}
            <div className="small muted">{DELIVERY_OPTIONS[o.delivery].label} · {dateText(o.createdAt)}</div>
            <div style={{ marginTop: 4 }}>{statusPill(o, "seller")}</div>
          </div>
          <b>{R(o.totals.sellerPayout)}</b>
        </Link>
      ))}
    </div>
  );
}

export function SellerOrderDetail() {
  const { id = "" } = useParams();
  const [o, error, reload] = useLoad(() => api.order(id), [id]);
  const [tracking, setTracking] = useState("");
  const [packing, setPacking] = useState<File | null>(null);
  const { busy, error: actErr, run } = useAction();
  const { toast } = useSession();
  if (error) return <div className="screen"><ErrorNote error={error} /></div>;
  if (o === undefined) return <div className="screen"><Loading /></div>;
  if (!o) return <div className="screen"><div className="empty">Order not found.</div></div>;
  const act = (fn: () => Promise<void>, msg: string) => run(async () => { await fn(); toast(msg); reload(); });
  const needsTracking = o.delivery === "courier" || o.delivery === "pudo_locker";

  return (
    <div className="screen">
      <BackButton to="/sell/orders" label="Orders" />
      <h1 style={{ marginTop: 6 }}>{o.product.title}</h1>
      <div className="row between"><span className="small muted">{o.size ? `Size ${o.size} · ` : ""}{DELIVERY_OPTIONS[o.delivery].label}</span>{statusPill(o, "seller")}</div>
      <ErrorNote error={actErr} />

      {o.status === "paid" && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>Ship by {dateTimeText(o.shipBy)}</b>
          <p className="small muted">If it is not shipped in time, the buyer is refunded automatically and you lose 5 trust points.</p>
          {o.deliveryDetails.locker && <div className="note" style={{ marginBottom: 12 }}>Send to PUDO locker: <b>{o.deliveryDetails.locker}</b></div>}
          {o.deliveryDetails.address && <div className="note" style={{ marginBottom: 12 }}>Send to {o.deliveryDetails.name}, {o.deliveryDetails.phone}<br />{o.deliveryDetails.address}</div>}
          {o.foodDate && <div className="note" style={{ marginBottom: 12 }}>For {o.foodDate}, {o.foodSlot}</div>}
          <Field label="Packing video" hint="Earns a trust point when you ship within 2 days, and protects you in a dispute.">
            <input type="file" accept="video/*" capture="environment" onChange={(e) => setPacking(e.target.files?.[0] ?? null)} />
          </Field>
          {needsTracking && <Field label="Tracking number"><input value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>}
          <button className="btn green block" disabled={busy || (needsTracking && !tracking)} onClick={() => act(() => api.shipOrder(o.id, tracking, packing), "Marked as shipped")}>
            {o.mode === "order_now" ? "Ready, handed over" : "Mark as shipped"}
          </button>
        </div>
      )}

      {o.status === "return_requested" && o.ret && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>Return requested: {o.ret.reason.replace(/_/g, " ")}</b>
          {o.ret.details && <p className="small">“{o.ret.details}”</p>}
          <p className="small muted">{o.ret.postagePayer === "buyer" ? "The buyer pays the return postage." : "You pay the return postage."} Your payout waits until this is sorted out.</p>
          <div className="row">
            <button className="btn green grow" disabled={busy} onClick={() => act(() => api.acceptReturn(o.id), "Return accepted")}>Accept return</button>
            {o.ret.reason !== "changed_mind" && <button className="btn line grow" disabled={busy} onClick={() => act(() => api.disputeReturn(o.id), "Sent to our team")}>Disagree</button>}
          </div>
        </div>
      )}
      {o.status === "return_in_transit" && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>Return on the way to you</b>
          <p className="small muted">When it arrives, confirm it. The buyer is refunded from the money still held.</p>
          <button className="btn dark block" disabled={busy} onClick={() => act(() => api.returnReceived(o.id), "Buyer refunded")}>I have the item back</button>
        </div>
      )}

      <h2>Where it is</h2>
      <Timeline o={o} />
      <h2>Your money</h2>
      <div className="price-rows">
        <div className="row"><span>Item</span><span>{R(o.totals.itemPrice)}</span></div>
        <div className="row"><span>Delivery</span><span>{R(o.totals.deliveryFee)}</span></div>
        <div className="row"><span>Seller fee</span><span>-{R(o.totals.sellerFee)}</span></div>
        <div className="row total"><span>You get</span><span>{R(o.totals.sellerPayout)}</span></div>
      </div>
      {o.totals.creditTopUp > 0 && <p className="small muted">The buyer used our welcome credit. {R(o.totals.creditTopUp)} of your payout comes straight from us, paid on the same day.</p>}
      <p className="small muted">Paid once the buyer's {o.mode === "buy_now" ? "7 day return window" : "check period"} closes with no claim.</p>
    </div>
  );
}

export function Payouts() {
  const [items, error] = useLoad(() => api.payouts(), []);
  const [shop] = useLoad<MyShop | null>(() => api.myShop(), []);
  const tier = shop ? tierFor(shop.trustScore) : "standard";
  return (
    <div className="screen">
      <BackButton to="/me?tab=selling" label="Shop" />
      <h1 style={{ marginTop: 6 }}>Payouts</h1>
      <div className="note" style={{ marginBottom: 12 }}>
        You are paid once the buyer's return window closes. As a <b>{TIER_INFO[tier].label}</b> seller: {tier === "top" ? "the next working day" : tier === "trusted" ? "within 2 working days" : tier === "restricted" ? "held for review" : "in the weekly Friday run"}.
        {shop?.checks.bankLast4 && <> To {shop.checks.bankName} ending {shop.checks.bankLast4}.</>}
      </div>
      <ErrorNote error={error} />
      {!items && !error && <Loading />}
      {items?.length === 0 && <div className="empty">No payouts yet.</div>}
      {items?.map((p) => (
        <div key={p.id} className="list-item">
          <div className="grow"><b>{R(p.amountCents)}</b><div className="small muted">{p.status === "released" ? "Paid" : p.payOn ? `Paying on ${dateText(p.payOn)}` : "Held for review"}</div></div>
          <span className={`pill ${p.status === "released" ? "green" : p.status === "held" ? "red" : ""}`}>{p.status}</span>
        </div>
      ))}
    </div>
  );
}

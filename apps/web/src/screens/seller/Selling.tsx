import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  canUse, DELIVERY_OPTIONS, LISTING_LABELS, rand, TIER_INFO, tierFor, TRUST_POINTS, validateListing,
  type Condition, type ListingLabel,
} from "@app/core";
import { api, type MyShop } from "../../api";
import { useLoad, useSession } from "../../session";
import { ErrorNote, Field, Loading, R, TierPill, dateText, dateTimeText, useAction } from "../../components/ui";
import { statusPill, Timeline } from "../buyer/Orders";

export function SellHome() {
  const [shop, error, reload] = useLoad(() => api.myShop(), []);
  const [orders] = useLoad(() => api.sellerOrders(), []);
  useEffect(() => {
    // Checks are reviewed in the background, so refresh while something is pending.
    if (shop && (shop.checks.idStatus === "pending" || shop.checks.certStatus === "pending")) {
      const t = window.setTimeout(reload, 4000);
      return () => window.clearTimeout(t);
    }
  }, [shop, reload]);
  if (error) return <div className="screen"><ErrorNote error={error} /></div>;
  if (shop === undefined) return <div className="screen"><Loading /></div>;
  if (!shop || shop.status === "onboarding") return <Navigate to="/sell/start" replace />;

  const tier = tierFor(shop.trustScore);
  const sold = (orders ?? []).filter((o) => !["cancelled", "refunded"].includes(o.status)).length;
  const toShip = (orders ?? []).filter((o) => o.status === "paid").length;
  const steps: [string, boolean, string?][] = [
    ["Open your shop", true],
    ["ID checked", shop.checks.idStatus === "approved", shop.checks.idStatus === "pending" ? "Our team is checking it" : undefined],
    ...(shop.category === "food" ? [["Food safety certificate approved", shop.checks.certStatus === "approved"] as [string, boolean]] : []),
    ["List your first item", shop.products.length > 0, undefined],
    ["Post a video of your items", shop.products.some((p) => p.posted)],
    ["Get your first sale", sold > 0],
  ];
  const state = { verified: shop.checks.idStatus === "approved" && shop.checks.bankStatus === "approved", goodOrders: shop.goodOrders,
    trustScore: shop.trustScore, category: shop.category, foodCertApproved: shop.checks.certStatus === "approved" };
  const auction = canUse("timed_auction", state);

  return (
    <div className="screen">
      <div className="row between">
        <div><h1 style={{ marginBottom: 0 }}>{shop.name}</h1><span className="small muted">@{shop.handle}</span></div>
        <TierPill tier={tier} />
      </div>
      {shop.status === "banned" && <div className="error" style={{ marginTop: 12 }}>This shop has been closed for breaking the seller rules.</div>}
      {shop.foundingUntil && new Date(shop.foundingUntil) > new Date() && (
        <div className="note green" style={{ marginTop: 12 }}>Founding seller: 0% seller fee until {dateText(shop.foundingUntil)}.</div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <Link to="/sell/new" className="btn green grow">List an item</Link>
        <Link to="/sell/orders" className="btn grow">Orders{toShip ? ` (${toShip} to ship)` : ""}</Link>
      </div>

      <h2>Get your shop going</h2>
      <div className="card checklist">
        {steps.map(([t, done, sub]) => (
          <div className="item" key={t}>
            <span className={`dot ${done ? "done" : ""}`}>{done ? "✓" : ""}</span>
            <span className={`grow ${done ? "done-text" : ""}`}>{t}{sub && <span className="small muted"> · {sub}</span>}</span>
          </div>
        ))}
        {shop.category === "food" && shop.checks.certStatus !== "approved" && <CertUpload status={shop.checks.certStatus} onDone={reload} />}
      </div>

      <h2>Trust score</h2>
      <div className="card">
        <div className="score">
          <div className="ring" style={{ background: `conic-gradient(var(--green) ${shop.trustScore}%, var(--soft) 0)` }}><div>{shop.trustScore}</div></div>
          <div className="grow"><b>{TIER_INFO[tier].label}</b><div className="small muted">{TIER_INFO[tier].perks}</div></div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Earn points: kept order +{TRUST_POINTS.order_kept}, ship in 2 days with a packing video +{TRUST_POINTS.fast_ship_with_video}, five star review +{TRUST_POINTS.five_star_review}.
          Lose points: item not as described {TRUST_POINTS.not_as_described}, not shipped {TRUST_POINTS.not_shipped}, asking for payment outside the app {TRUST_POINTS.off_app_payment}.
        </p>
      </div>

      <h2>Unlocks</h2>
      <div className="card small">
        <div className="row between"><span>Buy now, videos and chat</span><span className="pill green">Open</span></div>
        <div className="row between" style={{ marginTop: 8 }}><span>Auctions and going live</span><span className={`pill ${auction.ok ? "green" : ""}`}>{auction.ok ? "Open" : `${shop.goodOrders} of 5 good orders`}</span></div>
      </div>

      <h2>Your items</h2>
      {shop.products.length === 0 && <div className="empty">No items yet.</div>}
      {shop.products.map((p) => (
        <div key={p.id} className="list-item">
          <div className="thumb" style={{ background: "#a8a29e" }}>{p.title.slice(0, 10)}</div>
          <div className="grow"><b>{p.title}</b><div className="small muted">{R(p.priceCents)} · {LISTING_LABELS[p.label].label} · stock {p.stock}</div></div>
          <span className={`pill ${p.status === "live" ? "green" : ""}`}>{p.status === "draft" && p.proofStatus === "pending" ? "Proof checking" : p.status.replace("_", " ")}</span>
        </div>
      ))}
      <Link to="/sell/payouts" className="choice" style={{ marginTop: 16 }}><b>Payouts</b><span>›</span></Link>
    </div>
  );
}

function CertUpload({ status, onDone }: { status: string; onDone: () => void }) {
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
      nav("/sell");
    });
  };

  if (shop === undefined) return <div className="screen"><Loading /></div>;
  if (!shop || shop.status === "onboarding") return <Navigate to="/sell/start" replace />;
  return (
    <form className="screen" onSubmit={submit}>
      <button type="button" className="link" onClick={() => nav(-1)}>← Back</button>
      <h1 style={{ marginTop: 10 }}>List an item</h1>
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
      <Link to="/sell" className="link">← Shop</Link>
      <h1 style={{ marginTop: 10 }}>Orders</h1>
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
      <Link to="/sell/orders" className="link">← Orders</Link>
      <h1 style={{ marginTop: 10 }}>{o.product.title}</h1>
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
      <Link to="/sell" className="link">← Shop</Link>
      <h1 style={{ marginTop: 10 }}>Payouts</h1>
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

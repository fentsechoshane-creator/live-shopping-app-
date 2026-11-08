import { useEffect, useMemo, useState } from "react";
import { CancelledNote, SellerCancel } from "../../components/CancelOrder";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  PAYOUT_SCHEDULES, DEFAULT_PAYOUT_SCHEDULE, type PayoutSchedule,
  bookedByUs, canUse, DELIVERY_OPTIONS, PARCEL_SIZES, PACKING_KEEP_MONTHS, PACKING_STEPS, PACKING_VIDEO_MAX_S, PACKING_VIDEO_MIN_S, packingVideoProblems, LISTING_LABELS, rand, TIER_INFO, tierFor, TRUST_POINTS, validateListing,
  type Condition, type ListingLabel,
} from "@app/core";
import { api, type MyShop } from "../../api";
import { useLoad, useSession } from "../../session";
import { ProductArt } from "../../components/Scene";
import { BackButton, Cell, Choice, ErrorNote, Field, Loading, R, TierPill, dateText, dateTimeText, swatch, useAction } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { addressLine, PickupAddressForm } from "../../components/Address";
import { CourierTracking, statusPill, Timeline } from "../buyer/Orders";

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

export function SellerOrders() {
  const [orders, error] = useLoad(() => api.sellerOrders(), []);
  return (
    <div className="screen">
      <BackButton to="/me?tab=selling" label="Shop" />
      <h1 style={{ marginTop: 6 }}>Orders</h1>
      <ErrorNote error={error} />
      <PickupCheck />
      {!orders && !error && <Loading />}
      {orders?.length === 0 && <div className="empty">No orders yet. Post videos to get your first sale.</div>}
      {/* Orders to ship come first, the most urgent at the top. */}
      {orders && [...orders].sort((a, b) => (a.status === "paid" ? 0 : 1) - (b.status === "paid" ? 0 : 1)
        || (a.status === "paid" ? new Date(a.shipBy ?? 0).getTime() - new Date(b.shipBy ?? 0).getTime() : 0)).map((o) => (
        <Link key={o.id} to={`/sell/orders/${o.id}`} className="list-item">
          <div className="grow">
            <b>{o.product.title}</b>{o.size && <span className="small muted"> · size {o.size}</span>}
            <div className="small muted">{DELIVERY_OPTIONS[o.delivery].label} · {o.status === "paid" && o.shipBy ? `ship by ${dateTimeText(o.shipBy)}` : dateText(o.createdAt)}</div>
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
  const [packing, setPacking] = useState<File | null>(null);
  const [packSecs, setPackSecs] = useState<number | null>(null);
  const [parcel, setParcel] = useState<File | null>(null);
  // Read the video's length on the phone, before uploading. Some formats can't be read in a browser: then the server decides.
  const pickVideo = (f: File | null) => {
    setPacking(f); setPackSecs(null);
    if (!f) return;
    const url = URL.createObjectURL(f); const v = document.createElement("video");
    v.preload = "metadata"; v.onloadedmetadata = () => { if (isFinite(v.duration)) setPackSecs(Math.round(v.duration)); URL.revokeObjectURL(url); };
    v.onerror = () => URL.revokeObjectURL(url); v.src = url;
  };
  const packProblems = packing ? packingVideoProblems(packSecs, packing.size) : [];
  const { busy, error: actErr, run } = useAction();
  const { toast } = useSession();
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast("Copied"), () => toast("Couldn't copy"));
  if (error) return <div className="screen"><ErrorNote error={error} /></div>;
  if (o === undefined) return <div className="screen"><Loading /></div>;
  if (!o) return <div className="screen"><div className="empty">Order not found.</div></div>;
  const act = (fn: () => Promise<void>, msg: string) => run(async () => { await fn(); toast(msg); reload(); });
  // Courier and locker parcels are booked by us through Bob Go when you mark them shipped.
  const booked = bookedByUs(o.delivery);
  const label = () => run(async () => { const url = await api.courierLabel(o.id); window.open(url, "_blank", "noopener"); });

  return (
    <div className="screen">
      <BackButton to="/sell/orders" label="Orders" />
      <h1 style={{ marginTop: 6 }}>{o.product.title}</h1>
      <div className="row between"><span className="small muted">{o.size ? `Size ${o.size} · ` : ""}{DELIVERY_OPTIONS[o.delivery].label}</span>{statusPill(o, "seller")}</div>
      <ErrorNote error={actErr} />
      <CancelledNote o={o} side="seller" />
      <SellerCancel o={o} onDone={reload} part="request" />

      {o.status === "paid" && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>Ship by {dateTimeText(o.shipBy)}</b>
          <p className="small muted">If it isn't shipped in time, the buyer is refunded automatically and you lose 5 trust points.</p>
          {booked && (
            <div className="note" style={{ marginBottom: 12 }}>
              <b>{o.delivery === "pudo_locker" ? `To a locker: ${o.pickupPoint?.name ?? o.deliveryDetails.locker ?? ""}` : `To ${o.deliveryDetails.suburb ?? ""}${o.deliveryDetails.city ? `, ${o.deliveryDetails.city}` : ""}`}</b><br />
              {PARCEL_SIZES[o.parcelSize ?? "small"].label} parcel: {PARCEL_SIZES[o.parcelSize ?? "small"].hint.toLowerCase()} When you mark it shipped we book the courier, and you print the label.
            </div>
          )}
          {booked && <PickupCheck />}
          {!booked && o.deliveryDetails.address && (
            <div className="note row between" style={{ marginBottom: 12, alignItems: "flex-start" }}>
              <span>Send to {o.deliveryDetails.name}, {o.deliveryDetails.phone}<br />{o.deliveryDetails.address}</span>
              <button className="link" onClick={() => copy(`${o.deliveryDetails.name}\n${o.deliveryDetails.phone}\n${o.deliveryDetails.address}`)}>Copy</button>
            </div>
          )}
          {o.foodDate && <div className="note" style={{ marginBottom: 12 }}>For {o.foodDate}, {o.foodSlot}</div>}
          {/* Packing proof: required before any order ships or is handed over. No approval needed. */}
          <div className="pack">
            <div className="pack-code"><span>Packing code</span><b>{o.packingCode ?? "—"}</b><small>Write it on the parcel or a slip inside</small></div>
            <b className="pack-h">Film one video, {PACKING_VIDEO_MIN_S} seconds to {PACKING_VIDEO_MAX_S / 60} minutes:</b>
            <ol className="pack-steps">{PACKING_STEPS.map((t) => <li key={t}>{t}</li>)}</ol>
            <p className="small muted">Film only your hands and the item, not your face or your home. We keep it for {PACKING_KEEP_MONTHS} months and only use it if there's a problem with the order. No video, or one that doesn't show the item clearly, means you lose a dispute.</p>
            <label className={`pack-pick ${packing && !packProblems.length ? "done" : ""}`}>
              <Icon name={packing && !packProblems.length ? "check" : "play"} size={18} />
              <span className="grow">{packing ? `Packing video added${packSecs != null ? ` (${packSecs} seconds)` : ""}` : "Film the packing video"}</span>
              {packing && <span className="link">Redo</span>}
              <input type="file" accept="video/*" capture="environment" aria-label="Packing video" onChange={(e) => pickVideo(e.target.files?.[0] ?? null)} />
            </label>
            {packProblems.map((p) => <div key={p} className="error small">{p}</div>)}
            <label className={`pack-pick ${parcel ? "done" : ""}`}>
              <Icon name={parcel ? "check" : "bag"} size={18} />
              <span className="grow">{parcel ? "Photo of the sealed parcel added" : "Photo of the sealed parcel, label showing"}</span>
              {parcel && <span className="link">Redo</span>}
              <input type="file" accept="image/*" capture="environment" aria-label="Photo of the sealed parcel" onChange={(e) => setParcel(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <button className="btn green block" disabled={busy || !packing || !parcel || packProblems.length > 0}
            onClick={() => packing && parcel && act(() => api.shipOrder(o.id, "", packing, parcel), booked ? "Courier booked. Print the label." : "Marked as shipped")}>
            {busy && booked ? "Booking the courier…" : o.mode === "order_now" ? "Ready, handed over" : booked ? "Book courier and mark shipped" : "Mark as shipped"}
          </button>
        </div>
      )}
      <SellerCancel o={o} onDone={reload} part="button" />

      {o.hasLabel && ["shipped", "delivered"].includes(o.status) && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>{o.courierName ?? "Courier"} · {o.trackingRef}</b>
          <p className="small muted">Print the label and stick it on the parcel. The courier collects from your pickup address{o.delivery === "pudo_locker" ? ", or drop it at any PUDO locker" : ""}.</p>
          <button className="btn dark block" disabled={busy} onClick={label}><Icon name="share" size={18} />Print courier label</button>
        </div>
      )}
      {o.hasLabel && <CourierTracking o={o} seller />}

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
      {o.totals.creditTopUp > 0 && <p className="small muted">The buyer used a myHaul reward. {R(o.totals.creditTopUp)} of your payout comes straight from us, paid on the same day.</p>}
      <p className="small muted">Paid once the buyer's {o.mode === "buy_now" ? "7 day return window" : "check period"} closes with no claim.</p>
    </div>
  );
}

export function Payouts() {
  const [items, error] = useLoad(() => api.payouts(), []);
  const [shop, , reloadShop] = useLoad<MyShop | null>(() => api.myShop(), []);
  const [owed] = useLoad(() => api.sellerCharges(), []);
  const { busy, error: saveError, run } = useAction();
  const { toast } = useSession();
  const tier = shop ? tierFor(shop.trustScore) : "standard";
  const schedule: PayoutSchedule = shop?.checks.payoutSchedule ?? DEFAULT_PAYOUT_SCHEDULE;
  const pickSchedule = (next: PayoutSchedule) => next !== schedule && run(async () => {
    await api.setPayoutSchedule(next); reloadShop(); toast(`Paid ${PAYOUT_SCHEDULES[next].label.toLowerCase()} from now on`);
  });
  return (
    <div className="screen">
      <BackButton to="/me?tab=selling" label="Shop" />
      <h1 style={{ marginTop: 6 }}>Payouts</h1>
      <div className="note" style={{ marginBottom: 12 }}>
        Your money is released once the buyer's return window closes. As a <b>{TIER_INFO[tier].label}</b> seller: {tier === "top" ? "the next working day" : tier === "trusted" ? "within 2 working days" : tier === "restricted" ? "held for review" : "in the weekly Friday run"}.
        {" "}{schedule === "IMMEDIATE" ? "TradeSafe then pays it straight into your bank" : schedule === "WEEKLY" ? "TradeSafe then pays everything released that week into your bank in one payment" : "TradeSafe then pays everything released that month into your bank in one payment"}{shop?.checks.bankLast4 ? <>, {shop.checks.bankName} ending {shop.checks.bankLast4}</> : null}.
      </div>

      <h3 className="section-title">How often you're paid</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Our payment partner TradeSafe charges R5.75 for each payment into your bank, and nothing if you're paid once a month.</p>
      <ErrorNote error={saveError} />
      {(Object.keys(PAYOUT_SCHEDULES) as PayoutSchedule[]).map((k) => (
        <Choice key={k} on={schedule === k} onClick={() => !busy && pickSchedule(k)} title={PAYOUT_SCHEDULES[k].label} sub={PAYOUT_SCHEDULES[k].sub} />
      ))}

      {owed && (owed.owedCents > 0 || owed.charges.length > 0) && <>
        <h3 className="section-title">Owed to myHaul</h3>
        <div className="note" style={{ marginBottom: 8 }}>
          {owed.owedCents > 0 ? <>You owe <b>{R(owed.owedCents)}</b>. It comes off the payout of your next sale, so you don't need to do anything.</> : "All paid up."}
        </div>
        {owed.charges.map((c) => (
          <div key={c.id} className="list-item">
            <div className="grow"><b>{R(c.amountCents)}</b><div className="small muted">{c.note}</div></div>
            <span className="small muted">{dateText(c.createdAt)}</span>
          </div>
        ))}
      </>}

      <h3 className="section-title">Your payouts</h3>
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

/** Courier orders need the seller's pickup address. Shows it with Change, or the form when it's missing. */
function PickupCheck() {
  const [p, error, reload] = useLoad(() => api.shopPickup(), []);
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (p === undefined) return null;
  if (p && !editing) return (
    <div className="saved-address">
      <Icon name="pin" size={18} />
      <span className="grow"><b>Courier collects from</b><span className="small muted" style={{ display: "block" }}>{addressLine(p)}</span></span>
      <button className="link" onClick={() => setEditing(true)}>Change</button>
    </div>
  );
  return (
    <div className="card inset" style={{ marginBottom: 12 }}>
      <b>Your pickup address</b>
      <PickupAddressForm initial={p} onSaved={() => { setEditing(false); reload(); }} />
    </div>
  );
}

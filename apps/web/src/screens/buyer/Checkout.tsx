import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FEATURES } from "../../features";
import { bookedByUs, DELIVERY_OPTIONS, DELIVERY_PERKS, deliveryFee, orderParcelSize, orderTotals, PARCEL_SIZES, quotedDeliveryFee, CHARGE_QUOTES, type DeliveryOption, type ParcelSize } from "@app/core";
import { api, type FeedItem, type Offer, type PickupPoint, type SavedDelivery, type StreetAddress } from "../../api";
import { AddressFields, addressLine, addressOk, EMPTY_ADDRESS, LockerPicker } from "../../components/Address";
import { useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { ProductArt } from "../../components/Scene";
import { Choice, ErrorNote, Field, R, Sheet, swatch, useAction } from "../../components/ui";

const FOOD_SLOTS = ["10:00 to 12:00", "12:00 to 14:00", "14:00 to 16:00"];

/** `offer`: a special price from the seller (one item or a bundle), sent in chat. */
/** `auctionPrice`: the winning bid, when the winner is paying for an auction. */
export function CheckoutSheet({ item, onClose, offer, auctionPrice }: { item: FeedItem; onClose: () => void; offer?: Offer | null; auctionPrice?: number | null }) {
  const p = item.product;
  const price = auctionPrice ?? (offer ? offer.priceCents : p.priceCents);
  const extra = offer ? offer.productIds.length - 1 : 0;
  const food = p.mode === "order_now";
  // Lockers come from Bob Go. They can be switched off for a build with VITE_LOCKERS=0.
  const options = (Object.keys(DELIVERY_OPTIONS) as DeliveryOption[]).filter((d) => !!DELIVERY_OPTIONS[d].foodOnly === food && (d !== "pudo_locker" || FEATURES.lockers));
  // Courier and locker prices depend on the parcel size the seller picked (the biggest item in a bundle).
  const [parcel, setParcel] = useState<ParcelSize>(p.parcelSize ?? "small");
  useEffect(() => {
    if (food) return;
    const ids = offer ? offer.productIds : [p.id];
    api.parcelSizes(ids).then((m) => setParcel(orderParcelSize(ids.map((i) => m[i])))).catch(() => {});
  }, [p.id, offer, food]);
  const feeFor = (d: DeliveryOption) => deliveryFee(d, parcel);
  const [size, setSize] = useState(p.sizes.length === 1 ? p.sizes[0] : "");
  const [delivery, setDelivery] = useState<DeliveryOption>(options[0]);
  const [point, setPoint] = useState<PickupPoint | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState<StreetAddress>(EMPTY_ADDRESS);
  const minDate = new Date(Date.now() + (p.leadDays ?? 2) * 86400e3).toISOString().slice(0, 10);
  const [foodDate, setFoodDate] = useState(minDate);
  const [foodSlot, setFoodSlot] = useState(FOOD_SLOTS[0]);
  const [foodMessage, setFoodMessage] = useState("");
  const [credit, setCredit] = useState(false);
  const { busy, error, run } = useAction();
  const nav = useNavigate();
  const { user } = useSession();
  // Saved from the last order: shown as one line with Change, so a repeat order is a couple of taps.
  const [remember, setRemember] = useState(true);
  const [saved, setSaved] = useState<SavedDelivery | null>(null);
  const [editing, setEditing] = useState(true);

  // Instant EFT delivery stamps: 5 give half price delivery.
  const [stamps, setStamps] = useState(0);
  useEffect(() => { api.welcomeCreditAvailable().then(setCredit).catch(() => {}); api.deliveryStamps().then(setStamps).catch(() => {}); }, []);
  useEffect(() => {
    if (user?.displayName) setName((n) => n || user.displayName);
    api.savedDelivery().then((d) => {
      if (!d) return;
      if (d.delivery && options.includes(d.delivery as DeliveryOption)) setDelivery(d.delivery as DeliveryOption);
      if (d.pickupPoint) setPoint(d.pickupPoint);
      if (d.name) setName(d.name);
      if (d.phone) setPhone(d.phone);
      const a = { street: d.street ?? "", suburb: d.suburb ?? "", city: d.city ?? "", province: d.province ?? "", postalCode: d.postalCode ?? "" } as StreetAddress;
      setAddress(a);
      setSaved(d);
      // Saved at sign up or last time: show it as one line with Change, so Buy now is one tap.
      if (d.name && d.phone && (addressOk(a) || d.pickupPoint)) setEditing(false);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const needsAddress = delivery === "courier" || delivery === "baker_delivers";
  const needsContact = needsAddress || delivery === "pudo_locker";
  // Ask couriers before the buyer pays: only offer a locker or address Bob Go can actually book (decided 7 Nov).
  const routeKey = delivery === "pudo_locker" && point ? `L${point.provider}:${point.id}`
    : delivery === "courier" && addressOk(address) ? `C${address.street}|${address.suburb}|${address.city}|${address.province}|${address.postalCode}` : null;
  const [route, setRoute] = useState<{ key: string; ok: boolean; message: string | null; quoteCents: number | null } | null>(null);
  useEffect(() => {
    if (!routeKey) return;
    let live = true;
    const t = window.setTimeout(() => {
      api.checkDelivery({ productId: p.id, delivery: delivery as "courier" | "pudo_locker",
        ...(delivery === "pudo_locker" && point ? { pickupPoint: { id: point.id, provider: point.provider } } : { address: { ...address } }) })
        .then((r) => { if (live) setRoute({ key: routeKey, ...r }); })
        .catch(() => { if (live) setRoute({ key: routeKey, ok: true, message: null, quoteCents: null }); }); // can't check: don't block, checkout checks again
    }, 500);
    return () => { live = false; window.clearTimeout(t); };
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const routeNow = route && route.key === routeKey ? route : null;
  const phoneOk = phone.replace(/\D/g, "").length >= 9;
  // The Pay button says what's still missing instead of failing after the tap.
  const missing = p.sizes.length > 0 && !size ? "Pick a size"
    : feeFor(delivery) === null ? "Too big for a locker"
    : delivery === "pudo_locker" && !point ? "Pick a locker"
    : needsContact && (!name.trim() || !phoneOk) ? "Add your name and cell number"
    : needsAddress && !addressOk(address) ? "Add your delivery address"
    : routeKey && !routeNow ? "Checking couriers…"
    : routeNow && !routeNow.ok ? (delivery === "pudo_locker" ? "Pick another locker" : "Pick another option")
    : null;
  const addressShown = needsContact && (editing || !name || !phoneOk || (needsAddress && !addressOk(address)));
  // Offer to save only when something new was typed or picked: right under the details, before paying.
  const changed = !saved || saved.name !== name.trim() || saved.phone !== phone.trim()
    || (needsAddress && (saved.street !== address.street || saved.suburb !== address.suburb || saved.city !== address.city
      || saved.province !== address.province || saved.postalCode !== address.postalCode))
    || (delivery === "pudo_locker" && saved.pickupPoint?.id !== point?.id);
  const offerSave = needsContact && changed;
  // Orders of R200 or more paid by Instant EFT earn a stamp (given once the return window closes).
  const earnsStamp = price >= DELIVERY_PERKS.stampMinOrder && !food;
  // A nudge when a bigger order would make delivery half price.
  const toHalf = DELIVERY_PERKS.halfPriceFrom - price;
  // Flat delivery prices (decided 7 Nov). CHARGE_QUOTES switches to Bob Go's quote for this route, rounded up to R5.
  const quote = CHARGE_QUOTES && routeNow?.ok && routeNow.quoteCents ? routeNow.quoteCents : null;
  const t = useMemo(() => feeFor(delivery) === null ? null : orderTotals({ itemPrice: price, delivery, parcelSize: parcel, welcomeCreditAvailable: credit, stampsReady: stamps >= DELIVERY_PERKS.stampsNeeded, quotedDeliveryCents: quote }),
    [price, delivery, credit, parcel, stamps, quote]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = () => run(async () => {
    if (offerSave && remember) {
      api.saveDelivery({ delivery, name: name.trim() || undefined, phone: phone.trim() || undefined, ...(addressOk(address) ? address : {}), pickupPoint: point }).catch(() => {});
    }
    const contact = { name: name.trim(), phone: phone.trim() };
    const res = await api.checkout({
      productId: p.id, size: size || undefined, delivery,
      deliveryDetails: delivery === "pudo_locker" ? contact
        : needsAddress ? { ...contact, ...address, address: addressLine(address) } : {},
      ...(delivery === "pudo_locker" && point ? { pickupPoint: { id: point.id, provider: point.provider } } : {}),
      ...(food ? { foodDate, foodSlot, foodMessage } : {}),
      ...(offer ? { offerId: offer.id } : {}),
    });
    if (/^https?:/.test(res.checkoutUrl)) window.location.href = res.checkoutUrl;
    else nav(res.checkoutUrl);
  });

  return (
    <Sheet title={food ? "Order" : "Checkout"} onClose={onClose}
      footer={
        <>
          <ErrorNote error={error} />
          <button className="btn green block big" onClick={pay} disabled={busy || !!missing || !t}>{busy ? "Opening payment…" : missing ?? `Pay ${R(t!.total)}`}</button>
          <p className="small muted row" style={{ justifyContent: "center", margin: "8px 0 0", gap: 6 }}><Icon name="shield" size={15} />Held safely until your {food || auctionPrice ? "check period" : "return window"} closes.</p>
        </>
      }>
      <div className="item-row">
        <div className="thumb art" style={{ width: 48, height: 48 }}><ProductArt productId={p.id} fallback={swatch(p.id)} /></div>
        <div className="grow"><b>{extra ? `Bundle: ${p.title} + ${extra} more` : p.title}</b>
          <div className="small muted">@{item.shop.handle}{offer ? " · special price" : auctionPrice ? " · your winning bid" : ""}</div></div>
        <span style={{ textAlign: "right" }}>
          {offer && offer.listedCents > offer.priceCents && <s className="small muted" style={{ display: "block" }}>{R(offer.listedCents)}</s>}
          <b style={{ fontSize: 17 }}>{R(price)}</b>
        </span>
      </div>

      {p.sizes.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Size</h3>
          <div className="chips" role="group" aria-label="Size" style={{ marginBottom: 16 }}>
            {p.sizes.map((s) => <button key={s} type="button" className="chip size-chip" aria-pressed={size === s} onClick={() => setSize(s)}>{s}</button>)}
          </div>
        </>
      )}

      {food && (
        <>
          <Field label="Date" hint={`Order at least ${p.leadDays ?? 2} days ahead.`}>
            <input type="date" min={minDate} value={foodDate} onChange={(e) => setFoodDate(e.target.value)} />
          </Field>
          <Field label="Time slot">
            <select value={foodSlot} onChange={(e) => setFoodSlot(e.target.value)}>{FOOD_SLOTS.map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
          <Field label="Message on the cake (optional)" hint="Up to 60 characters">
            <input maxLength={60} value={foodMessage} onChange={(e) => setFoodMessage(e.target.value)} placeholder="Happy 21st Thandi" />
          </Field>
          {p.allergens && <div className="note amber" style={{ marginBottom: 14 }}>Allergens: {p.allergens}</div>}
        </>
      )}

      <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Delivery</h3>
      {options.map((d) => {
        const fee = d === delivery && quote && feeFor(d) !== null ? quotedDeliveryFee(quote) : feeFor(d);
        return (
          <Choice key={d} on={delivery === d} onClick={() => setDelivery(d)} title={DELIVERY_OPTIONS[d].label}
            sub={fee === null ? `Too big for a locker (${PARCEL_SIZES[parcel].label.toLowerCase()} parcel)` : DELIVERY_OPTIONS[d].days}
            right={fee === null ? "" : fee ? R(fee) : "Free"} />
        );
      })}
      {bookedByUs(delivery) && !offer && toHalf > 0 && toHalf <= 30000 && t && t.deliveryDiscount === 0 && (
        <p className="small muted" style={{ margin: "-4px 0 12px" }}>Orders of R1,000 or more get half price delivery, and a free locker from R1,500.</p>
      )}
      {delivery === "pudo_locker" && feeFor(delivery) !== null && <LockerPicker value={point} onChange={setPoint} />}
      {routeNow && !routeNow.ok && routeNow.message && <div className="note amber small" role="alert" style={{ margin: "0 0 12px" }}>{routeNow.message}</div>}
      {needsContact && !addressShown && (
        <div className="saved-address">
          <Icon name="user" size={18} />
          <span className="grow"><b>{name}</b> · {phone}{needsAddress && <span className="small muted" style={{ display: "block" }}>{addressLine(address)}</span>}</span>
          <button className="link" onClick={() => setEditing(true)}>Change</button>
        </div>
      )}
      {addressShown && (
        <>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" enterKeyHint="next" /></Field>
          <Field label="Cell number" hint={delivery === "pudo_locker" ? "The locker code is sent here" : undefined}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="082 123 4567" enterKeyHint="next" /></Field>
          {needsAddress && <AddressFields value={address} onChange={setAddress} />}
        </>
      )}
      {offerSave && (
        <label className="check-row">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>{saved ? "Update my saved details" : "Save for next time, so checkout is one tap"}</span>
        </label>
      )}
      {delivery === "collect_cpt" && <div className="note" style={{ marginBottom: 14 }}>We send you a collection code when it is ready at our Cape Town pickup point.</div>}

      <h3 style={{ fontSize: 15, margin: "10px 0 8px" }}>Pay with</h3>
      {/* Nudge to Instant EFT (Ozow): cleared straight away, and it costs us far less than card or SnapScan. */}
      <div className="pay-tip">
        <Icon name="spark" size={18} />
        <span className="grow"><b>{earnsStamp ? "Pay with Instant EFT (Ozow) to earn a delivery stamp" : "Tip: pay with Instant EFT (Ozow)"}</b>
          <span className="small">{earnsStamp
            ? <>5 stamps give you half price delivery. {stamps > 0 && stamps < DELIVERY_PERKS.stampsNeeded ? `You have ${stamps} of 5. ` : ""}It's also confirmed straight away, so the seller can ship today.</>
            : "It's confirmed straight away, so the seller can ship today. A normal bank transfer can take up to 2 days."}</span>
          {earnsStamp && <span className="stamp-row" aria-label={`${Math.min(stamps, 5)} of 5 stamps`}>
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className={i < stamps ? "on" : i === stamps ? "next" : ""} />)}
          </span>}
        </span>
      </div>
      <p className="small muted" style={{ margin: "0 0 16px" }}>Card and SnapScan work too. You pay on TradeSafe's secure page next; we never see your card.</p>
      {t && <div className="price-rows" style={{ marginTop: 8 }}>
        <div className="row"><span>Item</span><span>{R(t.itemPrice)}</span></div>
        <div className="row"><span>Delivery</span><span>{t.deliveryFee ? R(t.deliveryFee) : "Free"}</span></div>
        {t.deliveryDiscount > 0 && <div className="row" style={{ color: "#15803d" }}>
          <span>{t.deliveryPerk === "stamp" ? "Your 5 stamps: half price delivery" : t.deliveryDiscount === t.deliveryFee ? "Free locker on orders of R1,500 or more" : "Half price delivery on orders of R1,000 or more"}</span>
          <span>-{R(t.deliveryDiscount)}</span></div>}
        <div className="row"><span>Buyer protection</span><span>{R(t.protectionFee)}</span></div>
        {t.creditUsed > 0 && <div className="row" style={{ color: "#15803d" }}><span>Reward</span><span>-{R(t.creditUsed)}</span></div>}
        <div className="row total"><span>Total</span><span>{R(t.total)}</span></div>
      </div>}
    </Sheet>
  );
}

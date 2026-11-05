import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FEATURES } from "../../features";
import { DELIVERY_OPTIONS, deliveryFee, orderParcelSize, orderTotals, PARCEL_SIZES, type DeliveryOption, type ParcelSize } from "@app/core";
import { api, type FeedItem, type Offer, type PickupPoint, type StreetAddress } from "../../api";
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
  const [editing, setEditing] = useState(true);

  useEffect(() => { api.welcomeCreditAvailable().then(setCredit).catch(() => {}); }, []);
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
      if (d.name && d.phone && addressOk(a)) setEditing(false);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const needsAddress = delivery === "courier" || delivery === "baker_delivers";
  const needsContact = needsAddress || delivery === "pudo_locker";
  const phoneOk = phone.replace(/\D/g, "").length >= 9;
  // The Pay button says what's still missing instead of failing after the tap.
  const missing = p.sizes.length > 0 && !size ? "Pick a size"
    : feeFor(delivery) === null ? "Too big for a locker"
    : delivery === "pudo_locker" && !point ? "Pick a locker"
    : needsContact && (!name.trim() || !phoneOk) ? "Add your name and cell number"
    : needsAddress && !addressOk(address) ? "Add your delivery address"
    : null;
  const addressShown = needsContact && (editing || !name || !phoneOk || (needsAddress && !addressOk(address)));
  const t = useMemo(() => feeFor(delivery) === null ? null : orderTotals({ itemPrice: price, delivery, parcelSize: parcel, welcomeCreditAvailable: credit }),
    [price, delivery, credit, parcel]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = () => run(async () => {
    if (remember) {
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
        const fee = feeFor(d);
        return (
          <Choice key={d} on={delivery === d} onClick={() => setDelivery(d)} title={DELIVERY_OPTIONS[d].label}
            sub={fee === null ? `Too big for a locker (${PARCEL_SIZES[parcel].label.toLowerCase()} parcel)` : DELIVERY_OPTIONS[d].days}
            right={fee === null ? "" : fee ? R(fee) : "Free"} />
        );
      })}
      {delivery === "pudo_locker" && feeFor(delivery) !== null && <LockerPicker value={point} onChange={setPoint} />}
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
      {needsContact && (
        <label className="check-row">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Save these details for next time</span>
        </label>
      )}
      {delivery === "collect_cpt" && <div className="note" style={{ marginBottom: 14 }}>We send you a collection code when it is ready at our Cape Town pickup point.</div>}

      <h3 style={{ fontSize: 15, margin: "10px 0 8px" }}>Pay with</h3>
      <div className="note" style={{ marginBottom: 16 }}>Instant EFT, card or SnapScan, on our escrow partner's secure page next.</div>
      {t && <div className="price-rows" style={{ marginTop: 8 }}>
        <div className="row"><span>Item</span><span>{R(t.itemPrice)}</span></div>
        <div className="row"><span>Delivery</span><span>{t.deliveryFee ? R(t.deliveryFee) : "Free"}</span></div>
        <div className="row"><span>Buyer protection</span><span>{R(t.protectionFee)}</span></div>
        {t.creditUsed > 0 && <div className="row" style={{ color: "#15803d" }}><span>Reward</span><span>-{R(t.creditUsed)}</span></div>}
        <div className="row total"><span>Total</span><span>{R(t.total)}</span></div>
      </div>}
    </Sheet>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DELIVERY_OPTIONS, orderTotals, type DeliveryOption } from "@app/core";
import { api, type FeedItem } from "../../api";
import { Icon } from "../../components/Icon";
import { ProductArt } from "../../components/Scene";
import { Choice, ErrorNote, Field, R, Sheet, swatch, useAction } from "../../components/ui";

// [CONFIRM] Replace with the PUDO locker list from their API once we have an account.
export const SAMPLE_LOCKERS = ["Rondebosch, Main Road", "Claremont, Cavendish Square", "Gardens Centre, Cape Town", "Observatory, Lower Main", "Woodstock Exchange"];
const FOOD_SLOTS = ["10:00 to 12:00", "12:00 to 14:00", "14:00 to 16:00"];

export function CheckoutSheet({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  const p = item.product;
  const food = p.mode === "order_now";
  const options = (Object.keys(DELIVERY_OPTIONS) as DeliveryOption[]).filter((d) => !!DELIVERY_OPTIONS[d].foodOnly === food);
  const [size, setSize] = useState(p.sizes.length === 1 ? p.sizes[0] : "");
  const [delivery, setDelivery] = useState<DeliveryOption>(options[0]);
  const [locker, setLocker] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const minDate = new Date(Date.now() + (p.leadDays ?? 2) * 86400e3).toISOString().slice(0, 10);
  const [foodDate, setFoodDate] = useState(minDate);
  const [foodSlot, setFoodSlot] = useState(FOOD_SLOTS[0]);
  const [foodMessage, setFoodMessage] = useState("");
  const [credit, setCredit] = useState(false);
  const { busy, error, run } = useAction();
  const nav = useNavigate();

  useEffect(() => { api.welcomeCreditAvailable().then(setCredit).catch(() => {}); }, []);
  const t = useMemo(() => orderTotals({ itemPrice: p.priceCents, delivery, welcomeCreditAvailable: credit }), [p.priceCents, delivery, credit]);

  const pay = () => run(async () => {
    const res = await api.checkout({
      productId: p.id, size: size || undefined, delivery,
      deliveryDetails: delivery === "pudo_locker" ? { locker } : delivery === "courier" || delivery === "baker_delivers" ? { name, phone, address } : {},
      ...(food ? { foodDate, foodSlot, foodMessage } : {}),
    });
    if (/^https?:/.test(res.checkoutUrl)) window.location.href = res.checkoutUrl;
    else nav(res.checkoutUrl);
  });

  return (
    <Sheet title={food ? "Order" : "Checkout"} onClose={onClose}
      footer={
        <>
          <ErrorNote error={error} />
          <button className="btn green block big" onClick={pay} disabled={busy}>{busy ? "Opening payment…" : `Pay ${R(t.total)}`}</button>
          <p className="small muted row" style={{ justifyContent: "center", margin: "8px 0 0", gap: 6 }}><Icon name="shield" size={15} />Held safely until your {food ? "check period" : "return window"} closes.</p>
        </>
      }>
      <div className="item-row">
        <div className="thumb art" style={{ width: 48, height: 48 }}><ProductArt productId={p.id} fallback={swatch(p.id)} /></div>
        <div className="grow"><b>{p.title}</b><div className="small muted">@{item.shop.handle}</div></div>
        <b style={{ fontSize: 17 }}>{R(p.priceCents)}</b>
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
      {options.map((d) => (
        <Choice key={d} on={delivery === d} onClick={() => setDelivery(d)} title={DELIVERY_OPTIONS[d].label} sub={DELIVERY_OPTIONS[d].days}
          right={DELIVERY_OPTIONS[d].fee ? R(DELIVERY_OPTIONS[d].fee) : "Free"} />
      ))}
      {delivery === "pudo_locker" && (
        <Field label="Locker">
          <select value={locker} onChange={(e) => setLocker(e.target.value)}>
            <option value="">Pick a locker</option>
            {SAMPLE_LOCKERS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
      )}
      {(delivery === "courier" || delivery === "baker_delivers") && (
        <>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
          <Field label="Cell number"><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></Field>
          <Field label="Address"><textarea value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" /></Field>
        </>
      )}
      {delivery === "collect_cpt" && <div className="note" style={{ marginBottom: 14 }}>We send you a collection code when it is ready at our Cape Town pickup point.</div>}

      <h3 style={{ fontSize: 15, margin: "10px 0 8px" }}>Pay with</h3>
      <div className="note" style={{ marginBottom: 16 }}>Instant EFT, card or SnapScan, on our escrow partner's secure page next.</div>
      <div className="price-rows" style={{ marginTop: 8 }}>
        <div className="row"><span>Item</span><span>{R(t.itemPrice)}</span></div>
        <div className="row"><span>Delivery</span><span>{t.deliveryFee ? R(t.deliveryFee) : "Free"}</span></div>
        <div className="row"><span>Buyer protection</span><span>{R(t.protectionFee)}</span></div>
        {t.creditUsed > 0 && <div className="row" style={{ color: "#15803d" }}><span>Welcome credit</span><span>-{R(t.creditUsed)}</span></div>}
        <div className="row total"><span>Total</span><span>{R(t.total)}</span></div>
      </div>
    </Sheet>
  );
}

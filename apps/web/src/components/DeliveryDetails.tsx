import { useEffect, useState } from "react";
import { api, type PickupPoint, type SavedDelivery, type StreetAddress } from "../api";
import { AddressFields, addressOk, EMPTY_ADDRESS, LockerPicker } from "./Address";
import { ErrorNote, Field, Segmented, useAction } from "./ui";
import { FEATURES } from "../features";

type Way = "courier" | "pudo_locker";

/**
 * Your delivery details, saved to your account so checkout is one tap: where we send your orders (your door or a
 * locker), and the name and cell number the courier uses. Used at the end of sign up (with Skip for now) and in
 * Settings. Payment is chosen on TradeSafe's secure page each time; we never store card details.
 */
export function DeliveryDetailsForm({ initialName = "", submitLabel = "Save", onDone, onSkip }: {
  initialName?: string; submitLabel?: string; onDone: (d: SavedDelivery) => void; onSkip?: () => void;
}) {
  const [way, setWay] = useState<Way>("courier");
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState<StreetAddress>(EMPTY_ADDRESS);
  const [point, setPoint] = useState<PickupPoint | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    api.savedDelivery().then((d) => {
      if (!d) return;
      if (d.delivery === "pudo_locker" && FEATURES.lockers) setWay("pudo_locker");
      if (d.name) setName(d.name);
      if (d.phone) setPhone(d.phone);
      setAddress({ street: d.street ?? "", suburb: d.suburb ?? "", city: d.city ?? "", province: d.province ?? "", postalCode: d.postalCode ?? "" } as StreetAddress);
      if (d.pickupPoint) setPoint(d.pickupPoint);
    }).catch(() => {});
  }, []);

  const phoneOk = phone.replace(/\D/g, "").length >= 9;
  const ok = name.trim().length >= 2 && phoneOk && (way === "courier" ? addressOk(address) : !!point);
  const save = () => run(async () => {
    const d: SavedDelivery = {
      delivery: way, name: name.trim(), phone: phone.trim(),
      ...(addressOk(address) ? address : {}), pickupPoint: point,
    };
    await api.saveDelivery(d);
    onDone(d);
  });

  return (
    <div className="delivery-form">
      {FEATURES.lockers && (
        <Segmented<Way> label="Where to deliver" value={way} onChange={setWay}
          options={[{ value: "courier", label: "To my door" }, { value: "pudo_locker", label: "A locker near me" }]} />
      )}
      <div style={{ height: 12 }} />
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" enterKeyHint="next" /></Field>
      <Field label="Cell number" hint={way === "pudo_locker" ? "The locker code is sent here" : "The courier calls this number"}>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="082 123 4567" enterKeyHint="next" />
      </Field>
      {way === "courier" ? <AddressFields value={address} onChange={setAddress} /> : <LockerPicker value={point} onChange={setPoint} />}
      <ErrorNote error={error} />
      <button className="btn green block big" disabled={busy || !ok} onClick={save} style={{ marginTop: 6 }}>{busy ? "Saving…" : submitLabel}</button>
      {onSkip && <button className="link block-link" disabled={busy} onClick={onSkip}>Skip for now</button>}
      <p className="small muted" style={{ textAlign: "center", marginTop: 10 }}>You pay on TradeSafe's secure page with Instant EFT, card or SnapScan. We never see or store your card.</p>
    </div>
  );
}

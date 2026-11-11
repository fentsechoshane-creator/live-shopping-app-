import { useEffect, useRef, useState } from "react";
import { addressFromPlace, placesOn, suggestAddresses, type AddressSuggestion } from "../lib/places";
import { api, PROVINCES, type PickupPoint, type ShopPickup, type StreetAddress } from "../api";
import { Choice, ErrorNote, Field, FieldWith, useAction } from "./ui";
import { Icon } from "./Icon";

export const EMPTY_ADDRESS: StreetAddress = { street: "", suburb: "", city: "", province: "", postalCode: "" };
/** Everything a courier needs, in the right shape. */
export const addressOk = (a: StreetAddress) =>
  a.street.trim().length >= 3 && a.suburb.trim().length >= 2 && a.city.trim().length >= 2 && !!a.province && /^\d{4}$/.test(a.postalCode.trim());
export const addressLine = (a: Partial<StreetAddress>) => [a.street, a.suburb, a.city, a.postalCode].filter(Boolean).join(", ");

/** Street, suburb, city, province and postal code: what Bob Go's couriers need. */
export function AddressFields({ value, onChange }: { value: StreetAddress; onChange: (a: StreetAddress) => void }) {
  const set = (k: keyof StreetAddress) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      {placesOn() && <AddressSearch onPick={(a) => onChange({ ...value, ...a } as StreetAddress)} />}
      <Field label="Street address"><input value={value.street} onChange={set("street")} autoComplete="address-line1" placeholder="12 Main Road" enterKeyHint="next" /></Field>
      <div className="two-col">
        <Field label="Suburb"><input value={value.suburb} onChange={set("suburb")} autoComplete="address-level3" placeholder="Rondebosch" enterKeyHint="next" /></Field>
        <Field label="City"><input value={value.city} onChange={set("city")} autoComplete="address-level2" placeholder="Cape Town" enterKeyHint="next" /></Field>
      </div>
      <div className="two-col">
        <Field label="Province">
          <select value={value.province} onChange={set("province")} autoComplete="address-level1">
            <option value="">Pick one</option>
            {PROVINCES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Postal code"><input value={value.postalCode} onChange={(e) => onChange({ ...value, postalCode: e.target.value.replace(/\D/g, "").slice(0, 4) })}
          inputMode="numeric" autoComplete="postal-code" placeholder="7700" enterKeyHint="done" /></Field>
      </div>
    </>
  );
}

/** Google address search: type, pick, and the fields below fill in. The fields stay editable. */
function AddressSearch({ onPick }: { onPick: (a: Partial<StreetAddress>) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<AddressSuggestion[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current) { picked.current = false; return; }
    if (q.trim().length < 4) { setList([]); return; }
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      suggestAddresses(q, ctl.signal).then((r) => { setList(r); setOpen(true); setNote(null); })
        .catch((e) => { if (!ctl.signal.aborted) setNote(e instanceof Error ? e.message : "Address search isn't working. Type it below."); });
    }, 350);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [q]);
  const pick = async (s: AddressSuggestion) => {
    picked.current = true;
    setQ(`${s.main}${s.rest ? `, ${s.rest}` : ""}`); setOpen(false); setList([]);
    try {
      const a = await addressFromPlace(s.placeId);
      onPick(a);
      setNote(a.street && a.postalCode && a.province ? "Check the details below." : "Some parts are missing. Fill them in below.");
    } catch (e) { setNote(e instanceof Error ? e.message : "Couldn't load that address. Type it below."); }
  };
  return (
    <div className="addr-search">
      <FieldWith label="Find your address">{(id) => (
        <span className="addr-input"><Icon name="search" size={17} />
          <input id={id} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => list.length && setOpen(true)} placeholder="Start typing your street address"
            autoComplete="off" enterKeyHint="search" aria-autocomplete="list" aria-expanded={open && list.length > 0} role="combobox" aria-controls="addr-list" />
        </span>
      )}</FieldWith>
      {open && list.length > 0 && (
        <ul className="addr-list" id="addr-list" role="listbox">
          {list.map((s) => (
            <li key={s.placeId} role="option" aria-selected="false">
              <button type="button" onClick={() => pick(s)}><Icon name="pin" size={16} /><span><b>{s.main}</b>{s.rest && <span className="small muted">{s.rest}</span>}</span></button>
            </li>
          ))}
          <li className="addr-google small muted">Results from Google</li>
        </ul>
      )}
      {note && <p className="small muted" style={{ margin: "4px 2px 10px" }}>{note}</p>}
    </div>
  );
}

/** Find a locker or pickup point near you (your location, or a city). */
export function LockerPicker({ value, onChange }: { value: PickupPoint | null; onChange: (p: PickupPoint) => void }) {
  const [points, setPoints] = useState<PickupPoint[] | null>(null);
  const [cities, setCities] = useState<string[]>(["Cape Town", "Johannesburg", "Pretoria", "Durban", "Gqeberha", "Bloemfontein"]);
  const [city, setCity] = useState("");
  const { busy, error, run } = useAction();
  const search = (where: { lat: number; lng: number } | { city: string }) => run(async () => {
    const r = await api.pickupPoints(where);
    setPoints(r.points);
    if (r.cities?.length) setCities(r.cities);
  });
  const nearMe = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => search({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => undefined, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 });
  };
  return (
    <div className="locker-picker">
      {value && !points && (
        <div className="saved-address">
          <Icon name="pin" size={18} />
          <span className="grow"><b>{value.name}</b><span className="small muted" style={{ display: "block" }}>{value.address}</span></span>
          <button className="link" onClick={() => setPoints([])}>Change</button>
        </div>
      )}
      {(!value || points) && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <button type="button" className="btn ghost" onClick={nearMe} disabled={busy}><Icon name="pin" size={16} />Near me</button>
            <select aria-label="City" value={city} onChange={(e) => { setCity(e.target.value); if (e.target.value) search({ city: e.target.value }); }} style={{ flex: 1 }}>
              <option value="">Or pick a city</option>
              {cities.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <ErrorNote error={error} />
          {busy && <p className="small muted">Finding lockers…</p>}
          {points && !busy && points.length === 0 && city && <p className="small muted">No lockers found there right now. Try another city, or pick courier.</p>}
          <div role="group" aria-label="Lockers">
            {(points ?? []).map((p) => (
              <Choice key={`${p.provider}-${p.id}`} on={value?.id === p.id && value.provider === p.provider} onClick={() => { onChange(p); setPoints(null); }}
                title={p.name} sub={p.address} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The seller's pickup address: where the courier collects parcels. Private to the seller and our team. */
export function PickupAddressForm({ initial, onSaved }: { initial: ShopPickup | null; onSaved: (p: ShopPickup) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [addr, setAddr] = useState<StreetAddress>(initial ?? EMPTY_ADDRESS);
  const { busy, error, run } = useAction();
  const ok = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 9 && addressOk(addr);
  const save = () => run(async () => {
    const p = { ...addr, name: name.trim(), phone: phone.trim() };
    await api.saveShopPickup(p);
    onSaved(p);
  });
  return (
    <div className="pickup-form">
      <p className="small muted" style={{ marginTop: 0 }}>Where the courier collects your parcels. Only you and our team see it; buyers don't.</p>
      <Field label="Contact name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
      <Field label="Cell number" hint="The driver calls this number"><input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="082 123 4567" /></Field>
      <AddressFields value={addr} onChange={setAddr} />
      <ErrorNote error={error} />
      <button className="btn dark block" disabled={busy || !ok} onClick={save}>{busy ? "Saving…" : "Save pickup address"}</button>
    </div>
  );
}

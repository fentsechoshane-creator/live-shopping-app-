// Google address search (Places API, New). Only used when VITE_GOOGLE_PLACES_KEY is set; otherwise people type their address.
// The key is a browser key: Google limits it to our web addresses and to the Places API, so it's fine in the app.
// Cost control: one session per address (typing plus the final pick count as one), searches wait for a pause in typing,
// and South Africa only.
import { PROVINCES, type Province, type StreetAddress } from "../api";

export const PLACES_KEY: string = import.meta.env.VITE_GOOGLE_PLACES_KEY ?? "";
export const placesOn = () => PLACES_KEY.length > 10;

export interface AddressSuggestion { placeId: string; main: string; rest: string }

const newToken = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
let session = newToken();

export async function suggestAddresses(input: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const q = input.trim();
  if (!placesOn() || q.length < 4) return [];
  const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": PLACES_KEY },
    body: JSON.stringify({ input: q.slice(0, 120), sessionToken: session, includedRegionCodes: ["za"], languageCode: "en",
      includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"] }),
  });
  if (!r.ok) throw new Error("Address search isn't working right now. Type your address below.");
  const j = await r.json().catch(() => ({}));
  return ((j.suggestions ?? []) as any[]).map((s) => s.placePrediction).filter(Boolean).slice(0, 5).map((p) => ({
    placeId: String(p.placeId),
    main: String(p.structuredFormat?.mainText?.text ?? p.text?.text ?? ""),
    rest: String(p.structuredFormat?.secondaryText?.text ?? ""),
  }));
}

const provinceFrom = (short: string, long: string): Province | "" => {
  const s = short.toUpperCase().replace(/^ZA-/, "");
  const byId = PROVINCES.find((p) => p.id === s || (s === "NL" && p.id === "KZN") || (s === "GT" && p.id === "GP"));
  if (byId) return byId.id;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");
  const l = norm(long);
  return PROVINCES.find((p) => l.includes(norm(p.name)))?.id ?? "";
};

/** The picked address, split into the parts couriers need. Ends the search session (so the next address starts a new one). */
export async function addressFromPlace(placeId: string): Promise<Partial<StreetAddress>> {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(session)}&languageCode=en`;
  session = newToken();
  const r = await fetch(url, { headers: { "X-Goog-Api-Key": PLACES_KEY, "X-Goog-FieldMask": "addressComponents" } });
  if (!r.ok) throw new Error("Couldn't load that address. Type it below instead.");
  const j = await r.json().catch(() => ({}));
  const parts = (j.addressComponents ?? []) as { longText?: string; shortText?: string; types?: string[] }[];
  const get = (...types: string[]) => {
    for (const t of types) { const p = parts.find((x) => x.types?.includes(t)); if (p) return p; }
    return undefined;
  };
  const number = get("street_number")?.longText ?? "";
  const road = get("route")?.longText ?? "";
  const premise = get("subpremise", "premise")?.longText ?? "";
  const prov = get("administrative_area_level_1");
  return {
    street: [premise && !number ? premise : "", [number, road].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    suburb: get("sublocality_level_1", "sublocality", "neighborhood", "sublocality_level_2")?.longText ?? "",
    city: get("locality", "postal_town", "administrative_area_level_2")?.longText ?? "",
    province: prov ? provinceFrom(prov.shortText ?? "", prov.longText ?? "") : "",
    postalCode: (get("postal_code")?.longText ?? "").replace(/\D/g, "").slice(0, 4),
  };
}

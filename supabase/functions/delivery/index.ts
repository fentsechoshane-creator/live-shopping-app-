// Lockers and pickup points near the buyer, for checkout. Signed in only, and rate limited.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import { requireDelivery } from "../_shared/bobgo.ts";

// The middle of each big city, for people who don't share their location.
const CITIES: Record<string, [number, number]> = {
  "Cape Town": [-33.9249, 18.4241], "Johannesburg": [-26.2041, 28.0473], "Pretoria": [-25.7479, 28.2293],
  "Durban": [-29.8587, 31.0218], "Gqeberha": [-33.9608, 25.6022], "Bloemfontein": [-29.0852, 26.1596],
  "East London": [-33.0153, 27.9116], "Polokwane": [-23.9045, 29.4689], "Mbombela": [-25.4753, 30.9694], "Kimberley": [-28.7282, 24.7499],
};

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const uid = await requireUser(req, db);
  const { data: ok } = await db.rpc("take_usage", { p_user: uid, p_kind: "pickup_points", p_max: 60, p_window: "1 hour" });
  if (ok !== true) throw new UserError("Too many searches. Try again in a while.", 429);
  let lat = Number(body?.lat), lng = Number(body?.lng);
  if (typeof body?.city === "string" && CITIES[body.city]) [lat, lng] = CITIES[body.city];
  // South Africa only.
  if (!(lat >= -35.5 && lat <= -21.5 && lng >= 16 && lng <= 33.5)) throw new UserError("Pick a city or share your location.");
  const points = await requireDelivery().pickupPoints(lat, lng);
  return json({ points: points.slice(0, 20), cities: Object.keys(CITIES) });
}));

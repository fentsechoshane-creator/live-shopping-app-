// Suggests a title, type, condition and price from one photo of the item, using Claude.
// Sellers only. Needs the ANTHROPIC_API_KEY secret; without it the app simply hides suggestions.
// The seller always sees and can change every suggestion before posting.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

const MODEL = Deno.env.get("SUGGEST_MODEL") ?? "claude-haiku-5-5";
const LABELS = ["new", "pre_loved", "unbranded_dupe"] as const;
const CONDITIONS = ["like_new", "good", "fair"] as const;

Deno.serve(handler(async (req, body) => {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "Suggestions are not set up yet." }, 503);
  const db = adminClient();
  const uid = await requireUser(req, db);
  const { data: shop } = await db.from("shops").select("status, category").eq("owner_id", uid).single();
  if (!shop || shop.status !== "open") throw new UserError("Only open shops can use suggestions.", 403);

  const image = String(body.image ?? "");
  const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new UserError("Send one JPEG, PNG or WebP photo.");
  if (m[2].length > 1_500_000) throw new UserError("That photo is too big. Try again.");

  const prompt = `You help a small South African seller list an item on a live shopping app. Shop category: ${shop.category}.
Look at the photo and reply with JSON only, no other text:
{"title": string, "label": "new" | "pre_loved" | "unbranded_dupe", "condition": "like_new" | "good" | "fair" | null, "price_rand": number, "description": string}
Rules:
- title: plain words, at most 60 characters, what it is plus colour and size if visible. Never include brand names or logos.
- label: "new" only if it looks unused with tags; otherwise "pre_loved". Use "unbranded_dupe" only if it clearly copies a famous style with no logos.
- condition: for pre_loved only, else null.
- price_rand: a fair asking price in rand for the South African second hand or small seller market. Whole number.
- description: one or two short sentences a buyer would find useful. No hyphens or em dashes.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
        { type: "text", text: prompt },
      ] }],
    }),
  });
  if (!res.ok) {
    console.error("suggest-listing", res.status, await res.text());
    throw new UserError("Couldn't get suggestions right now.", 502);
  }
  const out = await res.json();
  const text: string = out?.content?.find((c: any) => c.type === "text")?.text ?? "";
  let s: any;
  try { s = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { throw new UserError("Couldn't read the suggestions.", 502); }

  const label = LABELS.includes(s.label) ? s.label : "pre_loved";
  return json({
    title: String(s.title ?? "").replace(/[–—-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60),
    label,
    condition: label === "pre_loved" && CONDITIONS.includes(s.condition) ? s.condition : null,
    priceCents: Math.max(1000, Math.min(5_000_000, Math.round(Number(s.price_rand) || 0) * 100)),
    description: String(s.description ?? "").replace(/[–—]/g, ",").trim().slice(0, 300),
  });
}));

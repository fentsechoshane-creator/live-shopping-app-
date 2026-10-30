// Link previews for WhatsApp, Instagram, X, Facebook and others.
// When a chat app fetches a shared myHaul link (/i/<item> or /s/<shop>), we answer with a small page
// carrying the item's picture, title and price. People who open the link get the normal app.
// Runs on Netlify (the web host) [CONFIRM host]. Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
// in the host's settings: both are public values, never the secret service key.
import type { Config, Context } from "https://edge.netlify.com";
import { cardHtml, isPreviewBot, rand } from "./share-card.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (req: Request, context: Context) => {
  if (!isPreviewBot(req.headers.get("user-agent") ?? "")) return context.next();
  const url = new URL(req.url);
  const [, kind, key] = url.pathname.split("/");
  const sbUrl = Netlify.env.get("VITE_SUPABASE_URL");
  const sbKey = Netlify.env.get("VITE_SUPABASE_ANON_KEY");
  if (!sbUrl || !sbKey || !key) return context.next();
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" };
  try {
    if (kind === "i" && UUID.test(key)) {
      const res = await fetch(`${sbUrl}/rest/v1/rpc/share_card`, { method: "POST", headers, body: JSON.stringify({ p_product: key }) });
      const row = (await res.json())?.[0];
      if (!row) return context.next();
      const image = row.mux_playback_id
        ? `https://image.mux.com/${row.mux_playback_id}/thumbnail.jpg?width=1200&height=630&fit_mode=smartcrop`
        : row.image_path ? `${sbUrl}/storage/v1/object/public/videos/${row.image_path}` : `${url.origin}/og.png`;
      return page(cardHtml({
        title: `${row.title} · ${rand(row.price_cents)}`,
        description: `From ${row.shop_name} (@${row.shop_handle}) on myHaul. Your money is held safely until your return window closes.`,
        image, url: url.href, open: `/s/${row.shop_handle}?item=${key}`,
      }));
    }
    if (kind === "s" && /^[a-z0-9._]{3,30}$/.test(key)) {
      const res = await fetch(`${sbUrl}/rest/v1/rpc/shop_public`, { method: "POST", headers, body: JSON.stringify({ p_handle: key }) });
      const row = (await res.json())?.[0];
      if (!row) return context.next();
      return page(cardHtml({
        title: `${row.name} (@${row.handle}) on myHaul`,
        description: row.bio || "Shop this seller's videos on myHaul. Your money is held safely until your return window closes.",
        image: `${url.origin}/og.png`, url: url.href, open: `/s/${row.handle}`,
      }));
    }
  } catch { /* fall through to the normal page */ }
  return context.next();
};

const page = (html: string) => new Response(html, {
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
});

export const config: Config = { path: ["/i/*", "/s/*"] };

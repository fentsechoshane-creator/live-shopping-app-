// Link previews for WhatsApp, Instagram, X, Facebook and others, on Cloudflare Pages (our web host from 6 Nov 2026).
// When a chat app fetches a shared myHaul link (/i/<item> or /s/<shop>), we answer with a small page carrying the
// item's picture, title and price. People who open the link get the normal app.
// Needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Cloudflare's settings: both public, never the service key.
import { cardHtml, isPreviewBot, rand } from "../apps/web/netlify/lib/share-card.ts";

type Ctx = { request: Request; env: Record<string, string | undefined>; params: Record<string, string | string[]>; next: () => Promise<Response> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function share(kind: "i" | "s", ctx: Ctx): Promise<Response> {
  const req = ctx.request;
  if (!isPreviewBot(req.headers.get("user-agent") ?? "")) return ctx.next();
  const url = new URL(req.url);
  const key = String(Array.isArray(ctx.params.key) ? ctx.params.key[0] : ctx.params.key ?? "");
  const sbUrl = ctx.env.VITE_SUPABASE_URL, sbKey = ctx.env.VITE_SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey || !key) return ctx.next();
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" };
  try {
    if (kind === "i" && UUID.test(key)) {
      const res = await fetch(`${sbUrl}/rest/v1/rpc/share_card`, { method: "POST", headers, body: JSON.stringify({ p_product: key }) });
      const row = (await res.json() as any[])?.[0];
      if (!row) return ctx.next();
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
      const row = (await res.json() as any[])?.[0];
      if (!row) return ctx.next();
      return page(cardHtml({
        title: `${row.name} (@${row.handle}) on myHaul`,
        description: row.bio || "Shop this seller's videos on myHaul. Your money is held safely until your return window closes.",
        image: `${url.origin}/og.png`, url: url.href, open: `/s/${row.handle}`,
      }));
    }
  } catch { /* fall through to the normal page */ }
  return ctx.next();
}

// Function pages don't get the _headers file, so they carry their own.
const page = (html: string) => new Response(html, {
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300",
    "content-security-policy": "default-src 'none'; img-src https:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin" },
});

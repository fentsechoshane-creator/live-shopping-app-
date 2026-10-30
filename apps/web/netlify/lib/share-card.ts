// The preview page itself, kept separate so it can be tested without the host.

/** Chat apps and social sites that fetch a link to draw its preview. */
export function isPreviewBot(ua: string) {
  return /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|Discordbot|LinkedInBot|Pinterest|Applebot|Googlebot|bingbot|Snapchat|redditbot|SkypeUriPreview|iMessage/i.test(ua);
}

/** R250 or R1,250 */
export function rand(cents: number) {
  const r = Math.round(cents / 100);
  return `R${r.toLocaleString("en-ZA").replace(/\s| /g, ",")}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function cardHtml(c: { title: string; description: string; image: string; url: string; open: string }) {
  const t = esc(c.title), d = esc(c.description.slice(0, 200)), i = esc(c.image), u = esc(c.url), o = esc(c.open);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:type" content="product"><meta property="og:site_name" content="myHaul">
<meta property="og:title" content="${t}"><meta property="og:description" content="${d}">
<meta property="og:image" content="${i}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${u}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${i}">
<meta http-equiv="refresh" content="0;url=${o}">
</head><body><a href="${o}">${t}</a></body></html>`;
}

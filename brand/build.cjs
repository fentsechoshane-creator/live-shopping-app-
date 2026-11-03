// myHaul logo, drawn from scratch as vectors. Colours are the app's own tokens (apps/web/src/styles.css).
// Outputs: logo.svg (bags + name), icon.svg (bags on a square, for the app icon), mark.svg (bags only), wordmark.svg.
const fs = require("fs");
const opentype = require("opentype.js");
const font = opentype.loadSync(__dirname + "/node_modules/@fontsource/poppins/files/poppins-latin-800-normal.woff");
const OUT = process.argv[2] || __dirname + "/out";
fs.mkdirSync(OUT, { recursive: true });

const C = {
  ink: "#0b0b0f", green: "#22c55e", greenDark: "#16a34a", greenDeep: "#15803d", greenLight: "#4ade80", greenPale: "#86efac",
  grey: "#8e8e93", greyDark: "#6b6b70", greyDeep: "#48484d", white: "#ffffff",
};

/** Text as outlines, so the logo looks the same everywhere without the font. Returns {d, width}. */
function textPath(str, size, x, y, track = -0.02) {
  let cx = x, d = "";
  for (const ch of str) {
    const g = font.charToGlyph(ch);
    d += g.getPath(cx, y, size).toPathData(2);
    cx += (g.advanceWidth / font.unitsPerEm) * size + track * size;
  }
  return { d, width: cx - x - track * size };
}
/** "my" in one colour and "Haul" in another, centred on cx. */
function wordmark(cx, baseline, size, myColor, haulColor) {
  const w = textPath("myHaul", size, 0, 0).width;
  const x = cx - w / 2;
  const my = textPath("my", size, x, baseline);
  const haul = textPath("Haul", size, x + my.width + -0.02 * size, baseline);
  return `<path d="${my.d}" fill="${myColor}"/><path d="${haul.d}" fill="${haulColor}"/>`;
}

let gid = 0;
/**
 * One shopping bag: front panel, a side gusset with a fold, the dark inside showing at the top, rope handles with
 * small eyelets, and a small myHaul print on the front.
 */
/** The same colour in shade: mixed with black. */
const shade = (hex, amount) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, "0")).join("");

function bag({ x, y, w, h, side, front, front2, sideCol, sideFold, inside, handle, handleShine, label, labelX = 0.5, labelY = 0.52, casts = true }) {
  const id = ++gid;
  LAYOUT.push({ x, y, w, h, side });
  const top = y, bottom = y + h, right = x + w;
  const sx = side, sy = side * 0.42; // the side panel goes back and up
  const r = Math.max(3, w * 0.018);
  const hx1 = x + w * 0.3, hx2 = x + w * 0.7, hh = h * 0.36;
  const handlePath = (dx, dy) => `M${hx1 + dx},${top + dy} C${hx1 + dx},${top - hh + dy} ${hx2 + dx},${top - hh + dy} ${hx2 + dx},${top + dy}`;
  const lw = Math.max(5, w * 0.045);
  const labelSize = label?.size ?? w * 0.15;
  return `
  <g class="bag"${casts ? ' filter="url(#lift)"' : ""}>
    <defs>
      <linearGradient id="f${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${front}"/><stop offset="1" stop-color="${front2}"/></linearGradient>
      <linearGradient id="s${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${sideCol}"/><stop offset="1" stop-color="${sideFold}"/></linearGradient>
      <linearGradient id="l${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.15"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.06"/>
        <stop offset="0.55" stop-color="#fff" stop-opacity="0"/><stop offset="0.8" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.13"/>
      </linearGradient>
      <linearGradient id="i${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
    </defs>
    <!-- back handle, seen through the opening -->
    <path d="${handlePath(sx * 0.35, -sy * 0.35)}" fill="none" stroke="${shade(handle, 0.1)}" stroke-width="${lw * 0.9}" stroke-linecap="round"/>
    <!-- inside of the bag -->
    <path d="M${x},${top} L${x + sx},${top - sy} L${right + sx},${top - sy} L${right},${top} Z" fill="${inside}"/>
    <path d="M${x},${top} L${x + sx},${top - sy} L${right + sx},${top - sy} L${right},${top} Z" fill="url(#i${id})"/>
    <!-- side gusset with its centre fold -->
    <path d="M${right},${top} L${right + sx},${top - sy} L${right + sx},${bottom - sy} L${right},${bottom} Z" fill="url(#s${id})"/>
    <path d="M${right + sx * 0.5},${top - sy * 0.5} L${right + sx * 0.5},${bottom - sy * 0.5 - h * 0.12} L${right},${bottom} L${right + sx},${bottom - sy}"
      fill="none" stroke="#000" stroke-opacity="0.12" stroke-width="${Math.max(1.5, w * 0.008)}" stroke-linejoin="round"/>
    <!-- front panel -->
    <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${r}" fill="url(#f${id})"/>
    <!-- light from the top left: brighter top left, a little darker bottom right -->
    <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${r}" fill="url(#l${id})"/>
    <!-- folded top edge -->
    <rect x="${x}" y="${top}" width="${w}" height="${h * 0.07}" rx="${r}" fill="#000" opacity="0.10"/>
    <!-- soft light on the left edge -->
    <rect x="${x}" y="${top}" width="${w * 0.06}" height="${h}" rx="${r}" fill="#fff" opacity="0.10"/>
    <!-- front handle -->
    <path d="${handlePath(0, 0)}" fill="none" stroke="${handle}" stroke-width="${lw}" stroke-linecap="round"/>
    <path d="${handlePath(-lw * 0.18, -lw * 0.22)}" fill="none" stroke="${handleShine}" stroke-width="${lw * 0.28}" stroke-linecap="round" opacity="0.55"
      stroke-dasharray="${hh * 0.9} ${hh * 3}"/>
    <!-- eyelets -->
    <circle cx="${hx1}" cy="${top + h * 0.035}" r="${lw * 0.62}" fill="${handle}"/><circle cx="${hx2}" cy="${top + h * 0.035}" r="${lw * 0.62}" fill="${handle}"/>
    <!-- small printed name -->
    ${label && PRINTS ? `<g opacity="${label.opacity ?? 1}">${wordmark(x + w * labelX, top + h * labelY, labelSize, label.my, label.haul)}</g>` : ""}
  </g>`;
}

/** The shadow a bag throws on the ground: away from the light, so down and to the right, soft at the far end. */
function groundShadow({ x, y, w, h, side }) {
  const bottom = y + h, right = x + w, sx = side, sy = side * 0.42;
  const reach = w * 0.3, drop = h * 0.07;
  return `
  <path d="M${x + 4},${bottom} L${right},${bottom} L${right + sx},${bottom - sy} L${right + sx + reach},${bottom - sy + drop * 0.6} L${x + reach * 0.9},${bottom + drop} Z"
    fill="#000" opacity="0.20" filter="url(#soft)"/>
  <rect x="${x - 2}" y="${bottom - 4}" width="${w + sx * 0.7}" height="9" rx="4" fill="#000" opacity="0.38" filter="url(#contact)"/>`;
}

const LAYOUT = [];
let PRINTS = true;
function bags(prints = true) {
  PRINTS = prints;
  gid = 0; LAYOUT.length = 0;
  // Back left: grey. Back right: green. Front middle: black. Front right: light green. Drawn back to front.
  const list = [
    bag({ x: 170, y: 250, w: 290, h: 400, side: 52, front: C.grey, front2: "#808085", sideCol: C.greyDark, sideFold: C.greyDeep, inside: C.greyDeep,
      handle: C.greyDeep, handleShine: "#c7c7cc", casts: false, labelY: 0.445, label: { my: C.white, haul: C.white, opacity: 0.92, size: 34 } }),
    bag({ x: 455, y: 200, w: 270, h: 470, side: 50, front: C.green, front2: "#1fb956", sideCol: C.greenDark, sideFold: C.greenDeep, inside: C.greenDeep,
      handle: C.greenDeep, handleShine: C.greenPale, labelY: 0.485, label: { my: C.ink, haul: C.white, size: 32 } }),
    bag({ x: 236, y: 440, w: 240, h: 300, side: 42, front: "#17171c", front2: "#121216", sideCol: "#24242a", sideFold: "#0e0e11", inside: "#2c2c33",
      handle: C.greenLight, handleShine: "#d9fbe3", label: { my: C.white, haul: C.green, size: 29 } }),
    bag({ x: 494, y: 530, w: 190, h: 220, side: 34, front: C.greenLight, front2: "#38d26f", sideCol: C.green, sideFold: C.greenDark, inside: C.greenDark,
      handle: C.greenDeep, handleShine: "#ecfdf3", label: { my: C.ink, haul: C.white, size: 23 } }),
  ];
  return LAYOUT.map(groundShadow).join("") + list.join("\n");
}

const defs = `
  <defs>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="14" dy="7" stdDeviation="9" flood-color="#000" flood-opacity="0.24"/>
    </filter>
    <filter id="soft" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="contact" x="-10%" y="-200%" width="120%" height="500%"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="ground" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>`;
const ground = `<ellipse cx="500" cy="770" rx="300" ry="24" fill="#000" opacity="0.07" filter="url(#ground)"/>`;

const svg = (vb, body, bg = "") => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${defs}${bg}
${body}
</svg>
`;

// Full logo: bags over the name.
fs.writeFileSync(`${OUT}/logo.svg`, svg("38 20 860 990", `${ground}${bags()}${wordmark(468, 925, 165, C.ink, C.green)}`));
// Bags only.
fs.writeFileSync(`${OUT}/mark.svg`, svg("80 20 800 790", `${ground}${bags()}`));
// App icon: bags on white, centred, with safe margins.
fs.writeFileSync(`${OUT}/icon.svg`, svg("0 0 1000 1000", `<g transform="translate(500 505) scale(0.9) translate(-468 -430)">${ground}${bags()}</g>`,
  `<rect width="1000" height="1000" fill="#ffffff"/>`));
// Name only, for headers.
fs.writeFileSync(`${OUT}/wordmark.svg`, svg("0 0 1000 260", wordmark(500, 190, 220, C.ink, C.green)));
// The name on a dark background (white "my").
fs.writeFileSync(`${OUT}/wordmark-dark.svg`, svg("0 0 1000 260", wordmark(500, 190, 220, C.white, C.green), `<rect width="1000" height="260" fill="${C.ink}"/>`));
console.log("written to", OUT);

// ===== App store icons (1024 x 1024 masters; Apple rounds the corners itself) =====
const sq = (body, bg = "#ffffff") => svg("0 0 1000 1000", body, `<rect width="1000" height="1000" fill="${bg}"/>`);
// A: bags only, filling the square, no small prints.
fs.writeFileSync(`${OUT}/store-a.svg`, sq(`<g transform="translate(500 520) scale(1.13) translate(-488 -420)">${ground}${bags(false)}</g>`));
// B: bags with the name underneath.
fs.writeFileSync(`${OUT}/store-b.svg`, sq(`<g transform="translate(500 430) scale(0.86) translate(-488 -420)">${ground}${bags(false)}</g>${wordmark(500, 905, 150, C.ink, C.green)}`));
// C: on brand green, with the name in white and black.
fs.writeFileSync(`${OUT}/store-c.svg`, sq(`<g transform="translate(500 430) scale(0.86) translate(-488 -420)">${bags(false)}</g>${wordmark(500, 905, 150, C.ink, C.white)}`, "#ecfdf3"));

// ===== Files for the app and the stores =====
// Android adaptive icon: phones crop it to a circle or rounded square, so the art sits inside the middle safe zone.
fs.writeFileSync(`${OUT}/adaptive-fg.svg`, svg("0 0 1000 1000",
  `<g transform="translate(500 500) scale(0.66) translate(-500 -500)"><g transform="translate(500 430) scale(0.86) translate(-488 -420)">${ground}${bags(false)}</g>${wordmark(500, 905, 150, C.ink, C.green)}</g>`));
// Splash screen: the full logo, small, in the middle of white.
fs.writeFileSync(`${OUT}/splash.svg`, svg("0 0 2732 2732",
  `<g transform="translate(1366 1366) scale(1.05) translate(-468 -515)">${ground}${bags()}${wordmark(468, 925, 165, C.ink, C.green)}</g>`, `<rect width="2732" height="2732" fill="#ffffff"/>`));
// Google Play feature graphic (1024 x 500) and the link preview for WhatsApp and socials (1200 x 630): bags, name and a line.
const line = (str, cx, y, size, color) => { const t = textPath(str, size, 0, 0, 0); return `<path d="${textPath(str, size, cx - t.width / 2, y, 0).d}" fill="${color}"/>`; };
const regular = opentype.loadSync(__dirname + "/node_modules/@fontsource/poppins/files/poppins-latin-500-normal.woff");
const lineR = (str, x, y, size, color) => { let cx = x, d = ""; for (const ch of str) { const g = regular.charToGlyph(ch); d += g.getPath(cx, y, size).toPathData(2); cx += (g.advanceWidth / regular.unitsPerEm) * size; } return { d: `<path d="${d}" fill="${color}"/>`, w: cx - x }; };
const banner = (W, H) => {
  const s = H / 1000 * 1.05;
  const tag = "Shop sellers on video. Money held safely.";
  const cx = W * 0.7;                                   // the name and the line share this centre
  const tagSize = Math.min(H * 0.05, (W * 0.5) / lineR(tag, 0, 0, 1, "#000").w);
  const tagW = lineR(tag, 0, 0, tagSize, "#000").w;
  return svg(`0 0 ${W} ${H}`, `<g transform="translate(${W * 0.25} ${H * 0.52}) scale(${s}) translate(-488 -430)">${ground}${bags(false)}</g>
    <g transform="translate(${cx} ${H * 0.52})">${wordmark(0, 0, Math.min(H * 0.2, W * 0.105), C.ink, C.green)}</g>
    ${lineR(tag, cx - tagW / 2, H * 0.52 + H * 0.11, tagSize, "#55555c").d}`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`);
};
fs.writeFileSync(`${OUT}/feature-graphic.svg`, banner(1024, 500));
fs.writeFileSync(`${OUT}/og.svg`, banner(1200, 630));

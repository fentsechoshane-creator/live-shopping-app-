// App Store and Google Play screenshots: a real app screen in a rounded frame on white, with a short headline.
// Run after report-shots with SHOTS_OUT=store/screenshots/raw/ SHOTS_SIZE=440x956x3. Output in store/screenshots/.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dir = fileURLToPath(new URL("../store/screenshots/", import.meta.url));
const SHOTS = [
  ["feed-tee", "Shop real sellers", "on video", "Watch it, want it, buy it without leaving the video."],
  ["checkout", "Your money is", "held safely", "Paid into escrow and only released after your return window."],
  ["auction-sheet", "Bid on one of a kind", "finds", "Timed auctions with fair rules. No last second sniping."],
  ["chat", "Ask the seller", "anything", "Chat, get a special price or a bundle, and pay in the app."],
  ["order-cake", "Cakes from", "home bakers", "Order for your date. Bakers are checked and certified."],
  ["create-suggest", "Sell from your phone", "in minutes", "Snap it, price it and post. Your shop is checked and trusted."],
];
const data = (path, type) => `data:${type};base64,${readFileSync(dir + path).toString("base64")}`;
const F800 = data("poppins-latin-800-normal.woff2", "font/woff2"), F500 = data("poppins-latin-500-normal.woff2", "font/woff2");
const SIZES = [["ios", 1320, 2868], ["android", 1080, 1920]];
const b = await chromium.launch(); const p = await b.newPage();
for (const [store, W, H] of SIZES) {
  await p.setViewportSize({ width: W, height: H });
  for (const [i, [file, a, g, sub]] of SHOTS.entries()) {
    const head = Math.round(W * 0.085), shotH = H * (store === "ios" ? 0.72 : 0.66), shotW = shotH * (1320 / 2868);
    await p.setContent(`<html><head><style>
      @font-face{font-family:P;font-weight:800;src:url(${F800})}
      @font-face{font-family:P;font-weight:500;src:url(${F500})}
      body{margin:0;width:${W}px;height:${H}px;background:#fff;font-family:P,sans-serif;display:flex;flex-direction:column;align-items:center;overflow:hidden}
      h1{font-weight:800;font-size:${head}px;line-height:1.08;letter-spacing:-0.02em;color:#0b0b0f;text-align:center;margin:${H * 0.05}px ${W * 0.06}px 0}
      h1 span{color:#22c55e;display:block}
      p{font-weight:500;font-size:${Math.round(head * 0.38)}px;color:#55555c;text-align:center;margin:${head * 0.35}px ${W * 0.1}px 0;line-height:1.35}
      .phone{margin-top:auto;margin-bottom:-${shotH * 0.04}px;width:${shotW}px;height:${shotH}px;border-radius:${shotW * 0.11}px;overflow:hidden;
        box-shadow:0 ${H * 0.01}px ${H * 0.03}px rgba(0,0,0,.18),0 0 0 ${W * 0.012}px #0b0b0f}
      .phone img{width:100%;display:block}
    </style></head><body><h1>${a}<span>${g}</span></h1><p>${sub}</p><div class="phone"><img src="${data(`raw/${file}.png`, "image/png")}"></div></body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    await p.screenshot({ path: `${dir}${store === "ios" ? "apple-6.9" : "google-phone"}/${i + 1}-${file}.png` });
  }
}
await b.close();
console.log("done");

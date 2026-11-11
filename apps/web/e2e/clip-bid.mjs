// Records the hold to bid button on a video: the live sign at rest, the countdown while held, the bid going in.
// Run from apps/web after a build: node e2e/clip-bid.mjs <frames folder> <state.json>
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2];
const PORT = 4176, BASE = `http://localhost:${PORT}`, KEY = "lsa-demo-v4";
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 720 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await page.goto(BASE);
await page.waitForTimeout(1500);
// A signed in buyer, from the state the main test leaves behind (with the auction opened again).
const saved = JSON.parse(readFileSync(process.argv[3], "utf8"));
await page.evaluate((saved) => { for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v); }, saved);
await page.goto(BASE);
await page.waitForTimeout(1500);
const skip = page.getByRole("button", { name: "Skip" });
if (await skip.count()) { await skip.click(); await page.waitForTimeout(600); }
const jacket = page.getByRole("region", { name: /Vintage 90s denim jacket/ });
await jacket.scrollIntoViewIfNeeded();
await page.waitForTimeout(1200);
const btn = jacket.getByRole("button", { name: /^Hold to bid/ });
await btn.waitFor();
let f = 0;
// Chrome's own screen stream at full phone sharpness: each frame is saved with its time.
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  frames.push({ t: metadata.timestamp, data });
  try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch { /* closed */ }
});
await cdp.send("Page.startScreencast", { format: "png", maxWidth: 786, maxHeight: 1440, everyNthFrame: 1 });
const t0 = Date.now();
const grab = async (ms) => { await page.waitForTimeout(ms); };
const startAt = () => (Date.now() - t0) / 1000;
console.log("start", startAt()); await grab(5200);                       // the live sign switching
const b = await btn.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down();
await grab(3600);                       // counting down, ring closing
await page.mouse.up();
await grab(2600);                       // bid placed, then back to the live sign
await cdp.send("Page.stopScreencast");
const { writeFileSync } = await import("node:fs");
let list = "";
frames.forEach((fr, i) => {
  const name = `f${String(i).padStart(5, "0")}.png`;
  writeFileSync(`${out}/${name}`, Buffer.from(fr.data, "base64"));
  const next = frames[i + 1]?.t ?? fr.t + 0.04;
  list += `file '${name}'\nduration ${Math.max(0.001, next - fr.t).toFixed(3)}\n`;
});
writeFileSync(`${out}/list.txt`, list);
console.log("frames", frames.length, "seconds", (frames.at(-1).t - frames[0].t).toFixed(1));
await ctx.close();
await browser.close(); server.kill();

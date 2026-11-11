// Records the hold to bid button on a video as a very smooth clip: the live sign at rest, the countdown while held,
// the bid going in. Everything on the page (CSS and timers) runs at a quarter speed while Chrome streams frames, then
// ffmpeg speeds it back up, so the clip has about four times the frames a normal screen recording would.
// Run from apps/web after a build: node e2e/clip-bid.mjs <frames folder> <state.json>
// Then: ffmpeg -f concat -i <folder>/list.txt -vf "setpts=PTS/4,fps=120" -c:v libx264 -pix_fmt yuv420p out.mp4
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [out, statePath] = process.argv.slice(2);
const SLOW = 4;
const PORT = 4176, BASE = `http://localhost:${PORT}`;
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 720 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const saved = JSON.parse(readFileSync(statePath, "utf8"));
await page.goto(BASE + "/terms.html");
await page.evaluate((saved) => { for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v); }, saved);
await page.clock.install();
await page.goto(BASE);
// Stop the page clock so it only moves when we move it.
await page.clock.pauseAt(Date.now() + 1000);
await page.clock.runFor(2000);
const jacket = page.getByRole("region", { name: /Vintage 90s denim jacket/ });
await jacket.scrollIntoViewIfNeeded();
await page.clock.runFor(1500);
const btn = jacket.getByRole("button", { name: /^Hold to bid/ });
await btn.waitFor();

// From here, page time runs at 1/SLOW of real time: CSS through the Animation domain, timers through the clock.
const cdp = await ctx.newCDPSession(page);
await cdp.send("Animation.enable");
await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / SLOW });
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  frames.push({ t: metadata.timestamp, data });
  try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch { /* closed */ }
});
await cdp.send("Page.startScreencast", { format: "png", maxWidth: 786, maxHeight: 1440 });
// Move the page clock in step with real time divided by SLOW, so timers and CSS stay together.
const slow = async (pageMs) => {
  let done = 0, last = Date.now();
  while (done < pageMs) {
    await new Promise((r) => setTimeout(r, 16));
    const now = Date.now(), step = Math.min((now - last) / SLOW, pageMs - done);
    last = now; done += step;
    await page.clock.runFor(step);
  }
};
await slow(5600);                // the live sign switching
const b = await btn.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down();
await slow(3500);                 // counting down, ring closing
await page.mouse.up();
await slow(2600);                 // bid placed, then back to the live sign
await cdp.send("Page.stopScreencast");
let list = "";
frames.forEach((fr, i) => {
  const name = `f${String(i).padStart(5, "0")}.png`;
  writeFileSync(`${out}/${name}`, Buffer.from(fr.data, "base64"));
  const next = frames[i + 1]?.t ?? fr.t + 0.016;
  list += `file '${name}'\nduration ${Math.max(0.001, next - fr.t).toFixed(4)}\n`;
});
writeFileSync(`${out}/list.txt`, list);
console.log("frames", frames.length, "real seconds", (frames.at(-1).t - frames[0].t).toFixed(1));
await ctx.close(); await browser.close(); server.kill();

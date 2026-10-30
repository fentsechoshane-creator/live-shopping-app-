// Store screenshots at Apple (1290 x 2796) and Google (1080 x 1920) sizes, from the demo.
// Run: npm run build && node e2e/store-shots.mjs   Output: store/screenshots/
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = fileURLToPath(new URL(".", import.meta.url));
const out = here + "../store/screenshots/";
const PORT = 4175, BASE = `http://localhost:${PORT}`;
const server = spawn("node", ["../../node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--strictPort"], { cwd: here + "..", stdio: "ignore" });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch();
const sizes = [["apple-6.7", 430, 932], ["google-phone", 360, 640]];
try {
  for (const [name, w, h] of sizes) {
    mkdirSync(out + name, { recursive: true });
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const shot = (n) => page.waitForTimeout(500).then(() => page.screenshot({ path: `${out}${name}/${n}.png` }));
    await page.goto(`${BASE}/signin`);
    await page.getByLabel("Email").fill("thandi@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Code").fill("123456"); // signs in by itself
    await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
    await page.evaluate(() => localStorage.setItem("lsa-welcomed", "1")); // skip the first open welcome
    await page.goto(BASE);
    await page.getByRole("region", { name: /Designer silk shirt/ }).waitFor();
    await shot("1-feed");
    await page.getByRole("region", { name: /Designer silk shirt/ }).getByRole("button", { name: /See details/ }).click();
    await shot("2-item");
    await page.getByRole("dialog").getByRole("button", { name: "Buy now" }).click();
    await shot("3-checkout");
    await page.goto(`${BASE}/s/luxe.resale.ct`);
    await page.getByRole("tab", { name: "Posts" }).first().waitFor();
    await shot("4-shop");
    await page.goto(`${BASE}/explore`);
    await page.getByRole("heading", { name: "Shops to follow" }).waitFor();
    await shot("5-explore");
    await page.close();
  }
  console.log("Store screenshots in " + out);
} catch (e) { console.error(e.message.split("\n")[0]); } finally { await browser.close(); server.kill(); process.exit(0); }

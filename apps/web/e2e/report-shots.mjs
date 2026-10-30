// Screenshots of the real app (demo data) for the AYEF report. Phone size 393 x 850.
// Run: npm run build && node apps/web/e2e/report-shots.mjs   (saved in apps/web/e2e/report/)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = fileURLToPath(new URL(".", import.meta.url));
const out = here + "report/";
mkdirSync(out, { recursive: true });
const PORT = 4175, BASE = `http://localhost:${PORT}`;
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: here + "..", stdio: "pipe" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.setDefaultTimeout(15000);
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
// The demo clips are H.264, which this test browser can't play; serve the same clips as WebM for the screenshots.
const { readFileSync } = await import("node:fs");
for (const c of ["tee", "cake", "runner"]) {
  await page.route(new RegExp(`/assets/${c}-[^/]+\\.mp4`), (r) => r.fulfill({ status: 200, contentType: "video/webm", body: readFileSync(`${here}report/webm/${c}.webm`) }));
}
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}${name}.png` }); console.log("shot", name); };
const fakeFile = (name, type) => ({ name, mimeType: type, buffer: Buffer.from("demo file") });

async function signUp(email, name, handle) {
  await page.goto(`${BASE}/signin`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code").fill("123456");
  const setup = page.getByRole("dialog", { name: "Create your account" });
  await setup.waitFor();
  await setup.getByLabel("Birthday").fill("1999-04-12");
  await setup.getByRole("button", { name: "Next" }).click();
  await setup.getByLabel("Name", { exact: true }).fill(name);
  await setup.getByLabel("Username", { exact: true }).fill(handle);
  await setup.getByText(`@${handle} is available`).waitFor();
  return setup;
}

try {
  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("lsa-welcomed", "1"); });

  // Buyer: create account, feed, checkout, cake order
  const setup = await signUp("thandi@example.com", "Thandi Mokoena", "thandi.mokoena");
  await shot("signup-username");
  await setup.getByRole("button", { name: "Create account" }).click();
  await setup.getByText("Add a profile photo").waitFor();
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await setup.waitFor({ state: "detached" });

  await page.goto(BASE);
  for (const [region, name] of [[/Designer silk shirt/, "feed-shirt"], [/Oversized tee/, "feed-tee"], [/cake/i, "feed-cake"]]) {
    const card = page.getByRole("region", { name: region }).first();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500); // let the video play a moment
    await shot(name);
  }
  const tee = page.getByRole("region", { name: /Oversized tee/ });
  await tee.scrollIntoViewIfNeeded();
  await tee.getByRole("button", { name: "Buy now" }).click();
  const sheet = page.getByRole("dialog", { name: "Checkout" });
  await sheet.waitFor();
  await sheet.getByRole("button", { name: "M", exact: true }).click();
  await sheet.getByRole("button", { name: /Free collection/ }).click();
  await shot("checkout");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });

  const cake = page.getByRole("region", { name: /cake/i }).first();
  await cake.scrollIntoViewIfNeeded();
  await cake.getByRole("button", { name: /Order now/ }).click();
  const order = page.getByRole("dialog", { name: "Order" });
  await order.waitFor();
  await order.getByLabel(/Message on the cake/).fill("Happy 21st Thandi");
  await shot("order-cake");
  await page.keyboard.press("Escape");

  // Chat with a special price (selling in chat)
  await page.getByRole("region", { name: /Oversized tee/ }).getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: /^Message @/ }).click();
  await page.waitForURL(/\/messages\//);
  await page.getByLabel("Message", { exact: true }).fill("Hi, is the tee still available in L?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText(/Thanks for asking/).waitFor({ timeout: 8000 });
  await shot("chat");

  // Seller: sign up, open a shop step by step, list an item, profile checklist
  await page.goto(`${BASE}/me`);
  await page.getByRole("button", { name: "Menu and settings" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(BASE + "/");
  const s2 = await signUp("naledi@example.com", "Naledi Dlamini", "naledi.thrift");
  await s2.getByRole("button", { name: "Create account" }).click();
  await s2.getByText("Add a profile photo").waitFor();
  await s2.locator('input[type="file"]').setInputFiles(here + "fixtures/denim.jpg");
  await s2.getByRole("button", { name: "Done" }).click();
  await s2.waitFor({ state: "detached" });

  await page.goto(`${BASE}/me?tab=selling`);
  await page.getByRole("button", { name: "Open my shop" }).click();
  await page.getByRole("button", { name: /Clothes and thrift/ }).waitFor();
  await shot("seller-1-category");
  await page.getByRole("button", { name: /Clothes and thrift/ }).click();
  await page.getByLabel("Shop name").fill("Naledi Thrift");
  await shot("seller-2-name");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Verify your ID" }).waitFor();
  await page.getByLabel("Cell number").fill("0821234567");
  await page.getByLabel("Photo of your ID or passport").setInputFiles(fakeFile("id.jpg", "image/jpeg"));
  await page.getByLabel("Selfie holding your ID").setInputFiles(fakeFile("selfie.jpg", "image/jpeg"));
  await shot("seller-3-id");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Where we pay you" }).waitFor();
  await page.getByLabel("Bank").selectOption("Capitec");
  await page.getByLabel("Account number").fill("1234567890");
  await page.getByLabel("First name").fill("Naledi");
  await page.getByLabel("Surname").fill("Dlamini");
  await shot("seller-4-bank");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Seller rules" }).waitFor();
  for (const b of await page.locator("main button, .screen button").all()) {
    const t = (await b.textContent()) ?? "";
    if (/video|flaw|2 days|fee|fake|real/i.test(t) && (await b.getAttribute("aria-pressed")) === "false") await b.click().catch(() => {});
  }
  await shot("seller-5-rules");
  await page.getByRole("button", { name: "Open my shop" }).click().catch(() => {});
  await page.getByText(/Founding seller/).first().waitFor();
  await page.waitForTimeout(3500); // demo ID check
  await page.goto(`${BASE}/me`);
  await page.getByText(/Get your shop going/).waitFor();
  await page.getByRole("button", { name: /Get your shop going/ }).click();
  await shot("seller-profile");

  await page.goto(`${BASE}/post?mode=create`);
  await page.getByRole("heading", { name: "Create a listing" }).waitFor();
  await page.getByLabel("Photo or video", { exact: true }).setInputFiles([here + "fixtures/denim.jpg", here + "fixtures/denim-back.jpg"]);
  await page.getByRole("button", { name: "Make photo 2 the cover" }).waitFor();
  await shot("create-photos");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Example suggestion (demo)").waitFor();
  await shot("create-suggest");
  await page.getByRole("button", { name: "Use these" }).click();
  await page.getByRole("radio", { name: /Pre loved/ }).click();
  await page.getByRole("button", { name: "Good", exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Price (rand)").fill("450");
  await page.getByRole("button", { name: "M", exact: true }).click();
  await shot("create-price");

  await page.goto(`${BASE}/post?mode=live`);
  await shot("go-live");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: `${out}failure.png` });
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}

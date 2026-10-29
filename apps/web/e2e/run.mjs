// End to end check of the main journeys in demo mode (no keys needed).
// Run: npm run build && npm run test:e2e   (from the repo root)
// Needs Playwright with Chromium: npm i -D playwright && npx playwright install chromium
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = loadPlaywright();
const here = fileURLToPath(new URL(".", import.meta.url));
const shots = here + "shots/";
mkdirSync(shots, { recursive: true });
const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

function loadPlaywright() {
  try {
    const pw = require("playwright");
    return { chromium: pw.chromium };
  } catch {
    console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
    process.exit(1);
  }
}

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: here + "..", stdio: "pipe" });
await new Promise((r) => setTimeout(r, 2500));

// A fake camera and microphone so the camera screen can be tested.
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
// iPhone 15 in Safari with its toolbars showing: about 393 x 720 usable, touch, 3x screen.
const page = await browser.newPage({ viewport: { width: 393, height: 720 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, permissions: ["camera", "microphone"] });
page.setDefaultTimeout(15000);
// Fonts are not needed for the checks, and some test environments block them.
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let step = 0;
const shot = (name) => (console.log("step", step + 1, name), page.screenshot({ path: `${shots}${String(++step).padStart(2, "0")}-${name}.png` }));
const check = async (cond, msg) => { if (!(await cond)) throw new Error("Check failed: " + msg); };
const fakeFile = (name, type) => ({ name, mimeType: type, buffer: Buffer.from("demo file") });

async function signOut() {
  await page.goto(`${BASE}/me`);
  await page.getByRole("button", { name: "Menu and settings" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(BASE + "/");
}

async function signIn(email) {
  await page.goto(`${BASE}/signin`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

try {
  // ===== Buyer =====
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await page.getByRole("region", { name: /Oversized tee/ }).waitFor();
  await shot("feed");
  await check(page.getByRole("button", { name: "Buy now" }).first().isVisible(), "Buy now visible");

  await page.getByRole("region", { name: /Oversized tee/ }).getByRole("button", { name: "Buy now" }).click();
  await page.waitForURL(/signin/);
  await signIn("buyer@test.co.za");

  const tee = page.getByRole("region", { name: /Oversized tee/ });
  await tee.getByRole("button", { name: /See details/ }).click();
  await page.getByRole("dialog").getByText("Buyer protection.").waitFor();
  await page.waitForTimeout(400); // let the sheet finish rising
  await shot("browse");
  await page.getByRole("dialog").getByRole("button", { name: "Buy now" }).click();
  const sheet = page.getByRole("dialog", { name: "Checkout" });
  await sheet.getByRole("button", { name: "M", exact: true }).click();
  await sheet.getByRole("button", { name: /Free collection/ }).click();
  await sheet.getByText("Welcome credit").waitFor();
  await shot("checkout");
  // R349 + R12 protection, minus the full R50 welcome credit = R311. We top the seller up the difference.
  await check(sheet.getByRole("button", { name: "Pay R311", exact: true }).isVisible(), "total R311 with the R50 welcome credit");
  await sheet.getByRole("button", { name: "Pay R311", exact: true }).click();
  await page.waitForURL(/mock-pay/);
  await shot("mock-pay");
  await page.getByRole("button", { name: "Pay now" }).click();
  await page.waitForURL(/\/orders\//);
  await page.getByText("Paid, money held safely").waitFor();
  await shot("order-paid");

  await page.getByRole("button", { name: "Ship and deliver" }).click();
  await page.getByText("Something wrong?").waitFor();
  await shot("order-delivered");
  await page.getByRole("button", { name: "Skip 8 days" }).click();
  await page.getByText("Complete", { exact: true }).waitFor();
  await check((await page.getByText("Something wrong?").count()) === 0, "return window closed after 8 days");

  await page.goto(`${BASE}/activity`);
  await page.getByText("Payment received").waitFor();
  await shot("activity");
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await page.getByText("Oversized tee, sand").first().waitFor();

  // Follow a seller, then see them in Following and on the profile.
  await page.goto(BASE);
  await page.getByRole("region", { name: /Oversized tee/ }).getByRole("button", { name: "Follow" }).click();
  await page.getByRole("group", { name: "Feed" }).getByRole("button", { name: "Following" }).click();
  await page.getByRole("region", { name: /Oversized tee/ }).waitFor();
  // Like and repost sit beside the product card.
  const teeCard = page.getByRole("region", { name: /Oversized tee/ });
  await teeCard.getByRole("button", { name: /^Like/ }).click();
  await teeCard.getByRole("button", { name: /^Repost/ }).click();
  await check(teeCard.getByRole("button", { name: /^Like/ }).getAttribute("aria-pressed").then((v) => v === "true"), "liked");
  await page.getByText("Reposted by @thrift.with.lebo").first().waitFor(); // shops you follow bring their reposts
  await shot("following");
  await page.goto(`${BASE}/explore`);
  await page.getByRole("heading", { name: "Shops to follow" }).waitFor();
  await shot("explore");
  // Only sellers can post: + asks first, and No leaves you where you were.
  await page.goto(`${BASE}/explore`);
  await page.getByRole("link", { name: /^Post/ }).click();
  await page.getByRole("dialog", { name: "Open a shop?" }).waitFor();
  await page.waitForTimeout(400);
  await shot("seller-gate");
  await page.getByRole("button", { name: "No, not now" }).click();
  await check(Promise.resolve(new URL(page.url()).pathname === "/explore"), "No keeps you on the same screen");
  await page.goto(`${BASE}/me`);
  await page.getByRole("tab", { name: "Posts", selected: true }).waitFor();
  await page.getByText("Open your shop to post").waitFor(); // no shop yet, so Posts asks you to open one
  await shot("me-buying");
  await page.locator(".pstats button", { hasText: "Following" }).click(); // Following count opens the list
  await page.getByRole("dialog", { name: "Following" }).getByText("@thrift.with.lebo").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Likes" }).click();
  await page.getByRole("button", { name: /Oversized tee, sand, R349/ }).waitFor(); // liked video shows on the profile
  await page.getByRole("tab", { name: "Reposts" }).click();
  await page.getByRole("button", { name: /Oversized tee, sand, R349/ }).click();
  await page.getByRole("dialog", { name: "Videos" }).waitFor(); // tapping a tile opens the player
  await page.getByRole("button", { name: "Close videos" }).click();
  await shot("me-reposts");
  // Likes and reposts are public: Lebo's shop page shows the cake Lebo reposted.
  await page.goto(`${BASE}/s/thrift.with.lebo`);
  await page.getByRole("tab", { name: "Reposts" }).click();
  await page.getByRole("button", { name: /Celebration cake/ }).waitFor();
  await shot("shop-reposts");
  await page.goto(`${BASE}/me`);
  await page.getByRole("button", { name: "Menu and settings" }).click();
  await page.getByRole("dialog", { name: "Menu and settings" }).waitFor();
  await page.waitForTimeout(400);
  await shot("menu");
  await page.getByRole("button", { name: "Close menu" }).click();

  // ===== Seller =====
  await signOut();
  await signIn("newseller@test.co.za");
  await page.goto(`${BASE}/me?tab=selling`);
  await page.getByRole("button", { name: "Open my shop" }).click();
  await page.waitForURL(/sell\/start/);
  await page.getByRole("button", { name: /Clothes and thrift/ }).click();
  await page.getByLabel("Shop name").fill("Naledi Thrift");
  await shot("onboard-name");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Verify your ID" }).waitFor();
  await page.getByLabel("Cell number").fill("0821234567");
  await page.getByLabel("Photo of your ID or passport").setInputFiles(fakeFile("id.jpg", "image/jpeg"));
  await page.getByLabel("Selfie holding your ID").setInputFiles(fakeFile("selfie.jpg", "image/jpeg"));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Where we pay you" }).waitFor();
  await page.getByLabel("Bank").selectOption("Capitec");
  await page.getByLabel("Account number").fill("1234567890");
  await page.getByLabel("First name").fill("Naledi");
  await page.getByLabel("Surname").fill("Mokoena");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Seller rules" }).waitFor();
  await check(page.getByRole("button", { name: "Open my shop" }).isDisabled(), "open disabled until rules ticked");
  for (const r of ["Pack every order on video", "Show every flaw", "Ship within 2 days", "No fakes or replicas", "6% fee per sale"]) {
    await page.getByRole("button", { name: new RegExp(r) }).click();
  }
  await shot("onboard-rules");
  await page.getByRole("button", { name: "Open my shop" }).click();
  await page.waitForURL(/me\?tab=selling/);
  await page.getByText(/Founding seller/).first().waitFor();
  await shot("seller-home");
  // Long screens must scroll inside the app frame.
  await check(page.locator(".screen").evaluate((el) => getComputedStyle(el).overflowY === "auto"), "profile scrolls inside the app frame");
  await check(page.getByRole("tab", { name: "Posts", selected: true }).isVisible(), "posts tab chosen");

  // Create a listing, one step at a time. Start with a photo or video from the gallery.
  await page.waitForTimeout(3500); // demo ID approval
  await page.goto(`${BASE}/post?mode=create`);
  await page.getByRole("heading", { name: "Create a listing" }).waitFor();
  await shot("create-start");
  await page.getByLabel("Photo or video", { exact: true }).setInputFiles(fakeFile("clip.mp4", "video/mp4"));
  await page.getByRole("button", { name: "Next" }).click();
  await check(page.getByRole("tablist", { name: "Post" }).count().then((n) => n === 0), "Camera, Create, Live hides after the first page");
  // Replicas are stopped on the step where you type the title.
  await page.getByLabel("Title").fill("Jordan 4 reps 1:1");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText(/Counterfeit Goods Act/).first().waitFor();
  await shot("listing-blocked");
  await page.getByLabel("Title").fill("Vintage denim jacket, size M");
  await page.getByRole("radio", { name: /Pre loved/ }).click();
  await page.getByRole("button", { name: "Good", exact: true }).click();
  await shot("create-what");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Price (rand)").fill("450");
  await page.getByText(/You get R450 after the 0% founding fee/).waitFor(); // founding sellers pay no fee
  await page.getByRole("button", { name: "M", exact: true }).click();
  await shot("create-price");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Caption", { exact: true }).fill("Real denim, every mark on camera");
  // Back goes one step back and keeps what you typed.
  await page.getByRole("button", { name: "Back" }).click();
  await check(page.getByLabel("Price (rand)").inputValue().then((v) => v === "450"), "price kept after going back");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("heading", { name: "Check and post" }).waitFor();
  await shot("create-review");
  await page.getByRole("button", { name: "Post listing" }).click();
  await page.waitForURL((u) => u.pathname === "/me");
  await page.getByRole("link", { name: /Vintage denim jacket, size M/ }).waitFor();
  await shot("seller-listed");

  // Camera: tap the shutter for a photo, then Next takes it to Create.
  await page.goto(`${BASE}/post`);
  const shutter = page.getByRole("button", { name: /Tap for a photo/ });
  await page.waitForFunction(() => document.querySelector(".cam-feed")?.videoWidth > 0, null, { timeout: 15000 });
  await shot("camera");
  await shutter.click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("heading", { name: "What are you selling?" }).waitFor(); // the photo is already in, so Create starts at step 1
  await page.getByRole("button", { name: "Back" }).click();
  await page.locator(".wz-preview img").waitFor(); // back to the first page with the photo, and the switch is back
  await page.getByRole("tab", { name: "Live" }).click();
  await page.getByRole("button", { name: "Go live" }).click();
  await page.getByRole("dialog", { name: "Can't go live yet" }).getByText(/can't go live without stock/).waitFor();
  await page.waitForTimeout(400);
  await shot("live-blocked");

  await page.goto(BASE);
  await page.getByRole("region", { name: /Vintage denim jacket, size M/ }).waitFor();

  // ===== Team =====
  await signOut();
  await signIn("admin@test.co.za");
  await page.goto(`${BASE}/admin`);
  await page.getByRole("heading", { name: "Checks waiting" }).waitFor();
  // The R349 tee bought with the welcome credit leaves a R17.06 top up for us to pay Lebo's Thrift.
  await page.getByText("R17.06").waitFor();
  await shot("admin");

  if (errors.length) throw new Error("Page errors: " + errors.join(" | "));
  console.log(`E2E passed. Screenshots in ${shots}`);
} catch (e) {
  await shot("failure").catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  process.exit(process.exitCode ?? 0);
}

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
// Console errors and warnings are reported (not failed) so we can keep the app clean.
const consoleIssues = new Set();
page.on("requestfailed", (r) => consoleIssues.add(`failed request: ${r.url().slice(0, 90)} (${r.failure()?.errorText})`));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleIssues.add(`${m.type()}: ${m.text().slice(0, 160)}`); });
let step = 0;
const shot = (name) => (console.log("step", step + 1, name), page.screenshot({ path: `${shots}${String(++step).padStart(2, "0")}-${name}.png` }));
const check = async (cond, msg) => { if (!(await cond)) throw new Error("Check failed: " + msg); };
// Swipe on an element with real touch events (Chromium supports new Touch()).
const swipe = (selector, dx, dy = 0, startX = 0.8, startY = 0.5) => page.evaluate(({ selector, dx, dy, startX, startY }) => {
  const el = document.querySelector(selector);
  const r = el.getBoundingClientRect();
  const x = r.left + r.width * startX, y = r.top + Math.min(r.height * startY, 200);
  const t = (cx, cy) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
  el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [t(x, y)], changedTouches: [t(x, y)] }));
  el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [t(x + dx, y + dy)], changedTouches: [t(x + dx, y + dy)] }));
  el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [t(x + dx, y + dy)] }));
}, { selector, dx, dy, startX, startY });
const fakeFile = (name, type) => ({ name, mimeType: type, buffer: Buffer.from("demo file") });

async function signOut() {
  await page.goto(`${BASE}/me`);
  await page.getByRole("button", { name: "Menu and settings" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(BASE + "/");
}

// New accounts go through Create account: birthday, name and username, photo (skipped here).
let setupCount = 0;
async function maybeSetup(name = "Test Person") {
  const setup = page.getByRole("dialog", { name: "Create your account" });
  try { await setup.waitFor({ timeout: 2500 }); } catch { return false; }
  await setup.getByLabel("Birthday").fill("1999-04-12");
  await setup.getByRole("button", { name: "Next" }).click();
  await setup.getByLabel("Name", { exact: true }).fill(name);
  const handle = `tester.${++setupCount}${Date.now() % 1000}`;
  await setup.getByLabel("Username", { exact: true }).fill(handle);
  await setup.getByText(`@${handle} is available`).waitFor();
  await setup.getByRole("button", { name: "Create account" }).click();
  await setup.getByText("Add a profile photo").waitFor();
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await setup.waitFor({ state: "detached" });
  return true;
}

async function signIn(email) {
  await page.goto(`${BASE}/signin`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code").fill("123456"); // signs in by itself once 6 digits are in
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
  await maybeSetup();
}

try {
  // ===== Buyer =====
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  // First open: three welcome screens (swipe or Next), then pick interests.
  const welcome = page.getByRole("dialog", { name: "Welcome to myHaul" });
  await welcome.getByText("Shop from short videos").waitFor();
  await shot("welcome");
  await swipe(".welcome", -150);
  await welcome.getByText("Your money is held safely").waitFor();
  await welcome.getByRole("button", { name: "Skip" }).click();
  await welcome.getByRole("button", { name: /Bakes/ }).click();
  await check(welcome.getByRole("button", { name: /Bakes/ }).getAttribute("aria-pressed").then((v) => v === "true"), "interest picked");
  await shot("welcome-interests");
  await welcome.getByRole("button", { name: "Start watching" }).click();
  await welcome.waitFor({ state: "detached" });
  // Picked Bakes, so the cake comes first in For You.
  await check(page.locator(".video-card").first().getAttribute("aria-label").then((l) => /cake/i.test(l ?? "")), "picked interests come first");
  await page.reload();
  await check(page.getByRole("dialog", { name: "Welcome to myHaul" }).count().then((n) => n === 0), "welcome only shows once");
  await page.getByRole("region", { name: /Oversized tee/ }).waitFor();
  await shot("feed");
  await check(page.getByRole("button", { name: "Buy now" }).first().isVisible(), "Buy now visible");

  // Signed out Buy now: sign in over the feed, then checkout opens by itself. No lost place.
  await page.getByRole("region", { name: /Oversized tee/ }).getByRole("button", { name: "Buy now" }).click();
  const signSheet = page.getByRole("dialog", { name: "Sign in to buy" });
  await signSheet.getByLabel("Email").fill("buyer@test.co.za");
  await signSheet.getByRole("button", { name: "Send code" }).click();
  await signSheet.getByLabel("Code").fill("123456");
  // A new account: Create account first (age check, name, unique username, photo), then checkout opens by itself.
  const setup = page.getByRole("dialog", { name: "Create your account" });
  await setup.getByText("When's your birthday?").waitFor();
  await setup.getByLabel("Birthday").fill("2012-01-01");
  await setup.getByText("You need to be 18 or older").waitFor();
  await check(setup.getByRole("button", { name: "Next" }).isDisabled(), "under 18 can't continue");
  await setup.getByLabel("Birthday").fill("1999-04-12");
  await setup.getByRole("button", { name: "Next" }).click();
  await setup.getByLabel("Name", { exact: true }).fill("Thandi Mokoena");
  await setup.getByLabel("Username", { exact: true }).fill("lebo.m"); // a sample seller already has this one
  await setup.getByText("@lebo.m is taken").waitFor();
  await setup.getByLabel("Username", { exact: true }).fill("support");
  await setup.getByText("That username is reserved.").waitFor();
  await setup.getByLabel("Username", { exact: true }).fill("thandi.mokoena");
  await setup.getByText("@thandi.mokoena is available").waitFor();
  await shot("create-account");
  await setup.getByRole("button", { name: "Create account" }).click();
  await setup.getByText("Add a profile photo").waitFor();
  await setup.locator('input[type="file"]').setInputFiles(here + "fixtures/denim.jpg");
  await setup.getByRole("button", { name: "Done" }).click();
  await page.getByRole("dialog", { name: "Checkout" }).waitFor();
  await check(page.url() === BASE + "/", "still on the feed after signing in");
  await shot("signin-then-checkout");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Checkout" }).waitFor({ state: "detached" });

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
  await page.getByText("Order placed.").waitFor();
  await page.getByRole("button", { name: /Message Lebo/ }).waitFor();
  await shot("order-paid");

  await page.getByRole("button", { name: "Ship and deliver" }).click();
  await page.getByText("Something wrong?").waitFor();
  await shot("order-delivered");
  await page.getByRole("button", { name: "Skip 8 days" }).click();
  await page.getByText("Complete", { exact: true }).waitFor();
  await check((await page.getByText("Something wrong?").count()) === 0, "return window closed after 8 days");

  // A shared item link opens that item straight away.
  await page.goto(`${BASE}/i/p-tee`);
  await page.waitForURL(/\/s\/thrift\.with\.lebo\?item=p-tee/);
  await page.getByRole("region", { name: /Oversized tee/ }).waitFor();
  // The new account shows its username and photo on the profile; Edit profile checks a new username.
  await page.goto(`${BASE}/me`);
  await page.getByText("@thandi.mokoena").waitFor();
  await check(page.locator(".pavatar img").count().then((n) => n === 1), "profile photo shows");
  await page.getByRole("button", { name: "Edit profile" }).click();
  const edit = page.getByRole("dialog", { name: "Edit profile" });
  await edit.getByLabel("Username", { exact: true }).fill("kamva.luxe");
  await edit.getByText("@kamva.luxe is taken").waitFor();
  await edit.getByLabel("Username", { exact: true }).fill("thandi.sells");
  await edit.getByText("@thandi.sells is available").waitFor();
  await shot("edit-profile");
  await edit.getByRole("button", { name: "Save" }).click();
  await page.getByText("@thandi.sells").waitFor();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByRole("dialog", { name: "Edit profile" }).getByText(/You can change it again on/).waitFor();
  await page.keyboard.press("Escape");

  // ===== Auctions: bid, reserve, the end, and the winner pays =====
  await page.goto(BASE);
  const jacket = page.getByRole("region", { name: /Vintage 90s denim jacket/ });
  await jacket.scrollIntoViewIfNeeded();
  await jacket.getByText(/Auction · 1d/).waitFor();
  await jacket.getByRole("button", { name: /^Bid · R700/ }).click();
  const bidSheet = page.getByRole("dialog", { name: /Vintage 90s denim jacket/ });
  await bidSheet.getByText("Reserve not met yet").waitFor();
  await bidSheet.getByText("l***m").first().waitFor(); // other bidders are masked
  await shot("auction-sheet");
  await bidSheet.getByLabel(/Or your own amount/).fill("705");
  await check(bidSheet.getByRole("button", { name: "Bid R705" }).isDisabled(), "a bid under the step can't be placed");
  await bidSheet.getByLabel(/Or your own amount/).fill("900");
  await bidSheet.getByRole("button", { name: "Bid R900" }).click();
  await page.getByText("You're the top bidder at R900").waitFor();
  await bidSheet.getByText("Reserve met").waitFor();
  await page.keyboard.press("Escape");
  // Time's up (moved forward in the demo data): the top bidder wins and pays the winning bid.
  await page.evaluate(() => {
    const k = "lsa-demo-v4", st = JSON.parse(localStorage.getItem(k));
    st.products.find((p) => p.id === "p-auction").auctionEndsAt = new Date(Date.now() - 1000).toISOString();
    localStorage.setItem(k, JSON.stringify(st));
  });
  await page.goto(`${BASE}/activity`);
  await page.getByText("You won: Vintage 90s denim jacket, rare wash").waitFor();
  await page.getByRole("link", { name: /You won/ }).click();
  await page.getByRole("button", { name: "Pay R900" }).first().click();
  const wonSheet = page.getByRole("dialog", { name: /Vintage 90s denim jacket/ });
  await wonSheet.getByText("You won").waitFor();
  await shot("auction-won");
  await wonSheet.getByRole("button", { name: "Pay R900" }).click();
  const payWin = page.getByRole("dialog", { name: "Checkout" });
  await payWin.getByText("your winning bid").waitFor();
  await payWin.getByRole("button", { name: /Free collection/ }).click();
  await shot("auction-won-checkout");
  await payWin.getByRole("button", { name: /^Pay R/ }).click();
  await page.waitForURL(/mock-pay/);
  await page.getByRole("button", { name: "Pay now" }).click();
  await page.waitForURL(/\/orders\//);
  await page.getByText("Order placed.").waitFor();

  // The wallet button explains the credit instead of jumping to the profile.
  await page.goto(BASE);
  await page.getByRole("button", { name: /^Wallet/ }).click();
  await page.getByRole("dialog", { name: "Wallet" }).waitFor();
  await page.keyboard.press("Escape");

  await page.goto(`${BASE}/activity`);
  await page.getByText("Payment received").first().waitFor();
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

  // Comments: read and add; rude words are stopped.
  await page.getByRole("group", { name: "Feed" }).getByRole("button", { name: "For you" }).click();
  const teePost = page.getByRole("region", { name: /Oversized tee/ });
  await teePost.getByRole("button", { name: /^Comments/ }).click();
  const cs = page.getByRole("dialog", { name: /comments?$/ });
  await cs.getByText("Does it shrink?", { exact: false }).waitFor();
  await cs.getByLabel("Add a comment").fill("you bitch");
  await cs.getByRole("button", { name: "Post comment" }).click();
  await cs.getByText(/keep it friendly/).waitFor();
  await cs.getByLabel("Add a comment").fill("Does it come in XL?");
  await cs.getByRole("button", { name: "Post comment" }).click();
  await cs.getByText("Does it come in XL?").waitFor();
  await page.waitForTimeout(300);
  await shot("comments");
  await page.keyboard.press("Escape");

  // Report a post (the store rules need this on every post).
  const shirtPost = page.getByRole("region", { name: /Designer silk shirt/ });
  await shirtPost.scrollIntoViewIfNeeded();
  await shirtPost.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Report post" }).click();
  await page.getByRole("button", { name: "Fake or counterfeit" }).click();
  await page.getByRole("button", { name: "Send report" }).click();
  await page.getByText(/Our team checks reports within 24 hours/).waitFor();

  // Message a seller from the post menu. The sample shop replies; numbers get a warning.
  await teePost.scrollIntoViewIfNeeded();
  await teePost.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Message @thrift.with.lebo" }).click();
  await page.waitForURL(/\/messages\//);
  await page.getByText("Keep payments in the app").waitFor();
  // The item comes with you: "Asking about" the tee, with quick questions.
  await page.getByText("Asking about").waitFor();
  await page.getByRole("button", { name: "Is this still available?" }).click();
  await page.getByLabel("Message", { exact: true }).fill("Hi, is the tee still available in L?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText(/Thanks for asking/).waitFor({ timeout: 8000 });
  await page.getByRole("link", { name: /Item: Oversized tee, sand/ }).first().waitFor(); // the item is on the message
  await check(page.getByText("Asking about").count().then((n) => n === 0), "attachment sent with the message");
  await page.getByLabel("Message", { exact: true }).fill("Can I WhatsApp you on 082 123 4567?");
  await page.getByText(/Sharing numbers or bank details/).waitFor();
  await page.getByLabel("Message", { exact: true }).fill("");
  await shot("chat");
  await page.goto(`${BASE}/activity?tab=messages`);
  await page.getByText("Lebo's Thrift").first().waitFor();

  // Block a shop: its posts disappear from the feed. Unblock from settings.
  await page.goto(BASE);
  const cakePost = page.getByRole("region", { name: /Celebration cake/ });
  await cakePost.scrollIntoViewIfNeeded();
  await cakePost.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Block @sweetcrumbs.ct" }).click();
  await page.getByText(/Blocked @sweetcrumbs.ct/).waitFor();
  await check(page.getByRole("region", { name: /Celebration cake/ }).count().then((n) => n === 0), "blocked shop hidden from the feed");
  await page.goto(`${BASE}/settings/blocked`);
  await page.getByRole("button", { name: "Unblock" }).click();
  await page.getByText("You haven't blocked anyone.").waitFor();
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
  // Every inner screen has Back to the previous screen, even when opened directly.
  await page.goto(`${BASE}/help`);
  await page.getByRole("button", { name: "Back" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto(`${BASE}/explore`);
  await check(Promise.resolve(new URL(page.url()).pathname === "/explore"), "No keeps you on the same screen");
  await page.goto(`${BASE}/me`);
  await page.getByRole("tab", { name: "Posts", selected: true }).waitFor();
  await page.getByText("Open your shop to post").waitFor(); // no shop yet, so Posts asks you to open one
  await shot("me-buying");
  await page.locator(".pstats button", { hasText: "Following" }).click(); // Following count opens the list
  await page.getByRole("dialog", { name: "Following" }).getByText("@thrift.with.lebo").waitFor();
  await swipe(".sheet-drag", 0, 160, 0.5, 0.2); // drag the sheet down to close it
  await page.getByRole("dialog", { name: "Following" }).waitFor({ state: "detached" });
  // Swipe left on the profile grid to move from Posts to Likes.
  await swipe("#grid", -200);
  await page.getByRole("tab", { name: "Likes", selected: true }).waitFor();
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
  // Two photos from the gallery: the first is the cover.
  await page.getByLabel("Photo or video", { exact: true }).setInputFiles([here + "fixtures/denim.jpg", here + "fixtures/denim-back.jpg"]);
  await page.getByRole("button", { name: "Make photo 2 the cover" }).waitFor();
  await shot("create-photos");
  await page.getByRole("button", { name: "Next" }).click();
  // Suggestions from the photo (an example in demo mode), applied with one tap.
  await page.getByText("Example suggestion (demo)").waitFor();
  await shot("create-suggest");
  await page.getByRole("button", { name: "Use these" }).click();
  await check(page.getByLabel("Title").inputValue().then((v) => v === "Denim jacket, light wash, size M"), "suggested title filled in");
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
  await check(page.getByRole("radio", { name: /Auction/ }).isDisabled(), "auctions locked until 5 good orders");
  await page.getByLabel("Price (rand)").fill("450");
  await page.getByText(/You get R450 after the 0% founding fee/).waitFor(); // founding sellers pay no fee
  await page.getByRole("button", { name: "M", exact: true }).click();
  await shot("create-price");
  // Drafts: leave halfway, come back, carry on where you were.
  await page.waitForTimeout(600);
  await page.goto(`${BASE}/post?mode=create`);
  await page.getByText("Continue your draft?").waitFor();
  await shot("create-draft");
  await page.getByRole("button", { name: "Continue" }).click();
  await check(page.getByLabel("Price (rand)").inputValue().then((v) => v === "450"), "draft brought the price back");
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
  await page.getByRole("region", { name: /Vintage denim jacket, size M/ }).getByRole("button", { name: /See details/ }).click();
  await page.getByRole("img", { name: /Vintage denim jacket, size M, photo 2/ }).first().waitFor(); // the extra photo shows in the item sheet
  await page.keyboard.press("Escape");
  // Photo posts are a slideshow with dots.
  await page.getByRole("region", { name: /Vintage denim jacket, size M/ }).getByText("1/2").waitFor();
  await shot("slideshow");

  // A video post: pause, sound and a bar to rewind, with the length.
  await page.goto(`${BASE}/post?mode=create`);
  const startOver = page.getByRole("button", { name: "Start over" });
  if (await startOver.count()) await startOver.click();
  await page.getByLabel("Photo or video", { exact: true }).setInputFiles(here + "fixtures/clip.webm");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Use these" }).click(); // a suggestion from a frame of the video
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /^(Next|Skip)$/ }).click();
  await page.getByRole("button", { name: "Post listing" }).click();
  await page.waitForURL((u) => u.pathname === "/me");
  await page.reload(); // demo uploads must survive a reload
  await page.getByRole("link", { name: "Home" }).click();
  const clipCard = page.getByRole("region", { name: /Denim jacket, light wash/ });
  await clipCard.waitFor();
  await clipCard.scrollIntoViewIfNeeded();
  await clipCard.getByRole("button", { name: "Pause" }).click(); // it plays by itself once on screen
  await clipCard.getByRole("button", { name: "Play" }).waitFor(); // paused: big play button and the time shows
  await check(clipCard.getByRole("slider", { name: "Video position" }).isVisible(), "rewind bar");
  await check(clipCard.locator("video").first().evaluate((v) => !v.muted), "sound is on");
  await shot("video-paused");
  // Hold for 2x speed, double tap the left side to go back 10 seconds.
  const box = await clipCard.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35);
  await page.mouse.down();
  await clipCard.getByText("2x").waitFor();
  await shot("video-2x");
  await page.mouse.up();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.35);
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.35);
  await clipCard.locator(".seek-flash.back").waitFor();

  // ===== Team =====
  await signOut();
  await signIn("admin@test.co.za");
  await page.goto(`${BASE}/admin`);
  await page.getByRole("heading", { name: "Checks waiting" }).waitFor();
  // The R349 tee bought with the welcome credit leaves a R17.06 top up for us to pay Lebo's Thrift.
  await page.getByText("R17.06").waitFor();
  await shot("admin");
  // The report from the buyer is waiting; the team removes the post.
  await page.getByText("Fake or counterfeit").first().waitFor();
  await page.getByRole("button", { name: "Remove" }).first().click();
  await page.getByText("No open reports.").waitFor();

  // Delete my account (store rule): type DELETE, then you're signed out for good.
  await signOut();
  await signIn("leaver@test.co.za");
  await page.goto(`${BASE}/me`);
  await page.getByRole("button", { name: "Menu and settings" }).click();
  await page.getByRole("button", { name: "Delete my account" }).click();
  const del = page.getByRole("dialog", { name: "Delete my account" });
  await check(del.getByRole("button", { name: "Delete my account" }).isDisabled(), "needs DELETE typed");
  await del.getByLabel("Type DELETE to confirm").fill("DELETE");
  await shot("delete-account");
  await del.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto(`${BASE}/me`);
  await page.waitForURL(/signin/); // signed out

  // ===== Selling in chat: the shop sends a special price and holds the item; the buyer buys from the chat =====
  await signIn("lebo@shop.demo");
  await page.goto(`${BASE}/activity?tab=messages`);
  await page.getByRole("link", { name: /Thandi/ }).first().click();
  await page.waitForURL(/\/messages\//);
  await page.getByRole("link", { name: /Oversized tee/ }).first().waitFor(); // the order shows inside the chat too
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: "Send a special price" }).click();
  await page.getByLabel("Offer price (rand)").fill("300");
  await page.getByRole("button", { name: "Send R300" }).click();
  await page.getByText("Special price", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: "Hold an item for them" }).click();
  await page.getByRole("button", { name: "Hold for 6 hours" }).click();
  await page.getByText(/I'm holding this for you/).waitFor();
  await page.getByRole("group", { name: "Saved replies" }).getByRole("button", { name: "Yes, it's available." }).click();
  await page.getByText("Yes, it's available.").last().waitFor();
  await page.waitForTimeout(300);
  await shot("chat-seller");
  await signOut();
  await signIn("buyer@test.co.za");
  await page.goto(`${BASE}/activity?tab=messages`);
  await page.getByRole("link", { name: /Lebo's Thrift/ }).first().click();
  await page.getByRole("button", { name: "Buy for R300" }).click();
  await page.getByRole("dialog", { name: "Checkout" }).getByText("special price", { exact: false }).waitFor();
  await check(page.getByText(/Ends in (24|23) hours/).count().then((n) => n > 0), "offer ends in a day");
  await page.waitForTimeout(400);
  await shot("chat-offer-checkout");

  if (errors.length) throw new Error("Page errors: " + errors.join(" | "));
  if (consoleIssues.size) console.log("Console issues:\n  " + [...consoleIssues].join("\n  "));
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

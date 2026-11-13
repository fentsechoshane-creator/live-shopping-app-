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
const page = await browser.newPage({ viewport: { width: 393, height: 720 }, deviceScaleFactor: Number(process.env.SHOT_SCALE ?? 3), isMobile: true, hasTouch: true, permissions: ["camera", "microphone"] });
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
/** Press and hold a button like a thumb would. `keep` leaves it held (for a screenshot mid hold). */
const hold = async (loc, ms, keep = false) => {
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  if (!keep) await page.mouse.up();
};
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
  await pickBirthday(setup, "1999", "4", "12");
  await setup.getByRole("button", { name: "Next" }).click();
  await setup.getByLabel("Name", { exact: true }).fill(name);
  const handle = `tester.${++setupCount}${Date.now() % 1000}`;
  await setup.getByLabel("Username", { exact: true }).fill(handle);
  await setup.getByText(`@${handle} is available`).waitFor();
  await setup.getByRole("button", { name: "Create account" }).click();
  await setup.getByText("Add a profile photo").waitFor();
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await setup.getByText("Where should we send your orders?").waitFor();
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await setup.waitFor({ state: "detached" });
  return true;
}

/** The birthday step: three wheels (day, month, year). */
async function pickBirthday(scope, y, m, d) {
  await scope.getByLabel("Year", { exact: true }).selectOption(y);
  await scope.getByLabel("Month", { exact: true }).selectOption(m);
  await scope.getByLabel("Day", { exact: true }).selectOption(d);
}

// Accounts made in this run, with their passwords. Sample shops and older demo accounts take 123456.
const PASSWORD = "Haul2026x";
const accounts = new Set();
/** The Sign in / Sign up tabs, inside `scope` (the page or a sheet). */
const authTab = (scope, which) => scope.getByRole("group", { name: "Sign in or sign up" }).getByRole("button", { name: which });
const authSubmit = (scope, label) => scope.locator(".auth-body").getByRole("button", { name: label, exact: true });
/** Sign up on one page: name, email confirmed with the code, username, password twice, birthday. */
async function signUpForm(scope, email, name, handle) {
  await authTab(scope, "Sign up").click();
  await scope.getByLabel("Name", { exact: true }).fill(name);
  await scope.getByLabel("Email", { exact: true }).fill(email);
  await scope.getByRole("button", { name: "Send code" }).click();
  await scope.getByLabel("Code from the email").fill("123456");
  await scope.getByText("Email confirmed").waitFor();
  await scope.getByLabel("Username", { exact: true }).fill(handle);
  await scope.getByText(`@${handle} is available`).waitFor();
  await scope.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await scope.getByLabel("Password again", { exact: true }).fill(PASSWORD);
  await pickBirthday(scope, "1999", "4", "12");
  await scope.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
  await authSubmit(scope, "Sign up").click();
  accounts.add(email);
  // Then the optional steps, both skipped here.
  const after = page.getByRole("dialog", { name: "Create your account" });
  await after.getByText("Add a profile photo").waitFor();
  await after.getByRole("button", { name: "Skip for now" }).click();
  await after.getByText("Where should we send your orders?").waitFor();
  await after.getByRole("button", { name: "Skip for now" }).click();
  await after.waitFor({ state: "detached" });
}

async function signIn(email, name) {
  await page.goto(`${BASE}/signin`);
  if (accounts.has(email) || /@shop\.demo$|^admin|@example\.com$/.test(email)) {
    await authTab(page, "Sign in").click();
    await page.getByLabel("Username or email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(accounts.has(email) ? PASSWORD : "123456");
    await authSubmit(page, "Sign in").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
    await maybeSetup(name); // older accounts without a username still get the Create account steps
  } else {
    await signUpForm(page, email, name ?? "Test Person", `tester.${++setupCount}${Date.now() % 1000}`);
    await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
  }
  // Someone with a new surprise reward sees it first (for example a seller after a first sale).
  const surprise = page.getByRole("dialog", { name: "Surprise reward" });
  if (await surprise.waitFor({ timeout: 1500 }).then(() => true, () => false)) await surprise.getByRole("button", { name: "Nice!" }).click();
}

try {
  // ===== Buyer =====
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  // First open: three welcome screens (swipe or Next), then pick interests.
  const welcome = page.getByRole("dialog", { name: "Welcome to myHaul" });
  await welcome.getByText("Watch. Tap. Buy.").waitFor();
  await shot("welcome");
  await swipe(".welcome", -150);
  await welcome.getByText("Your money is safe").waitFor();
  await welcome.getByRole("button", { name: "Skip" }).click();
  await welcome.getByRole("button", { name: /Bakes/ }).click();
  await check(welcome.getByRole("button", { name: /Bakes/ }).getAttribute("aria-pressed").then((v) => v === "true"), "interest picked");
  await shot("welcome-interests");
  await welcome.getByRole("button", { name: "Next" }).click();
  // Last step: the swipe up lesson over the feed. No button: swiping it away starts watching.
  const coach = page.getByRole("dialog", { name: "How to watch" });
  await coach.getByText("Swipe up").waitFor();
  await page.waitForTimeout(700);
  await shot("welcome-swipe");
  await swipe(".coach", 0, -160, 0.5, 0.7);
  await coach.waitFor({ state: "detached" });
  // Picked Bakes, so the cake comes first in For You.
  await check(page.locator(".video-card").first().getAttribute("aria-label").then((l) => /cake/i.test(l ?? "")), "picked interests come first");
  await page.reload();
  await check(page.getByRole("dialog", { name: "Welcome to myHaul" }).count().then((n) => n === 0), "welcome only shows once");
  await page.getByRole("region", { name: /Oversized tee/ }).waitFor();
  await shot("feed");
  await check(page.getByRole("button", { name: "Buy now" }).first().isVisible(), "Buy now visible");

  // Signed out Buy now: sign in over the feed, then checkout opens by itself. No lost place.
  await page.getByRole("region", { name: /Oversized tee/ }).getByRole("button", { name: "Buy now" }).click();
  const signSheet = page.getByRole("dialog", { name: /Sign (in|up) to buy/ });
  // A first visit opens on Sign up. Everything is checked on this one page before the account is made.
  await check(authTab(signSheet, "Sign up").getAttribute("aria-pressed").then((v) => v === "true"), "new visitors start on Sign up");
  const signUpBtn = authSubmit(signSheet, "Sign up");
  await signSheet.getByLabel("Name", { exact: true }).fill("Thandi Mokoena");
  await signSheet.getByLabel("Email", { exact: true }).fill("buyer@test.co.za");
  await check(signSheet.getByLabel("Username", { exact: true }).count().then((n) => n === 0), "the rest waits until the email is confirmed");
  await signSheet.getByRole("button", { name: "Send code" }).click();
  await signSheet.getByLabel("Code from the email").fill("123456");
  await signSheet.getByText("Email confirmed").waitFor();
  await check(signUpBtn.isDisabled(), "can't sign up with only an email");
  await signSheet.getByLabel("Username", { exact: true }).fill("lebo.m"); // a sample seller already has this one
  await signSheet.getByText("@lebo.m is taken").waitFor();
  await signSheet.getByLabel("Username", { exact: true }).fill("support");
  await signSheet.getByText("That username is reserved.").waitFor();
  await signSheet.getByLabel("Username", { exact: true }).fill("thandi.mokoena");
  await signSheet.getByText("@thandi.mokoena is available").waitFor();
  await signSheet.getByLabel("Password", { exact: true }).fill("short1");
  await signSheet.getByLabel("Password again", { exact: true }).fill("short1");
  await check(signUpBtn.isDisabled(), "a weak password can't sign up");
  await signSheet.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await signSheet.getByLabel("Password again", { exact: true }).fill(PASSWORD + "y");
  await check(signUpBtn.isDisabled(), "passwords must match");
  await signSheet.getByLabel("Password again", { exact: true }).fill(PASSWORD);
  await pickBirthday(signSheet, "2012", "1", "1");
  await signSheet.getByText("You need to be 18 or older").waitFor();
  await check(signUpBtn.isDisabled(), "under 18 can't sign up");
  await pickBirthday(signSheet, "1999", "4", "12");
  await check(signUpBtn.isDisabled(), "must tick the Terms and Privacy Policy");
  await signSheet.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
  await shot("create-account");
  await signUpBtn.click();
  accounts.add("buyer@test.co.za");
  // Then the optional steps (photo, where to send orders), then checkout opens by itself.
  const setup = page.getByRole("dialog", { name: "Create your account" });
  await setup.getByText("Add a profile photo").waitFor();
  await setup.locator('input[type="file"]').setInputFiles(here + "fixtures/denim.jpg");
  await setup.getByRole("button", { name: "Next" }).click();
  // Last step, optional: where to send orders. Saved once, checkout is one tap.
  await setup.getByText("Where should we send your orders?").waitFor();
  await check(setup.getByRole("button", { name: "Save and finish" }).isDisabled(), "save waits for a full address");
  await setup.getByLabel("Cell number").fill("0821234567");
  await setup.getByLabel("Street address").fill("12 Main Road");
  await setup.getByLabel("Suburb").fill("Rondebosch");
  await setup.getByLabel("City", { exact: true }).fill("Cape Town");
  await setup.getByLabel("Province").selectOption("WC");
  await setup.getByLabel("Postal code").fill("7700");
  await shot("signup-delivery");
  await setup.getByRole("button", { name: "Save and finish" }).click();
  const firstPay = page.getByRole("dialog", { name: "Checkout" });
  await firstPay.waitFor();
  await check(page.url() === BASE + "/", "still on the feed after signing in");
  // Saved at sign up: courier picked, the address on one line, nothing to type, and no save switch.
  await firstPay.getByText("12 Main Road, Rondebosch, Cape Town, 7700").waitFor();
  await check(firstPay.getByRole("button", { name: /Courier to your door/ }).getAttribute("aria-pressed").then((v) => v === "true"), "courier picked from saved details");
  await check(firstPay.getByText(/Save for next time|Update my saved details/).count().then((n) => n === 0), "no save switch for saved details");
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
  await shot("checkout");
  // No credit for signing up: the first order is full price, R349 + R12 protection = R361.
  await check(sheet.getByText("Reward", { exact: true }).count().then((n) => n === 0), "no reward on a first order");
  await check(sheet.getByRole("button", { name: "Pay R361", exact: true }).isVisible(), "first order is full price");
  await sheet.getByRole("button", { name: "Pay R361", exact: true }).click();
  await page.waitForURL(/mock-pay/);
  await shot("mock-pay");
  await page.getByRole("button", { name: "Pay now" }).click();
  await page.waitForURL(/\/orders\//);
  await page.getByText("Paid, money held safely").waitFor();
  await page.getByText("Order placed 🎉").waitFor();
  await page.getByRole("button", { name: /Message Lebo/ }).waitFor();
  await shot("order-paid");

  await page.getByRole("button", { name: "Ship and deliver" }).click();
  // The surprise: R50 for a first delivered order, usable once the return window closes.
  const surprise = page.getByRole("dialog", { name: "Surprise reward" });
  await surprise.getByText("R50").waitFor();
  await surprise.getByText(/once the return window closes/).waitFor();
  await page.waitForTimeout(1200); // let the pop and confetti finish
  await shot("reward-surprise");
  await surprise.getByRole("button", { name: "Nice!" }).click();
  await page.getByText("Something wrong?").waitFor();
  await shot("order-delivered");
  await page.getByRole("button", { name: "Skip 8 days" }).click();
  await page.getByText("Complete", { exact: true }).waitFor();
  await check((await page.getByText("Something wrong?").count()) === 0, "return window closed after 8 days");
  // Now it's ready: the wallet shows it, and the surprise doesn't show again.
  await page.goto(BASE);
  await page.getByRole("button", { name: "R50 reward ready" }).click();
  await page.getByRole("dialog", { name: "Wallet" }).getByText("Ready. Comes off your next order of R200 or more.").waitFor();
  // That order was paid by Instant EFT (test) and was over R200: once the return window closed it earned a stamp.
  await page.getByRole("dialog", { name: "Wallet" }).getByText("Delivery stamps: 1 of 5").waitFor();
  await page.keyboard.press("Escape");
  await check(page.getByRole("dialog", { name: "Surprise reward" }).count().then((n) => n === 0), "surprise shows once");

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
  // Bid straight from the video: hold the button until the ring closes. Letting go early does nothing.
  const holdBtn = jacket.getByRole("button", { name: /^Hold to bid R720/ });
  await holdBtn.waitFor();
  await hold(holdBtn, 1000);
  await page.waitForTimeout(400);
  await check(await page.getByText("You're the top bidder at R720").count() === 0, "letting go early doesn't bid");
  await page.mouse.move(0, 0); await hold(holdBtn, 1500, true);
  await jacket.locator('.hold[data-phase="holding"] .hold-count i.on').filter({ hasText: /^[12]$/ }).waitFor(); // counting down
  await shot("hold-to-bid");
  await page.mouse.up();
  await hold(holdBtn, 3400);
  await page.getByText("You're the top bidder at R720").waitFor();
  await jacket.getByRole("button", { name: "Bid placed" }).waitFor();
  check(true, "holding for 3 seconds places the bid without leaving the video");
  // The + beside it: pick your own amount, in the bid sheet over the video.
  await jacket.getByRole("button", { name: "Pick your own amount", exact: true }).click();
  const bidSheet = page.getByRole("dialog", { name: /Vintage 90s denim jacket/ });
  await bidSheet.getByText("Reserve not met yet").waitFor();
  const recent = bidSheet.getByRole("button", { name: /^Recent bids/ });
  await check(recent.getAttribute("aria-expanded").then((v) => v === "false"), "recent bids start folded away");
  await recent.click();
  await bidSheet.getByText("l***m").first().waitFor(); // other bidders are masked
  await recent.click();
  await check(recent.getAttribute("aria-expanded").then((v) => v === "false"), "recent bids fold away again");
  await bidSheet.getByRole("button", { name: /^Your bid, R740/ }).waitFor();
  await check(bidSheet.getByRole("button", { name: /^Lower by/ }).isDisabled(), "can't go under the lowest bid");
  await bidSheet.getByRole("button", { name: "Raise by R20" }).click();
  await bidSheet.getByRole("button", { name: /^Your bid, R760/ }).waitFor();
  await bidSheet.getByRole("button", { name: "+R100" }).click();
  await bidSheet.getByRole("button", { name: /^Your bid, R860/ }).waitFor();
  check(true, "minus and plus move one bid step, quick adds work");
  await page.waitForTimeout(400);
  await shot("auction-sheet");
  // Tap the amount to type it. Too low goes back up to the lowest bid.
  await bidSheet.getByRole("button", { name: /^Your bid, R860/ }).click();
  await bidSheet.getByLabel("Type your bid in rand").fill("725");
  await bidSheet.getByLabel("Type your bid in rand").press("Enter");
  await bidSheet.getByRole("button", { name: /^Your bid, R740/ }).waitFor();
  check(true, "a typed amount under the lowest bid becomes the lowest bid");
  await bidSheet.getByRole("button", { name: /^Your bid, R740/ }).click();
  await bidSheet.getByLabel("Type your bid in rand").fill("900");
  await bidSheet.getByLabel("Type your bid in rand").press("Enter");
  await hold(bidSheet.getByRole("button", { name: /^Hold to bid R900/ }), 3400);
  await page.getByText("You're the top bidder at R900").waitFor();
  // Max bid: on top already, so the max has to be above R900. We only bid for you when someone outbids you.
  await bidSheet.getByRole("switch", { name: "Max bid" }).click();
  await bidSheet.getByText(/Nobody sees your max/).waitFor();
  await bidSheet.getByRole("button", { name: /^Your bid, R920/ }).click();
  await bidSheet.getByLabel("Type your bid in rand").fill("1200");
  await bidSheet.getByLabel("Type your bid in rand").press("Enter");
  await shot("max-bid");
  await hold(bidSheet.getByRole("button", { name: /^Hold to set max R1,200/ }), 3400);
  await page.getByText("Max set to R1,200. You're on top at R900").waitFor();
  await bidSheet.getByText("Your max is R1,200. Turn this on to raise it.").waitFor();
  check(true, "setting a max while on top doesn't raise your own bid");
  await bidSheet.getByText("Reserve met").waitFor();
  await page.keyboard.press("Escape");
  // Time's up (moved forward in the demo data): the top bidder wins and pays the winning bid.
  await page.evaluate(() => {
    const k = "lsa-demo-v4", st = JSON.parse(localStorage.getItem(k));
    st.products.find((p) => p.id === "p-auction").auctionEndsAt = new Date(Date.now() - 1000).toISOString();
    localStorage.setItem(k, JSON.stringify(st));
  });
  await page.goto(`${BASE}/inbox?tab=updates`);
  await page.getByText("You won: Vintage 90s denim jacket, rare wash").waitFor();
  await page.getByRole("link", { name: /You won/ }).click();
  // The "You won" screen: green banner with the video on the left, the details on the right, then Pay.
  await page.locator(".won-banner").getByText("You won").waitFor();
  await page.getByText("Time left to pay").waitFor();
  await page.waitForTimeout(400);
  await shot("auction-won");
  await page.getByRole("button", { name: /Watch the video of/ }).click();
  await page.getByRole("dialog", { name: "Videos" }).waitFor();
  await page.getByRole("button", { name: "Close videos" }).click();
  await page.getByRole("button", { name: "Pay R900" }).click();
  const payWin = page.getByRole("dialog", { name: "Checkout" });
  await payWin.getByText("your winning bid").waitFor();
  await payWin.getByRole("button", { name: /Free collection/ }).click();
  await shot("auction-won-checkout");
  await payWin.getByRole("button", { name: /^Pay R/ }).click();
  await page.waitForURL(/mock-pay/);
  await page.getByRole("button", { name: "Pay now" }).click();
  await page.waitForURL(/\/orders\//);
  await page.getByText("Order placed 🎉").waitFor();

  // The reward came off the auction (R900 is over R200), so the wallet button is gone (no "R0").
  await page.goto(BASE);
  await page.getByRole("link", { name: "Home" }).waitFor();
  await check(page.getByRole("button", { name: /reward/ }).count().then((n) => n === 0), "no wallet once the reward is used");

  // Inbox: tab labels, chats first, updates second. Orders live on the profile.
  await page.getByRole("link", { name: /^Inbox/ }).click();
  await page.getByRole("button", { name: /^Updates/ }).click();
  await page.getByText("Payment received").first().waitFor();
  await shot("inbox");
  await page.goto(`${BASE}/me`);
  await page.getByRole("button", { name: "My orders" }).click();
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
  await page.getByRole("dialog", { name: "This post" }).getByRole("button", { name: "Message @thrift.with.lebo" }).click();
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
  await page.getByText(/Payments outside myHaul aren.t protected/).waitFor();
  await page.getByLabel("Message", { exact: true }).fill("");
  await shot("chat");
  await page.goto(`${BASE}/inbox?tab=messages`);
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
  await page.getByText("No one blocked").waitFor();
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
  await page.getByRole("button", { name: /Fashion/ }).click();
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
  await check(page.getByRole("tablist", { name: "Post" }).count().then((n) => n === 0), "the Camera and Create switch hides after the first page");
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
  // Parcel size is required: it sets the buyer's delivery price.
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Pick a parcel size, so buyers see the right delivery price.").waitFor();
  await page.getByRole("button", { name: /^Medium/ }).click();
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
  await page.getByRole("heading", { name: "Ready to post?" }).waitFor();
  await shot("create-review");
  await page.getByRole("button", { name: "Post listing" }).click();
  await page.waitForURL((u) => u.pathname === "/me");
  const tile = page.getByRole("button", { name: /Edit Vintage denim jacket, size M/ });
  await tile.waitFor();
  await shot("seller-listed");
  // Sellers can change a listing after posting (11 Nov 2026): price, stock, name, sizes, details, or take it down.
  await tile.click();
  const editSheet = page.getByRole("dialog", { name: "Edit listing" });
  await editSheet.getByLabel("Price in rand").fill("20");
  await editSheet.getByRole("button", { name: "The lowest price is R50." }).waitFor(); // can't save a price that low
  await editSheet.getByLabel("Price in rand").fill("480");
  await editSheet.getByRole("button", { name: "One more" }).click();
  await shot("edit-listing");
  await editSheet.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Listing updated").waitFor();
  await page.getByRole("button", { name: /Edit Vintage denim jacket, size M, R480/ }).waitFor();
  await page.getByRole("button", { name: /Edit Vintage denim jacket, size M, R480/ }).click();
  await editSheet.getByLabel("Price in rand").fill("450");
  await editSheet.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: /Edit Vintage denim jacket, size M, R450/ }).waitFor();

  // Camera: tap the shutter for a photo, then Next takes it to Create.
  await page.goto(`${BASE}/post`);
  const shutter = page.getByRole("button", { name: /Tap for a photo/ });
  await page.waitForFunction(() => document.querySelector(".cam-feed")?.videoWidth > 0, null, { timeout: 15000 });
  await shot("camera");
  // The test camera sends landscape frames, like iPhones do; what we record and photograph must still be upright 9:16.
  const source = await page.evaluate(() => { const v = document.querySelector(".cam-feed"); return [v.videoWidth, v.videoHeight]; });
  console.log(`  test camera sends ${source.join("x")}`);
  // Zoom: tap 2×; the preview zooms (digitally on the test camera) and 2× lights up. Then back to 1×.
  await page.getByRole("button", { name: "Zoom 2 times" }).click();
  await check(page.getByRole("button", { name: "Zoom 2 times" }).getAttribute("aria-pressed").then((v) => v === "true"), "2× is on");
  await check(page.evaluate(() => getComputedStyle(document.querySelector(".cam-feed")).transform !== "none"), "the preview zoomed in");
  await shot("camera-zoom");
  await page.getByRole("button", { name: "Zoom 1 times" }).click();
  const sb = await shutter.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2500); // hold to record
  await page.mouse.up();
  await page.getByRole("button", { name: "Retake" }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => { const v = document.querySelector("video.cam-feed"); return v && !v.srcObject && v.videoWidth > 0; }, null, { timeout: 15000 });
  const recorded = await page.evaluate(() => { const v = document.querySelector("video.cam-feed"); return [v.videoWidth, v.videoHeight]; });
  await check(Promise.resolve(recorded[0] < recorded[1] && Math.abs(recorded[1] / recorded[0] - 16 / 9) < 0.02), `recorded video is upright 9:16 (got ${recorded.join("x")})`);
  await shot("camera-recorded-portrait");
  await page.getByRole("button", { name: "Retake" }).click();
  await page.waitForFunction(() => document.querySelector(".cam-feed")?.videoWidth > 0, null, { timeout: 15000 });
  await shutter.click();
  await page.waitForFunction(() => { const i = document.querySelector('img[alt="Your photo"]'); return i && i.naturalWidth > 0 && Math.abs(i.naturalHeight / i.naturalWidth - 16 / 9) < 0.02; }, null, { timeout: 10000 }); // the photo is upright 9:16 too
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("heading", { name: "What are you selling?" }).waitFor(); // the photo is already in, so Create starts at step 1
  await page.getByRole("button", { name: "Back" }).click();
  await page.locator(".wz-preview img").waitFor(); // back to the first page with the photo, and the switch is back
  // Live selling is built (LiveKit), so its mode shows next to Camera and Create.
  await page.getByRole("tab", { name: "Live" }).waitFor();

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
  await page.getByRole("button", { name: /^Small/ }).click();
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

  // ===== The video editor, CapCut style: timeline, trim handles, placeable text, tags, flaws, cover =====
  await page.goto(`${BASE}/post?mode=create`);
  if (await startOver.count()) await startOver.click();
  await page.getByLabel("Photo or video", { exact: true }).setInputFiles(here + "fixtures/clip.webm");
  await page.getByRole("button", { name: "Edit video" }).click();
  const editor = page.getByRole("dialog", { name: "Edit video" });
  await editor.getByRole("listitem", { name: /^Clip 1, 8 seconds/ }).waitFor();
  await editor.getByLabel("Add clips", { exact: true }).setInputFiles([here + "fixtures/clip2.webm", here + "fixtures/denim.jpg"]);
  await editor.getByRole("listitem", { name: /^Clip 3, 3 seconds/ }).waitFor(); // a photo shows for 3 seconds
  // Trim clip 1 with its start handle (arrow keys move it a tenth of a second; shift a whole second).
  await editor.getByRole("listitem", { name: /^Clip 1/ }).click();
  await editor.getByRole("toolbar", { name: "Clip tools" }).waitFor();
  const startHandle = editor.getByRole("slider", { name: "Clip starts at" });
  await startHandle.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await editor.getByRole("listitem", { name: /^Clip 1, 6 seconds/ }).waitFor();
  // Sound off on clip 2, then move the photo earlier and back.
  await editor.getByRole("listitem", { name: /^Clip 2/ }).click();
  await editor.getByRole("button", { name: "Sound on" }).click();
  await editor.getByRole("listitem", { name: /^Clip 2, 4 seconds, sound off/ }).waitFor();
  await editor.getByRole("listitem", { name: /^Clip 3/ }).click();
  await editor.getByRole("button", { name: "Earlier" }).click();
  await editor.getByRole("listitem", { name: /^Clip 2, 3 seconds, selected/ }).waitFor();
  await editor.getByRole("button", { name: "Later" }).click();
  await editor.getByRole("button", { name: "Done with this" }).click(); // done with the clip (tool bar)
  await editor.getByRole("toolbar", { name: "Add" }).waitFor();
  // Text: type it full screen, pick a style and colour, then drag it on the video.
  await editor.getByRole("button", { name: "Text" }).click();
  const typer = page.getByRole("dialog", { name: "Text" });
  await typer.getByLabel("Text").fill("Size M, fits true");
  await typer.getByRole("button", { name: /Box/ }).click();
  await typer.getByRole("button", { name: "Colour #22c55e" }).click();
  await shot("editor-text");
  await typer.getByRole("button", { name: "Done" }).click();
  const placed = editor.getByRole("button", { name: "Text: Size M, fits true" });
  await placed.waitFor();
  const before = await placed.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 - 80, { steps: 6 });
  await page.mouse.up();
  const after = await placed.boundingBox();
  await check(Promise.resolve(after.y < before.y - 40), "text moved up by dragging");
  await editor.getByRole("button", { name: /Text "Size M, fits true"/ }).waitFor(); // its bar on the timeline
  await editor.getByRole("button", { name: "Done with this" }).click();
  // A tag for this item and a flaw, then the cover.
  await editor.getByRole("button", { name: "Tag item" }).click();
  await page.getByRole("button", { name: /This item/ }).click();
  await editor.getByRole("button", { name: "Done with this" }).click();
  await editor.getByRole("button", { name: "Flaw" }).click();
  await page.getByLabel("What the flaw is").fill("Small mark on the cuff");
  await page.getByRole("button", { name: "Mark this flaw" }).click();
  await editor.getByRole("button", { name: /Flaw Small mark on the cuff/ }).waitFor();
  await editor.getByRole("button", { name: "Done with this" }).click();
  await editor.getByRole("button", { name: "Cover", exact: true }).click();
  await editor.getByText(/Cover set at/).waitFor();
  await check(editor.getByLabel("Time", { exact: true }).textContent().then((x) => x.endsWith("0:13")), "6 + 4 + 3 seconds in total");
  await shot("editor");
  await editor.getByRole("button", { name: "Done", exact: true }).click(); // the top Done: finish editing
  await page.getByRole("button", { name: /Edited · 3 clips/ }).waitFor();
  await page.getByRole("button", { name: "Next" }).click();
  const useThese = page.getByRole("button", { name: "Use these" });
  await useThese.waitFor({ timeout: 4000 }).then(() => useThese.click()).catch(() => {});
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /^Small/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /^(Next|Skip)$/ }).click();
  await page.getByRole("button", { name: "Post listing" }).click();
  await page.waitForURL((u) => u.pathname === "/me");
  await page.reload(); // the edit and every clip survive a reload
  await page.getByRole("link", { name: "Home" }).click();
  const edited = page.locator(".video-card").filter({ has: page.getByRole("button", { name: "Show flaws (1)" }) }).first();
  await edited.waitFor();
  await edited.scrollIntoViewIfNeeded();
  await check(edited.locator(".vtrack.clips i").count().then((n) => n === 3), "three clip segments on the bar");
  await edited.getByRole("button", { name: "Show flaws (1)" }).click(); // jumps to the flaw
  await edited.locator(".flaw-flash").waitFor();
  await shot("edited-post-flaw");

  // ===== Team dashboard =====
  await signOut();
  await signIn("admin@test.co.za");
  await page.goto(`${BASE}/team`);
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  await page.getByText("Needs you").waitFor();
  await shot("team-overview");
  // Money: reward top ups (none here: our cut on the R900 auction is bigger than the R50 reward).
  await page.goto(`${BASE}/team/money`);
  await page.getByRole("heading", { name: "Reward top ups to pay" }).waitFor();
  // To do: reports, checks and the rest in one list; old alert links land here too.
  await page.goto(`${BASE}/team/alerts`);
  await page.waitForURL(/\/team\/todo/);
  await page.getByRole("heading", { name: "Reports" }).waitFor();
  await page.getByRole("heading", { name: "Seller checks" }).waitFor();
  await page.getByText("Alerts we sent").click();
  await page.getByText(/New report/).first().waitFor();
  await shot("team-todo");
  // Search from any page: find Zola by name.
  await page.getByPlaceholder("Search people, shops, emails or orders").fill("zola");
  await page.getByRole("option", { name: /Zola/ }).first().click();
  await page.getByRole("heading", { name: "Zola" }).waitFor();
  // Reports: the reported posts are removed.
  await page.goto(`${BASE}/team/todo?f=reports`);
  await page.getByText("Fake or counterfeit").first().waitFor();
  for (let i = 0; i < 5 && (await page.getByRole("button", { name: "Remove it" }).count()); i++) {
    await page.getByRole("button", { name: "Remove it" }).first().click();
    await page.waitForTimeout(400);
  }
  await page.getByText("No open reports.").waitFor();
  // Accounts: approve a new seller's ID, then suspend someone.
  await page.goto(`${BASE}/team/accounts?f=waiting`);
  await page.getByRole("row", { name: /Zola/ }).click();
  await page.getByRole("heading", { name: "Zola" }).waitFor();
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Approved", { exact: true }).first().waitFor();
  // Features: unlock auctions early for Zola, turn her comments off. Legal checks can't be forced on.
  await page.getByRole("tab", { name: "Features" }).click();
  const feat = (name) => page.locator(".team-feature").filter({ hasText: name });
  await check(feat("Listing items").getByRole("button", { name: "On" }).isDisabled(), "ID and bank checks can't be skipped");
  await feat("Auctions").getByRole("button", { name: "On" }).click();
  let sw = page.getByRole("dialog", { name: /Turn on auctions/ });
  await sw.getByLabel(/only the team sees this/).fill("Founding seller, early auctions.");
  await sw.getByRole("button", { name: "Turn on" }).click();
  await feat("Auctions").getByText(/Turned on by/).waitFor();
  await check(feat("Comments").count().then((n) => n === 0), "only changed switches show");
  await page.getByRole("button", { name: /Show all/ }).click();
  await feat("Comments").getByRole("button", { name: "Off" }).click();
  sw = page.getByRole("dialog", { name: /Turn off comments/ });
  await sw.getByLabel(/only the team sees this/).fill("Spam in comments.");
  await sw.getByRole("button", { name: "Turn off" }).click();
  await feat("Comments").getByText("Blocked").waitFor();
  await page.getByText("2 changed").waitFor();
  await page.locator(".team-features").first().scrollIntoViewIfNeeded();
  await shot("team-features");
  await feat("Comments").getByRole("button", { name: "Auto" }).click();
  await page.getByText("1 changed").waitFor();
  await page.goto(`${BASE}/team/accounts`);
  await page.getByPlaceholder(/Search name/).fill("thabo");
  await page.getByRole("row", { name: /Thabo/ }).click();
  await page.getByRole("button", { name: "Suspend account" }).click();
  const why = page.getByRole("dialog", { name: /Suspend/ });
  await why.getByLabel(/Reason/).fill("Fake reports against sellers.");
  await why.getByRole("button", { name: "Suspend" }).click();
  await page.locator(".team-banner").waitFor();
  await shot("team-person");
  await page.goto(`${BASE}/team/log`);
  await page.getByText("Suspended account").first().waitFor();
  await page.getByText("Auctions: turned on").first().waitFor();
  await page.getByText("Approved ID check").first().waitFor();
  await shot("team-log");
  // The suspended person is told why and can't buy.
  await signOut();
  await signIn("thabo@example.com");
  await page.goto(`${BASE}/me`);
  await page.getByText("Your account is suspended.").waitFor();

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
  await page.goto(`${BASE}/inbox?tab=messages`);
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
  await page.goto(`${BASE}/inbox?tab=messages`);
  await page.getByRole("link", { name: /Lebo's Thrift/ }).first().click();
  await page.getByRole("button", { name: "Buy for R300" }).click();
  await page.getByRole("dialog", { name: "Checkout" }).getByText("special price", { exact: false }).waitFor();
  await check(page.getByText(/Ends in (24|23) hours/).count().then((n) => n > 0), "offer ends in a day");
  await page.waitForTimeout(400);
  await shot("chat-offer-checkout");
  const offerPay = page.getByRole("dialog", { name: "Checkout" });
  await offerPay.getByRole("button", { name: "M", exact: true }).click();
  await offerPay.getByRole("button", { name: /Free collection/ }).click();
  await offerPay.getByRole("button", { name: /^Pay R/ }).click();
  await page.waitForURL(/mock-pay/);
  await page.getByRole("button", { name: "Pay now" }).click();
  await page.waitForURL(/\/orders\//);

  // ===== Buyer offers: offer from the item, the seller accepts, the buyer pays the accepted price =====
  await page.goto(`${BASE}/i/p-denim`);
  const den = page.getByRole("region", { name: /Vintage denim jacket/ });
  await den.getByRole("button", { name: /Message @thrift.with.lebo/ }).waitFor(); // Message is right on the video
  await den.getByRole("button", { name: /See details/ }).click();
  await page.getByRole("dialog", { name: "Vintage denim jacket" }).getByRole("button", { name: "Make an offer" }).click();
  const mo = page.getByRole("dialog", { name: "Make an offer" });
  await mo.getByRole("group", { name: "Suggested offers" }).getByRole("button", { name: /R405/ }).waitFor();
  await mo.getByLabel("Your offer (rand)").fill("100");
  await mo.getByText("The lowest offer is R225.").waitFor(); // at least half the price
  await mo.getByLabel("Your offer (rand)").fill("");
  await mo.getByRole("group", { name: "Suggested offers" }).getByRole("button", { name: /R405/ }).click();
  await shot("make-offer");
  await mo.getByRole("button", { name: "Offer R405" }).click();
  await page.waitForURL(/\/messages\//);
  await page.getByText("Waiting for the seller", { exact: false }).waitFor();
  await signOut();
  await signIn("lebo@shop.demo");
  await page.goto(`${BASE}/inbox?tab=messages`);
  await page.locator(`a[href^="/messages/"]`).first().click(); // newest chat first
  await page.getByText("Offer from the buyer").waitFor();
  await shot("offer-seller");
  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByText("Accepted", { exact: false }).first().waitFor();
  await signOut();
  await signIn("buyer@test.co.za");
  await page.goto(`${BASE}/inbox?tab=messages`);
  await page.getByRole("link", { name: /Lebo's Thrift/ }).first().click();
  await page.getByRole("button", { name: "Buy for R405" }).click();
  await page.getByRole("dialog", { name: "Checkout" }).getByText("R405").first().waitFor();
  await page.getByRole("dialog", { name: "Checkout" }).getByRole("button", { name: "Close" }).click();

  // ===== Delivery through Bob Go: prices by parcel size, a street address, lockers =====
  await page.goto(`${BASE}/i/p-denim`);
  const runner = page.getByRole("region", { name: /Vintage denim jacket/ });
  await runner.getByRole("button", { name: /See details/ }).click();
  await page.getByRole("dialog", { name: "Vintage denim jacket" }).getByRole("button", { name: "Buy now" }).click();
  const pay = page.getByRole("dialog", { name: "Checkout" });
  await pay.getByRole("button", { name: /Courier to your door.*R110/ }).click();
  await check(pay.getByRole("button", { name: /PUDO locker.*R95/ }).isVisible(), "small parcels: R110 door, R95 locker");
  await pay.getByText("Pay with Instant EFT (Ozow) to earn a delivery stamp").waitFor();
  // Saved at sign up: one line, ready to pay. Change opens the form.
  await pay.getByRole("button", { name: /^Pay R/ }).waitFor();
  await pay.getByRole("button", { name: "Change" }).click();
  await pay.getByLabel("Name").fill("Buyer Test");
  await pay.getByLabel("Cell number").fill("0821234567");
  await pay.getByLabel("Street address").fill("12 Main Road");
  await pay.getByLabel("Suburb").fill("Rondebosch");
  await pay.getByLabel("City", { exact: true }).fill("Cape Town");
  await pay.getByLabel("Province").selectOption("WC");
  await pay.getByLabel("Postal code").fill("770");
  await check(pay.getByRole("button", { name: "Add your delivery address" }).isDisabled(), "a 3 digit postal code isn't enough");
  await pay.getByLabel("Postal code").fill("7700");
  await check(pay.getByText("Update my saved details").isVisible(), "changed details offer to update what's saved");
  // A locker instead: pick a city, then a locker from Bob Go's list.
  await pay.getByRole("button", { name: /PUDO locker/ }).click();
  await pay.getByLabel("City", { exact: true }).selectOption("Cape Town");
  // A locker couriers can't reach: checkout says so before paying and won't let you pay.
  await pay.getByRole("button", { name: /PUDO Locker, Robben Island/ }).click();
  await pay.getByText("Couriers can't reach that locker from this seller right now.", { exact: false }).waitFor();
  await check(pay.getByRole("button", { name: "Pick another locker" }).isDisabled(), "can't pay for a locker couriers can't reach");
  await shot("checkout-locker-refused");
  await pay.locator(".locker-picker").getByRole("button", { name: "Change", exact: true }).click();
  await pay.getByLabel("City", { exact: true }).selectOption("Cape Town");
  await pay.getByRole("button", { name: /PUDO Locker, Cavendish Square/ }).click();
  await pay.getByRole("button", { name: /^Pay R/ }).waitFor(); // a reachable locker: Pay comes back
  await pay.getByText("PUDO Locker, Cavendish Square").waitFor();
  await page.waitForTimeout(300);
  await shot("checkout-locker");
  await pay.getByRole("button", { name: /^Pay R/ }).click();
  await page.waitForURL(/mock-pay/);
  await page.getByRole("button", { name: "Pay now" }).click();
  await page.waitForURL(/\/orders\//);

  // ===== Packing proof: no shipping without the video and the sealed parcel photo =====
  await signOut();
  await signIn("lebo@shop.demo");
  await page.goto(`${BASE}/sell/orders`);
  await page.getByRole("link", { name: /Oversized tee/ }).first().click();
  await page.getByText("Packing code", { exact: true }).waitFor();
  const shipBtn = page.getByRole("button", { name: /Mark as shipped|Ready, handed over/ });
  await check(shipBtn.isDisabled(), "can't ship without packing proof");
  await page.getByLabel("Packing video").setInputFiles(here + "../src/assets/demo/tee.mp4");
  await page.getByText(/Packing video added/).waitFor();
  await check(shipBtn.isDisabled(), "still needs the parcel photo");
  await page.getByLabel("Photo of the sealed parcel").setInputFiles(here + "../store/screenshots/raw/checkout.png");
  await page.getByText("Photo of the sealed parcel added").waitFor();
  await shot("packing-proof");
  await shipBtn.click();
  await page.getByText("Marked as shipped").waitFor();
  // The locker order: we book the courier, so the seller needs a pickup address first, then prints the label.
  await page.goto(`${BASE}/sell/orders`);
  await page.getByText("Your pickup address").waitFor();
  await page.getByLabel("Contact name").fill("Lebo M");
  await page.getByLabel("Cell number").fill("0831112222");
  await page.getByLabel("Street address").fill("5 Lower Main Road");
  await page.getByLabel("Suburb").fill("Observatory");
  await page.getByLabel("City", { exact: true }).fill("Cape Town");
  await page.getByLabel("Province").selectOption("WC");
  await page.getByLabel("Postal code").fill("7925");
  await page.getByRole("button", { name: "Save pickup address" }).click();
  await page.getByText("Courier collects from").waitFor();
  await page.getByRole("link", { name: /Vintage denim jacket/ }).first().click();
  await page.getByText(/To a locker: PUDO Locker, Cavendish Square/).waitFor();
  const bookBtn = page.getByRole("button", { name: "Book courier and mark shipped" });
  await page.getByLabel("Packing video").setInputFiles(here + "../src/assets/demo/tee.mp4");
  await page.getByLabel("Photo of the sealed parcel").setInputFiles(here + "../store/screenshots/raw/checkout.png");
  await page.getByText("Photo of the sealed parcel added").waitFor();
  await bookBtn.click();
  await page.getByText("Courier booked. Print the label.").waitFor();
  await page.getByRole("button", { name: "Print courier label" }).waitFor();
  await page.getByText("Booked", { exact: true }).waitFor();
  await shot("courier-booked");
  // The team checks it in To do and gives a strike; the seller is told.
  await signOut();
  await signIn("admin@test.co.za");
  await page.goto(`${BASE}/team/todo?f=packing`);
  await page.getByRole("heading", { name: "Packing checks" }).waitFor();
  await page.getByRole("button", { name: "Check" }).first().click();
  const proof = page.getByRole("dialog", { name: "Packing proof" });
  await proof.getByLabel("Packing video").waitFor();
  await shot("team-packing");
  await proof.getByRole("button", { name: "Doesn't follow the rules" }).click();
  const why2 = page.getByRole("dialog", { name: /packing strike/ });
  await why2.getByLabel(/seller sees this/).fill("The item was never shown out of the bag.");
  await why2.getByRole("button", { name: "Give strike" }).click();
  await proof.getByText("Strike given").waitFor();
  await page.goto(`${BASE}/team/log`);
  await page.getByText("Packing strike 1 of 3").first().waitFor();

  // ===== Friends and sharing: follow, follow back, send a post from Share, chat =====
  await signOut();
  await signIn("nandi@test.co.za", "Nandi");
  await page.goto(`${BASE}/friends`);
  await page.getByLabel("Search people").fill("zola");
  const zolaRow = page.locator(".cell").filter({ hasText: "@zola.vintage" });
  await zolaRow.getByRole("button", { name: "Follow" }).click();
  await zolaRow.getByRole("button", { name: "Following" }).waitFor();
  // Not friends yet: no Message button, and a note on how to become friends.
  await page.goto(`${BASE}/u/zola.vintage`);
  await page.getByText("When they follow you back, you'll be friends.").waitFor();
  await check(page.getByRole("button", { name: "Message" }).count().then((n) => n === 0), "no Message before friends");
  await signOut();
  await signIn("zola@example.com");
  await page.goto(`${BASE}/inbox?tab=updates`);
  await page.getByText("Nandi followed you").waitFor();
  await page.goto(`${BASE}/friends`);
  await page.getByRole("heading", { name: "Follow back to be friends" }).waitFor();
  await page.locator(".cell").filter({ hasText: "Nandi" }).getByRole("button", { name: "Follow back" }).click();
  await page.getByText("You and Nandi are friends now").waitFor();
  // Share a post from the feed to Nandi, with a note.
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("button", { name: "Share" }).first().click();
  const shareSheet = page.getByRole("dialog", { name: "Send to" });
  await shareSheet.getByRole("button", { name: "Nandi" }).click();
  await shareSheet.getByLabel("Add a message").fill("This is so you");
  await shareSheet.getByRole("button", { name: "WhatsApp" }).waitFor();
  await shot("share-sheet");
  await shareSheet.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText("Sent to Nandi").waitFor();
  await signOut();
  // Nandi sees it in the Inbox: friends row, a Friends chat with the post, Buy from the card.
  await signIn("nandi@test.co.za");
  await page.goto(`${BASE}/inbox?tab=messages`);
  await page.getByRole("group", { name: "Friends" }).getByRole("button", { name: "Chat with Zola" }).waitFor();
  const zolaChat = page.getByRole("link", { name: /Zola.*Sent you a post: This is so you/ });
  await zolaChat.waitFor();
  await shot("inbox-friends");
  await zolaChat.click();
  await page.locator(".shared-card").waitFor();
  await page.getByText("This is so you").waitFor();
  await page.getByLabel("Message").fill("Ordering it now!");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Ordering it now!").waitFor();
  await shot("friend-chat");
  await page.goto(`${BASE}/u/zola.vintage`);
  await page.getByRole("button", { name: "Friends" }).waitFor();
  await page.getByRole("button", { name: "Message" }).waitFor();
  await shot("person-page");

  // ===== Cancelling a paid order: free within an hour; after that the seller is asked =====
  const buyTee = async () => {
    await page.goto(BASE);
    await page.getByRole("region", { name: /Oversized tee/ }).getByRole("button", { name: "Buy now" }).click();
    const c = page.getByRole("dialog", { name: "Checkout" });
    await c.getByRole("button", { name: "M", exact: true }).click();
    await c.getByRole("button", { name: /Free collection/ }).click();
    await c.getByRole("button", { name: /^Pay R/ }).click();
    await page.waitForURL(/mock-pay/);
    await page.getByRole("button", { name: "Pay now" }).click();
    await page.waitForURL(/\/orders\//);
    await page.getByText("Order placed 🎉").waitFor();
  };
  await buyTee();
  await page.getByRole("button", { name: "Cancel order" }).click();
  const cancelSheet = page.getByRole("dialog", { name: "Cancel this order?" });
  await cancelSheet.getByRole("button", { name: "Ordered by mistake" }).click();
  await shot("cancel-sheet");
  await cancelSheet.getByRole("button", { name: "Cancel and refund me" }).click();
  await page.getByText("You cancelled this order.").waitFor();
  await page.getByText("Refunded").first().waitFor();
  // A second order, paid 2 hours ago: now it's a request to the seller.
  await buyTee();
  const teeOrder = page.url().split("/orders/")[1];
  await page.evaluate((oid) => {
    const k = "lsa-demo-v4", st = JSON.parse(localStorage.getItem(k));
    st.orders.find((o) => o.id === oid).paidAt = new Date(Date.now() - 2 * 3600e3).toISOString();
    localStorage.setItem(k, JSON.stringify(st));
  }, teeOrder);
  await page.reload();
  await page.getByRole("button", { name: "Ask to cancel" }).click();
  const askSheet = page.getByRole("dialog", { name: "Ask the seller to cancel?" });
  await askSheet.getByRole("button", { name: "Wrong size or colour" }).click();
  await askSheet.getByRole("button", { name: "Ask to cancel" }).click();
  await page.getByText("You asked to cancel.").waitFor();
  await signOut();
  await signIn("lebo@shop.demo");
  await page.goto(`${BASE}/sell/orders/${teeOrder}`);
  const ask = page.getByRole("region", { name: "Cancel request" });
  await ask.getByText('"Wrong size or colour"').waitFor();
  await shot("cancel-request-seller");
  await ask.getByRole("button", { name: "Refund buyer" }).click();
  await page.getByText("The buyer cancelled this order.").waitFor();

  // ===== Seller fault refunds cost the seller TradeSafe's fee; sellers pick how often they're paid (8 Nov 2026) =====
  await signOut();
  await signIn("nandi@test.co.za");
  await buyTee();
  const faultOrder = page.url().split("/orders/")[1];
  await signOut();
  await signIn("lebo@shop.demo");
  await page.goto(`${BASE}/sell/orders/${faultOrder}`);
  await page.getByRole("button", { name: "Cancel this order" }).click();
  const sellerSheet = page.getByRole("dialog", { name: "Cancel this order?" });
  await sellerSheet.getByText(/refund fee .* comes off your next sale/).waitFor();
  await sellerSheet.getByRole("button", { name: "It's no longer available" }).click();
  await sellerSheet.getByRole("button", { name: "Cancel and refund the buyer" }).click();
  await page.goto(`${BASE}/sell/payouts`);
  await page.getByText("Owed to myHaul").waitFor();
  await page.getByText(/You owe R/).waitFor();
  await page.getByText(/TradeSafe's fee for refunding order/).waitFor();
  await page.getByRole("button", { name: /Once a month/ }).click();
  await page.getByText("Paid once a month from now on").waitFor();
  await shot("payouts-owed");

  // ===== Live selling: host a show, pin, a quick auction, watch, chat, bid, reminders, end =====
  await page.goto(`${BASE}/live/host/ls-1`);
  await page.getByRole("button", { name: /Pin item/ }).waitFor();
  await page.getByRole("button", { name: /Auction/ }).click();
  await page.getByRole("dialog", { name: "Start an auction" }).waitFor();
  await page.getByRole("button", { name: /Start 30 second auction/ }).click();
  await page.locator(".live-auction").waitFor();
  await shot("live-host-auction");
  await signOut();
  await signIn("buyer@test.co.za");
  await page.goto(`${BASE}/?tab=live`);
  await page.getByText("Live now").waitFor();
  await page.getByRole("button", { name: /thrift.with.lebo is live/ }).click();
  await page.locator(".live-auction").waitFor();
  await page.getByLabel("Say something").fill("Do you have it in XL?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Do you have it in XL?").waitFor();
  await hold(page.locator(".live-auction").getByRole("button", { name: /^Hold to bid/ }), 3400);
  await page.getByText(/You're the top bidder/).first().waitFor();
  await shot("live-watch-bid");
  await page.goto(`${BASE}/live/ls-2`);
  await page.getByRole("button", { name: /Remind me/ }).click();
  await page.getByRole("button", { name: /Reminder on/ }).waitFor();
  await signOut();
  await signIn("lebo@shop.demo");
  await page.goto(`${BASE}/live/host/ls-1`);
  await page.getByRole("button", { name: "End", exact: true }).click({ force: true });
  await page.getByRole("button", { name: "End show" }).click();
  await page.getByText("That's a wrap").waitFor();
  await shot("live-summary");
  await page.goto(`${BASE}/post?mode=live`);
  // Selling took stock below 5 during this run, so going live is stopped until there's more.
  await page.getByRole("button", { name: "Go live" }).click();
  await page.getByText(/You can't go live without stock/).waitFor();

  // ===== Extras: seller stats, invite, search filters, shop reviews =====
  await page.goto(`${BASE}/me`);
  await page.locator(".stats-card").click();
  await page.locator(".stat-tiles").waitFor();
  await page.getByRole("button", { name: "30 days" }).click();
  await page.getByText("Top items").waitFor();
  await shot("seller-stats");
  await page.goto(`${BASE}/invite`);
  await page.getByRole("button", { name: /Share/ }).waitFor();
  await page.goto(`${BASE}/explore`);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "R200 to R500" }).click();
  await page.getByRole("button", { name: "Show results" }).click();
  await page.getByRole("button", { name: "Remove R200 to R500" }).waitFor();
  await page.locator(".grid2 .tile").first().waitFor();
  await page.getByPlaceholder("Search sellers and items").fill("zzqx nothing");
  await page.getByText("No results").waitFor();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByPlaceholder("Search sellers and items").fill("");
  await page.goto(`${BASE}/s/thrift.with.lebo`);
  await page.locator(".prating").click();
  await page.getByRole("dialog", { name: "Reviews" }).getByText("Verified buyer", { exact: false }).first().waitFor();
  await shot("shop-reviews");

  // For the screen audit (e2e/audit.mjs): keep the demo state this run built up.
  if (process.env.DUMP_STATE) writeFileSync(process.env.DUMP_STATE, await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))));
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

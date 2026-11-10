// Screen audit: a picture of every screen the main test doesn't stop on (lists, settings, legal pages, empty states,
// every order status, the team dashboard, dark mode). Uses the demo state the main test leaves behind.
// Run from the repo root, after a build:
//   DUMP_STATE=/tmp/state.json npm run test:e2e && node apps/web/e2e/audit.mjs /tmp/state.json
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const here = fileURLToPath(new URL(".", import.meta.url));
const out = here + "audit/";
mkdirSync(out, { recursive: true });
const PORT = 4174, BASE = `http://localhost:${PORT}`, KEY = "lsa-demo-v4";
const saved = JSON.parse(readFileSync(process.argv[2], "utf8"));
const state = JSON.parse(saved[KEY]);

// The main test doesn't leave an order in every status, so copy one into the missing ones.
{
  const base = state.orders.find((o) => o.status === "shipped") ?? state.orders[0];
  const hoursAgo = (h) => new Date(Date.now() + (state.clockOffsetMs ?? 0) - h * 3600e3).toISOString();
  const copy = (status, extra) => state.orders.push({ ...structuredClone(base), id: crypto.randomUUID(), status, ...extra });
  if (!state.orders.some((o) => o.status === "pending_payment")) copy("pending_payment", { paidAt: null, shippedAt: null, trackingRef: null, createdAt: hoursAgo(0.2) });
  if (!state.orders.some((o) => o.status === "delivered")) copy("delivered", { deliveredAt: hoursAgo(20), releasableAt: new Date(Date.now() + 6 * 864e5).toISOString() });
  if (!state.orders.some((o) => o.status === "completed" && !o.review)) copy("completed", { deliveredAt: hoursAgo(300), review: null });
  saved[KEY] = JSON.stringify(state);
}

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: here + "..", stdio: "pipe" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const problems = [];
let n = 0;

async function session({ user, dark = false, wide = false, fresh = false }) {
  const ctx = await browser.newContext(wide
    ? { viewport: { width: 1280, height: 800 }, colorScheme: dark ? "dark" : "light" }
    : { viewport: { width: 393, height: 720 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: dark ? "dark" : "light", permissions: ["camera", "microphone"] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on("pageerror", (e) => problems.push(`page error (${user ?? "signed out"}): ${e.message}`));
  await page.goto(BASE + "/terms.html");
  await page.evaluate(({ saved, KEY, user, fresh }) => {
    if (fresh) return;
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    const st = JSON.parse(saved[KEY]); st.currentUserId = user; localStorage.setItem(KEY, JSON.stringify(st));
  }, { saved, KEY, user: user ?? null, fresh });
  const shot = async (name, path, { full = false, wait = 700, act } = {}) => {
    try {
      if (path) await page.goto(BASE + path);
      await page.waitForTimeout(wait);
      if (act) { await act(page); await page.waitForTimeout(500); }
      await page.screenshot({ path: `${out}${String(++n).padStart(3, "0")}-${name}.png`, fullPage: full });
      // Anything wider than the phone is a layout bug.
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) problems.push(`${name}: page is ${over}px wider than the screen`);
    } catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); }
  };
  return { page, shot, close: () => ctx.close() };
}

const uid = (email) => state.users.find((u) => u.email === email)?.id;
const byStatus = (list) => { const seen = new Map(); for (const o of list) if (!seen.has(o.status)) seen.set(o.status, o); return [...seen.values()]; };

// ===== Signed out =====
let s = await session({ fresh: true });
await s.shot("out-first-open", "/");
await s.close();
s = await session({ user: null });
await s.shot("out-feed", "/");
await s.shot("out-explore", "/explore");
await s.shot("out-signin", "/signin");
await s.shot("out-me-needs-signin", "/me");
await s.shot("out-shop-page", "/s/" + state.shops[0].handle);
await s.shot("out-item-link", "/i/" + state.posts[0].productId);
await s.shot("out-help", "/help");
await s.shot("out-terms", "/terms");
await s.shot("out-privacy", "/privacy");
await s.shot("out-not-found", "/nothing-here");
await s.shot("out-explore-search-none", "/explore", { act: async (p) => { await p.getByRole("searchbox").first().fill("zzzzqq"); } });
await s.close();

// ===== Buyer with history =====
const buyers = state.users.filter((u) => state.orders.some((o) => o.buyerId === u.id)).sort((a, b) =>
  state.orders.filter((o) => o.buyerId === b.id).length - state.orders.filter((o) => o.buyerId === a.id).length);
const buyer = buyers[0];
s = await session({ user: buyer.id });
await s.shot("buyer-orders", "/orders", { full: true });
for (const o of byStatus(state.orders.filter((x) => x.buyerId === buyer.id))) await s.shot(`buyer-order-${o.status}`, "/orders/" + o.id, { full: true });
for (const b of buyers.slice(1)) for (const o of byStatus(state.orders.filter((x) => x.buyerId === b.id))) {
  if (state.orders.some((x) => x.buyerId === buyer.id && x.status === o.status)) continue;
  const t = await session({ user: b.id }); await t.shot(`buyer-order-${o.status}`, "/orders/" + o.id, { full: true }); await t.close();
}
await s.shot("buyer-inbox-messages", "/inbox?tab=messages");
await s.shot("buyer-inbox-updates", "/inbox?tab=updates", { full: true });
await s.shot("buyer-me", "/me");
await s.shot("buyer-me-likes", "/me", { act: async (p) => { await p.getByRole("tab", { name: /Likes/ }).click(); } });
await s.shot("buyer-menu", "/me", { act: async (p) => { await p.getByRole("button", { name: "Menu and settings" }).click(); } });
await s.shot("buyer-trust-sheet", "/me", { act: async (p) => { await p.locator(".standing, [aria-label*='standing'], .pill").first().click(); } });
await s.shot("buyer-settings-delivery", "/settings/delivery", { full: true });
await s.shot("buyer-settings-blocked", "/settings/blocked");
await s.shot("buyer-friends", "/friends");
await s.shot("buyer-post-open-shop", "/post");
await s.shot("buyer-sell-start", "/sell/start");
await s.shot("buyer-explore", "/explore", { full: true });
await s.shot("buyer-following", "/", { act: async (p) => { await p.getByRole("tab", { name: "Following" }).click(); } });
await s.shot("buyer-live-tab", "/", { act: async (p) => { await p.getByRole("tab", { name: "Live" }).click(); } });
await s.shot("buyer-browse-sheet", "/", { act: async (p) => { await p.locator(".video-card").first().getByRole("button", { name: /Buy now|Order now|Bid/ }).click(); } });
await s.close();

// A brand new buyer: every empty state.
s = await session({ user: null });
await s.page.goto(BASE + "/signin");
await s.page.getByLabel("Email").fill("fresh.buyer@example.com");
await s.page.getByRole("button", { name: "Send code" }).click();
await s.shot("new-signin-code", null);
await s.page.getByLabel("Code").fill("123456");
await s.page.waitForTimeout(1500);
await s.shot("new-setup-birthday", null);
const setup = s.page.getByRole("dialog", { name: "Create your account" });
try {
  await setup.getByLabel("Year", { exact: true }).selectOption("1999");
  await setup.getByRole("button", { name: "Next" }).click();
  await s.shot("new-setup-name", null);
  await setup.getByLabel("Name", { exact: true }).fill("Fresh Buyer");
  await setup.getByLabel("Username", { exact: true }).fill("fresh.buyer" + (Date.now() % 1000));
  await s.page.waitForTimeout(900);
  await setup.getByRole("button", { name: "Create account" }).click();
  await s.shot("new-setup-photo", null);
  await setup.getByRole("button", { name: "Skip for now" }).click();
  await s.shot("new-setup-delivery", null, { full: true });
  await setup.getByRole("button", { name: "Skip for now" }).click();
} catch (e) { problems.push("new account setup: " + String(e.message).split("\n")[0]); }
await s.shot("empty-orders", "/orders");
await s.shot("empty-inbox-messages", "/inbox?tab=messages");
await s.shot("empty-inbox-updates", "/inbox?tab=updates");
await s.shot("empty-me", "/me");
await s.shot("empty-friends", "/friends");
await s.shot("empty-blocked", "/settings/blocked");
await s.shot("empty-following", "/", { act: async (p) => { await p.getByRole("tab", { name: "Following" }).click(); } });
await s.close();

// ===== Seller =====
const seller = state.users.find((u) => u.id === "u-lebo");
const shop = state.shops.find((x) => x.ownerId === seller.id);
s = await session({ user: seller.id });
await s.shot("seller-me", "/me", { full: true });
await s.shot("seller-selling-tab", "/me?tab=selling", { full: true });
await s.shot("seller-orders", "/sell/orders", { full: true });
for (const o of byStatus(state.orders.filter((x) => x.shop.id === shop.id))) await s.shot(`seller-order-${o.status}`, "/sell/orders/" + o.id, { full: true });
await s.shot("seller-payouts", "/sell/payouts", { full: true });
await s.shot("seller-post-camera", "/post", { wait: 1500 });
await s.shot("seller-post-create", "/post?mode=create");
await s.shot("seller-post-live", "/post?mode=live");
await s.shot("seller-inbox", "/inbox?tab=messages");
await s.shot("seller-menu", "/me", { act: async (p) => { await p.getByRole("button", { name: "Menu and settings" }).click(); } });
await s.shot("seller-mock-label", "/mock-label/MOCK1234");
await s.close();

// ===== Team (phone and laptop) =====
const admin = state.users.find((u) => u.admin);
if (admin) for (const wide of [false, true]) {
  s = await session({ user: admin.id, wide });
  const tag = wide ? "team-wide" : "team";
  for (const [name, path] of [["overview", "/team"], ["todo", "/team/todo"], ["accounts", "/team/accounts"], ["person", "/team/accounts/" + seller.id],
    ["orders", "/team/orders"], ["listings", "/team/listings"], ["money", "/team/money"], ["errors", "/team/errors"], ["log", "/team/log"]]) {
    await s.shot(`${tag}-${name}`, path, { full: !wide });
  }
  await s.close();
} else problems.push("no team account in the saved state");
s = await session({ user: buyer.id });
await s.shot("team-not-allowed", "/team");
await s.close();

// ===== Dark mode, the screens people see most =====
s = await session({ user: buyer.id, dark: true });
for (const [name, path] of [["feed", "/"], ["explore", "/explore"], ["orders", "/orders"], ["inbox", "/inbox?tab=messages"], ["me", "/me"], ["help", "/help"], ["terms", "/terms"]]) await s.shot("dark-" + name, path);
const anyOrder = state.orders.find((x) => x.buyerId === buyer.id);
if (anyOrder) await s.shot("dark-order", "/orders/" + anyOrder.id);
await s.shot("dark-menu", "/me", { act: async (p) => { await p.getByRole("button", { name: "Menu and settings" }).click(); } });
await s.shot("dark-checkout", "/", { act: async (p) => { await p.locator(".video-card").first().getByRole("button", { name: /Buy now|Order now|Bid/ }).click(); } });
await s.close();
s = await session({ user: seller.id, dark: true });
await s.shot("dark-seller-order", "/sell/orders/" + (state.orders.find((x) => x.shop.id === shop.id)?.id ?? ""));
await s.shot("dark-payouts", "/sell/payouts");
await s.shot("dark-create", "/post?mode=create");
await s.close();

console.log(`${n} screens saved to ${out}`);
if (problems.length) console.log("Problems:\n  " + problems.join("\n  "));
await browser.close();
server.kill();
process.exit(0);

// Styling audit: opens every screen and sheet at four phone widths and reports layout problems:
// things running off the screen, text cut off, buttons too small to tap, text too small to read.
// Run: npm run build && node apps/web/e2e/audit.mjs   (screenshots in apps/web/e2e/audit/)
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = fileURLToPath(new URL(".", import.meta.url));
const out = here + "audit/";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const PORT = 4174, BASE = `http://localhost:${PORT}`;
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: here + "..", stdio: "pipe" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const WIDTHS = [[320, 568, "se"], [375, 667, "375"], [393, 720, "393"], [430, 860, "430"]];
const problems = new Map(); // "screen: issue" -> widths

function inspect() {
  const W = document.documentElement.clientWidth;
  const found = [];
  const name = (el) => {
    const label = el.getAttribute("aria-label") || el.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) || "";
    return `<${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}> "${label}"`;
  };
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (/(auto|scroll)/.test(ps.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  const hidden = (el) => {
    for (let p = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return true;
    }
    return false;
  };
  const top = [...document.querySelectorAll(".sheet, .drawer, .setup, .welcome, .chat, .post, .viewer")].filter((x) => !hidden(x)).pop();
  const root = top ?? document.querySelector(".content") ?? document.body;
  if (document.documentElement.scrollWidth > W + 1) found.push(`page scrolls sideways (${document.documentElement.scrollWidth}px wide)`);
  for (const el of root.querySelectorAll("*")) {
    if (hidden(el) || el.closest("svg") || el.closest("[aria-hidden='true']")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const s = getComputedStyle(el);
    if ((r.right > W + 1 || r.left < -1) && !inScroller(el) && s.position !== "fixed") found.push(`off screen by ${Math.round(Math.max(r.right - W, -r.left))}px: ${name(el)}`);
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && el.scrollWidth > el.clientWidth + 2 && s.overflowX !== "visible" && s.textOverflow !== "ellipsis" && !/(auto|scroll)/.test(s.overflowX))
      found.push(`text cut off: ${name(el)}`);
    if (own && parseFloat(s.fontSize) < 11) found.push(`text under 11px (${s.fontSize}): ${name(el)}`);
    if (el.matches("button, a[href], [role=tab], input[type=checkbox], select") && !el.closest(".dots, .welcome-dots, .slide-dots") && (r.height < 28 || r.width < 28))
      found.push(`small tap target ${Math.round(r.width)}x${Math.round(r.height)}: ${name(el)}`);
    if (el.matches("input, textarea") && parseFloat(s.fontSize) < 16 && el.type !== "checkbox" && el.type !== "file") found.push(`input under 16px (iPhone zooms in): ${name(el)}`);
  }
  return [...new Set(found)];
}

async function run([w, h, tag]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const look = async (screen) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}${tag}-${screen}.png` });
    for (const p of await page.evaluate(inspect)) {
      const k = `${screen}: ${p}`;
      problems.set(k, [...(problems.get(k) ?? []), w]);
    }
  };
  const esc = () => page.keyboard.press("Escape");
  const signIn = async (email) => {
    await page.goto(`${BASE}/signin`);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Code").fill("123456");
    await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
  };
  const step = async (label, fn) => { try { await fn(); } catch (e) { problems.set(`${label}: audit could not open (${e.message.split("\n")[0].slice(0, 80)})`, [w]); } };

  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  await step("welcome", async () => { await page.getByText("Shop from short videos").waitFor(); await look("welcome"); });
  await step("welcome interests", async () => { await page.getByRole("button", { name: "Skip" }).click(); await look("welcome-interests"); await page.getByRole("button", { name: /Show me everything|Start watching/ }).click(); });
  await step("feed", async () => { await page.locator(".video-card").first().waitFor(); await look("feed"); });
  await step("item sheet", async () => { await page.getByRole("button", { name: /See details/ }).first().click(); await look("item-sheet"); await esc(); });
  await step("comments", async () => { await page.getByRole("button", { name: /^Comments/ }).first().click(); await look("comments"); await esc(); });
  await step("more sheet", async () => { await page.getByRole("button", { name: "More options" }).first().click(); await look("more-sheet"); await esc(); });
  await step("sign in sheet", async () => { await page.getByRole("button", { name: /^Like/ }).first().click(); await look("signin-sheet"); await esc(); });
  await step("explore", async () => { await page.goto(`${BASE}/explore`); await look("explore"); });
  await step("signin page", async () => { await page.goto(`${BASE}/signin`); await look("signin"); });
  await step("create account", async () => {
    await page.getByLabel("Email").fill(`audit${w}@test.co.za`);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Code").fill("123456");
    const setup = page.getByRole("dialog", { name: "Create your account" });
    await setup.waitFor();
    await look("setup-birthday");
    await setup.getByLabel("Birthday").fill("2010-01-01");
    await look("setup-birthday-young");
    await setup.getByLabel("Birthday").fill("1998-06-15");
    await setup.getByRole("button", { name: "Next" }).click();
    await setup.getByLabel("Name", { exact: true }).fill("Nomvula Dlamini-Khumalo");
    await setup.getByLabel("Username", { exact: true }).fill("lebo.m");
    await setup.getByText("is taken").waitFor();
    await look("setup-username-taken");
    await setup.getByLabel("Username", { exact: true }).fill(`nomvula.${w}`);
    await setup.getByText("is available").waitFor();
    await look("setup-username");
    await setup.getByRole("button", { name: "Create account" }).click();
    await setup.getByText("Add a profile photo").waitFor();
    await look("setup-photo");
    await setup.getByRole("button", { name: "Skip for now" }).click();
    await setup.waitFor({ state: "detached" });
  });
  await step("checkout", async () => {
    await page.goto(BASE);
    await page.getByRole("region", { name: /Oversized tee/ }).getByRole("button", { name: "Buy now" }).click();
    const sheet = page.getByRole("dialog", { name: "Checkout" });
    await sheet.waitFor();
    await look("checkout");
    await sheet.getByRole("button", { name: /Courier Guy/ }).click();
    await sheet.getByRole("button", { name: "M", exact: true }).click();
    await look("checkout-address");
    await sheet.getByRole("button", { name: /PUDO/ }).click();
    await look("checkout-locker");
    await sheet.getByRole("button", { name: /Free collection/ }).click();
    await sheet.getByRole("button", { name: /^Pay/ }).click();
    await page.waitForURL(/mock-pay/);
    await look("mock-pay");
    await page.getByRole("button", { name: "Pay now" }).click();
    await page.waitForURL(/\/orders\//);
    await look("order-paid");
    await page.getByRole("button", { name: "Ship and deliver" }).click();
    await page.getByText("Something wrong?").waitFor();
    await look("order-delivered");
  });
  await step("cake checkout", async () => {
    await page.goto(BASE);
    const cake = page.getByRole("region", { name: /cake/i }).first();
    await cake.scrollIntoViewIfNeeded();
    await cake.getByRole("button", { name: /Order now/ }).click();
    await page.getByRole("dialog", { name: "Order" }).waitFor();
    await look("checkout-cake");
    await esc();
  });
  await step("wallet", async () => { await page.getByRole("button", { name: /^Wallet/ }).first().click(); await look("wallet"); await esc(); });
  await step("activity", async () => {
    await page.goto(`${BASE}/activity`); await look("activity");
    await page.getByRole("button", { name: "Messages", exact: true }).click(); await look("activity-messages");
    await page.getByRole("button", { name: "Orders", exact: true }).click(); await look("activity-orders");
  });
  await step("profile", async () => {
    await page.goto(`${BASE}/me`); await look("profile");
    await page.getByRole("tab", { name: "Likes" }).click(); await look("profile-likes");
    await page.getByRole("button", { name: "Edit profile" }).click(); await look("edit-profile"); await esc();
    await page.getByRole("button", { name: "Menu and settings" }).click(); await look("menu"); await esc();
  });
  for (const [path, nameShot] of [["/orders", "orders"], ["/help", "help"], ["/privacy", "privacy"], ["/settings/blocked", "blocked"], ["/s/thrift.with.lebo", "shop"], ["/s/thrift.with.lebo?item=p-tee", "shop-item"], ["/sell/start", "onboarding"]]) {
    await step(nameShot, async () => { await page.goto(BASE + path); await look(nameShot); });
  }
  await step("chat", async () => {
    await page.goto(BASE);
    await page.getByRole("region", { name: /Oversized tee/ }).getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: /^Message @/ }).click();
    await page.waitForURL(/\/messages\//);
    await look("chat");
    await page.getByLabel("Message", { exact: true }).fill("Hi, is this still available in a size L please?");
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForTimeout(2500);
    await look("chat-sent");
  });
  await step("post camera", async () => { await page.goto(`${BASE}/post`); await look("post"); });

  // Seller side
  await step("seller", async () => {
    await signIn("lebo@shop.demo");
    await page.goto(`${BASE}/me`); await look("seller-profile");
    await page.goto(`${BASE}/sell/orders`); await look("seller-orders");
    const first = page.locator("a.list-item").first();
    if (await first.count()) { await first.click(); await look("seller-order"); }
    await page.goto(`${BASE}/sell/payouts`); await look("seller-payouts");
    await page.goto(`${BASE}/post?mode=create`); await look("create-1");
    await page.goto(`${BASE}/post?mode=live`); await look("live");
    await page.goto(`${BASE}/activity?tab=messages`);
    const chat = page.locator(".group a.cell").first();
    if (await chat.count()) {
      await chat.click(); await page.waitForURL(/\/messages\//); await look("seller-chat");
      await page.getByRole("button", { name: /More|Add/ }).last().click().catch(() => {});
      await look("seller-chat-plus");
    }
  });
  await step("admin", async () => { await signIn("admin@team.demo"); await page.goto(`${BASE}/admin`); await look("admin"); });
  await page.close();
}

try {
  for (const w of WIDTHS) await run(w);
} finally {
  await browser.close();
  server.kill();
}
const rows = [...problems.entries()].sort();
console.log(rows.length ? rows.map(([k, ws]) => `${k}   [${ws.join(", ")}]`).join("\n") : "No layout problems found.");
console.log(`\n${rows.length} problems. Screenshots in ${out}`);

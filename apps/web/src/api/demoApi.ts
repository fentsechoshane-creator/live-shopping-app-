// Demo adapter: the whole app runs in the browser with sample data, using the same rules as the server.
// Used when no Supabase keys are set. Sign in with any email or phone and the code 123456.
import {
  bidStep, maskHandle, canTransition, isRude, orderTotals, payoutDate, releasableAt, returnReasonsFor, shipBy, tierFor, TRUST_POINTS, validateListing,
  RETURN_POSTAGE_PAYER, ACCOUNT_FEATURE_KEYS, canForceOn, featureOffMessage, type AccountFeature, type OrderStatus, type TrustEventKind, bookedByUs, deliveryFee, PARCEL_SIZES, orderParcelSize, DELIVERY_PERKS, validateEdit } from "@app/core";
import { handleProblem } from "../lib/handle";
import type {
  Api, Category, ReportReason, ReportTarget, CheckoutInput, FeedItem, ListingInput, MyShop, Notification, Order, Payout, PendingReview, ProductPublic, ReviewStatus,
  ShopPublic, User, SavedDelivery, AppError, PickupPoint, ShopPickup, ShipmentEvent, AuctionInfo, TeamAlert, TeamOverview, TeamPerson, TeamPersonDetail, TeamOrder, TeamListing, TeamLogEntry, TeamFeature, Reward,
} from "./types";

interface DShop {
  id: string; ownerId: string; name: string; handle: string; category: Category; bio: string;
  status: MyShop["status"]; foundingUntil: string | null;
  checks: MyShop["checks"];
}
interface DProduct extends ProductPublic { shopId: string; proofStatus: ReviewStatus;
  auctionEndsAt?: string | null; reserveCents?: number | null; auctionState?: AuctionInfo["state"]; auctionRound?: number;
  auctionWinner?: string | null; auctionPriceCents?: number | null; auctionPayBy?: string | null }
interface DPost { id: string; shopId: string; productId: string; caption: string; video: FeedItem["video"]; createdAt: string; photos?: string[]; edit?: FeedItem["edit"] }
interface DOrder extends Order { shopOwnerId: string; bundleIds?: string[]; offerId?: string | null; paymentMethod?: string | null;
  packingVideo?: string; packingPhoto?: string; packingReview?: "ok" | "strike"; packingReviewedAt?: string }
interface DUser extends User { trust: number; welcomeUsed: boolean; admin: boolean; createdAt?: string; bio?: string;
  handle?: string | null; avatar?: string | null; handleChangedAt?: string | null; adult?: boolean; terms?: boolean }
type DPayout = Payout & { shopId: string; topUpCents: number; topUpPaid: boolean };
interface State {
  users: DUser[]; currentUserId: string | null; shops: DShop[]; products: DProduct[]; posts: DPost[]; orders: DOrder[];
  notifications: (Notification & { userId: string })[]; payouts: DPayout[]; clockOffsetMs: number;
  follows: { userId: string; shopId: string }[];
  reactions?: { userId: string; postId: string; kind: "like" | "repost"; at: string }[];
  comments: { id: string; postId: string; userId: string; body: string; createdAt: string; hidden?: boolean }[];
  conversations: { id: string; buyerId: string; shopId: string; lastAt: string }[];
  messages: { id: string; conversationId: string; senderId: string; body: string; createdAt: string; readAt: string | null; productId?: string | null; image?: string | null; offerId?: string | null }[];
  offers?: { id: string; conversationId: string; productIds: string[]; priceCents: number; expiresAt: string; status: "pending" | "open" | "used" | "withdrawn" | "declined"; madeBy?: "seller" | "buyer" }[];
  blocks: { blockerId: string; blockedId: string }[];
  reports: { id: string; reporterId: string; targetKind: ReportTarget; targetId: string; reason: ReportReason; details: string; createdAt: string; status: "open" | "actioned" | "dismissed" }[];
  delivery?: Record<string, SavedDelivery>;
  /** Sellers' pickup addresses for courier collections, and tracking events per order. */
  pickup?: Record<string, ShopPickup>;
  /** Instant EFT delivery stamps (0029). */
  stamps?: { userId: string; earnedOrderId: string; usedOrderId: string | null }[];
  shipEvents?: Record<string, ShipmentEvent[]>;
  interests?: Record<string, Category[]>;
  errors?: AppError[];
  bids?: { id: string; productId: string; round: number; bidderId: string; amountCents: number; at: string }[];
  suspensions?: Record<string, { reason: string; at: string }>;
  packingStrikes?: { shopId: string; orderId: string; note: string; at: string }[];
  rewards?: (Reward & { userId: string; earnedOrderId: string | null; usedOrderId: string | null })[];
  features?: Record<string, Partial<Record<AccountFeature, { state: "on" | "off"; reason: string; at: string; by: string }>>>;
  teamLog?: TeamLogEntry[];
  trustLog?: { userId: string; kind: string; points: number; at: string }[];
  alerts?: (TeamAlert & { dedupe: string })[];
}

// Sample lockers for testing (the real list comes from Bob Go).
const DEMO_POINTS: PickupPoint[] = [
  { id: 9000, provider: "pudo", name: "PUDO Locker, Rondebosch Main Road", address: "Main Road, Rondebosch, Cape Town, 7700", type: "locker" },
  { id: 9001, provider: "pudo", name: "PUDO Locker, Cavendish Square", address: "Dreyer Street, Claremont, Cape Town, 7708", type: "locker" },
  { id: 9002, provider: "pudo", name: "PUDO Locker, Gardens Centre", address: "Mill Street, Gardens, Cape Town, 8001", type: "locker" },
  { id: 9003, provider: "pargo", name: "Pargo, Woodstock Exchange", address: "Albert Road, Woodstock, Cape Town, 7925", type: "pickup_point" },
];

const KEY = "lsa-demo-v4"; // v4: adds a sample auction
// Made up seller videos (drawn product scenes with captions and music) so the player can be tested.
import teeClip from "../assets/demo/tee.mp4";
import cakeClip from "../assets/demo/cake.mp4";
import runnerClip from "../assets/demo/runner.mp4";
const DEMO_CLIPS: Record<string, string> = { "po-1": teeClip, "po-3": cakeClip, "po-5": runnerClip };
const CODE = "123456";
const id = () => crypto.randomUUID();
const approvedChecks = (): MyShop["checks"] => ({
  phone: "0820000000", idStatus: "approved", bankStatus: "approved", bankName: "Capitec", bankLast4: "1234", certStatus: "approved", rulesAccepted: true,
});

function seed(): State {
  const bots: DUser[] = [
    { id: "u-lebo", displayName: "Lebo", handle: "lebo.m", adult: true, terms: true, trust: 78, welcomeUsed: true, admin: false },
    { id: "u-luxe", displayName: "Kamva", handle: "kamva.luxe", adult: true, terms: true, trust: 92, welcomeUsed: true, admin: false },
    { id: "u-sweet", displayName: "Ayesha", handle: "ayesha.bakes", adult: true, terms: true, trust: 66, welcomeUsed: true, admin: false },
    { id: "u-thabo", displayName: "Thabo", handle: "thabo.k", email: "thabo@example.com", adult: true, terms: true, trust: 50, welcomeUsed: false, admin: false,
      createdAt: new Date(Date.now() - 2 * 86400e3).toISOString() },
    { id: "u-zola", displayName: "Zola", handle: "zola.vintage", email: "zola@example.com", adult: true, terms: true, trust: 50, welcomeUsed: false, admin: false,
      createdAt: new Date(Date.now() - 86400e3).toISOString() },
  ];
  const shops: DShop[] = [
    { id: "s-lebo", ownerId: "u-lebo", name: "Lebo's Thrift", handle: "thrift.with.lebo", category: "clothes", bio: "Thrift and new basics. Cape Town.", status: "open", foundingUntil: null, checks: approvedChecks() },
    { id: "s-luxe", ownerId: "u-luxe", name: "Luxe Resale CT", handle: "luxe.resale.ct", category: "designer", bio: "Checked designer pre loved.", status: "open", foundingUntil: null, checks: approvedChecks() },
    { id: "s-sweet", ownerId: "u-sweet", name: "Sweet Crumbs", handle: "sweetcrumbs.ct", category: "food", bio: "Celebration cakes, Gardens.", status: "open", foundingUntil: null, checks: approvedChecks() },
    // A new seller waiting for our team to check her ID (shows on the team dashboard).
    { id: "s-zola", ownerId: "u-zola", name: "Zola Vintage", handle: "zola.vintage", category: "clothes", bio: "", status: "open", foundingUntil: null,
      checks: { phone: "0831234567", idStatus: "pending", bankStatus: "approved", bankName: "FNB", bankLast4: "4421", certStatus: "not_started", rulesAccepted: true } },
  ];
  const p = (x: Partial<DProduct> & Pick<DProduct, "id" | "shopId" | "title" | "priceCents">): DProduct => ({
    description: "", mode: "buy_now", label: "new", condition: null, sizes: [], stock: 3, leadDays: null, allergens: null,
    status: "live", proofStatus: "not_started", ...x,
  });
  const products: DProduct[] = [
    p({ id: "p-tee", shopId: "s-lebo", title: "Oversized tee, sand", priceCents: 34900, sizes: ["S", "M", "L", "XL"], description: "Heavy cotton, boxy fit." }),
    p({ id: "p-denim", shopId: "s-lebo", title: "Vintage denim jacket", priceCents: 45000, label: "pre_loved", condition: "good", sizes: ["M"], stock: 1, description: "Small mark on the left cuff, shown in the video." }),
    p({ id: "p-runner", shopId: "s-lebo", title: "Chunky white runner", priceCents: 52000, label: "unbranded_dupe", sizes: ["5", "6", "7", "8"] }),
    p({ id: "p-shirt", shopId: "s-luxe", title: "Designer silk shirt", priceCents: 120000, label: "authentic_designer", condition: "like_new", sizes: ["M"], stock: 1, proofStatus: "approved", description: "Receipt and tags checked." }),
    p({ id: "p-auction", shopId: "s-luxe", title: "Vintage 90s denim jacket, rare wash", priceCents: 60000, mode: "auction", label: "pre_loved", condition: "good",
      sizes: ["L"], stock: 1, description: "Original 90s wash. Every mark shown in the video.", reserveCents: 90000, auctionState: "open", auctionRound: 0,
      auctionEndsAt: new Date(Date.now() + 26 * 3600e3 + 14 * 60e3).toISOString() }),
    p({ id: "p-cake", shopId: "s-sweet", title: "Celebration cake, 20 cm", priceCents: 65000, mode: "order_now", leadDays: 2, stock: 99, allergens: "Gluten, eggs, dairy", description: "Vanilla, chocolate or red velvet. Add a message." }),
  ];
  const v = (bg: string, label: string, scene?: string) => ({ demo: { bg, label, scene } });
  const now = Date.now();
  const posts: DPost[] = [
    { id: "po-1", shopId: "s-lebo", productId: "p-tee", caption: "3 ways to style one oversized tee for summer", video: v("#5b4636", "Seller video: styling the tee", "tee"), createdAt: new Date(now - 3600e3).toISOString() },
    { id: "po-2", shopId: "s-luxe", productId: "p-shirt", caption: "Silk shirt, worn twice. Receipt checked.", video: v("#2f3a4a", "Seller video: shirt close up", "shirt"), createdAt: new Date(now - 7200e3).toISOString() },
    { id: "po-3", shopId: "s-sweet", productId: "p-cake", caption: "Decorating a celebration cake", video: v("#6b4a4a", "Seller video: decorating a cake", "cake"), createdAt: new Date(now - 9000e3).toISOString() },
    { id: "po-4", shopId: "s-lebo", productId: "p-denim", caption: "Real denim, every mark on camera", video: v("#34495e", "Seller video: denim jacket", "denim"), createdAt: new Date(now - 12000e3).toISOString() },
    { id: "po-6", shopId: "s-luxe", productId: "p-auction", caption: "Auction: 90s denim, one of one. Starts at R600.", video: v("#2c3e50", "Seller video: 90s denim jacket", "denim"), createdAt: new Date(now - 5400e3).toISOString() },
    { id: "po-5", shopId: "s-lebo", productId: "p-runner", caption: "Chunky runner, no logos", video: v("#4a4a3a", "Seller video: runners", "runner"), createdAt: new Date(now - 15000e3).toISOString() },
  ];
  const ago = (m: number) => new Date(now - m * 60e3).toISOString();
  const bids = [
    { id: "b-1", productId: "p-auction", round: 0, bidderId: "u-lebo", amountCents: 60000, at: ago(80) },
    { id: "b-2", productId: "p-auction", round: 0, bidderId: "u-sweet", amountCents: 64000, at: ago(55) },
    { id: "b-3", productId: "p-auction", round: 0, bidderId: "u-lebo", amountCents: 70000, at: ago(20) },
  ];
  return { bids, users: bots, currentUserId: null, shops, products, posts, orders: [], notifications: [], payouts: [], clockOffsetMs: 0, follows: [],
    // Sample activity: Lebo reposted the cake and liked the silk shirt, so the Following feed shows a repost.
    comments: [
      { id: "c-1", postId: "po-1", userId: "u-sweet", body: "The sand colour is so nice. Does it shrink?", createdAt: new Date(now - 3000e3).toISOString() },
      { id: "c-2", postId: "po-1", userId: "u-lebo", body: "No shrinking, it's pre washed heavy cotton.", createdAt: new Date(now - 2800e3).toISOString() },
      { id: "c-3", postId: "po-3", userId: "u-luxe", body: "Ordered one for Friday, can't wait!", createdAt: new Date(now - 6000e3).toISOString() },
    ],
    conversations: [], messages: [], blocks: [],
    reports: [{ id: "r-1", reporterId: "u-thabo", targetKind: "post", targetId: "po-5", reason: "counterfeit", details: "Looks like a copy of a big brand runner.",
      createdAt: new Date(now - 4 * 3600e3).toISOString(), status: "open" }],
    reactions: [{ userId: "u-lebo", postId: "po-3", kind: "repost", at: new Date(now - 1800e3).toISOString() }, { userId: "u-lebo", postId: "po-2", kind: "like", at: new Date(now - 1800e3).toISOString() }] };
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...seed(), ...JSON.parse(raw) };
  } catch { /* storage blocked: start fresh */ }
  return seed();
}

// Demo uploads are kept in IndexedDB on this phone so they still play after a reload.
const MEDIA_DB = "lsa-demo-media";
function mediaDb(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(MEDIA_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("blobs");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
async function keepBlob(key: string, blob: Blob) {
  try {
    const d = await mediaDb();
    await new Promise((ok, no) => { const t = d.transaction("blobs", "readwrite"); t.objectStore("blobs").put(blob, key); t.oncomplete = ok; t.onerror = no; });
  } catch { /* no IndexedDB: works until reload */ }
}
async function loadBlobs(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const d = await mediaDb();
    await new Promise<void>((ok) => {
      const req = d.transaction("blobs").objectStore("blobs").openCursor();
      req.onsuccess = () => { const c = req.result; if (!c) return ok(); out.set(String(c.key), URL.createObjectURL(c.value as Blob)); c.continue(); };
      req.onerror = () => ok();
    });
  } catch { /* ignore */ }
  return out;
}

/** A 4 digit code per order, like the database makes. */
const packingCodeFor = (id: string) => "MH " + String([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 10000, 7)).padStart(4, "0");

export function createDemoApi(): Api {
  let s = load();
  s.orders.forEach((o) => { o.packingCode = o.packingCode ?? packingCodeFor(o.id); });
  let blobUrls = new Map<string, string>();
  const mediaReady = loadBlobs().then((m) => { blobUrls = m; });
  const mediaUrl = (u: string | null | undefined) => (u?.startsWith("idb:") ? blobUrls.get(u.slice(4)) ?? null : u ?? null);
  const stash = async (blob: Blob) => { const key = id(); blobUrls.set(key, URL.createObjectURL(blob)); await keepBlob(key, blob); return `idb:${key}`; };
  const listeners = new Set<(u: User | null) => void>();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  };
  const now = () => new Date(Date.now() + s.clockOffsetMs);
  // Usernames and shop handles share one list, like the database.
  const demoHandleProblem = (h: string, self?: string) => handleProblem(h)
    ?? (s.users.some((x) => x.handle === h && x.id !== self) || s.shops.some((x) => x.handle === h && x.ownerId !== self) ? "That username is taken." : null);
  const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const me = (): DUser => {
    const u = s.users.find((x) => x.id === s.currentUserId);
    if (!u) throw new Error("Please sign in.");
    return u;
  };
  const shopOf = (shopId: string) => s.shops.find((x) => x.id === shopId)!;
  const ownerOf = (shopId: string) => s.users.find((u) => u.id === shopOf(shopId).ownerId)!;
  const myShopRow = () => s.shops.find((x) => x.ownerId === s.currentUserId) ?? null;
  const notify = (userId: string, title: string, body: string, link: string | null = null) =>
    s.notifications.unshift({ id: id(), userId, title, body, link, readAt: null, createdAt: now().toISOString() });
  const trust = (userId: string, kind: TrustEventKind) => {
    const u = s.users.find((x) => x.id === userId);
    if (u) u.trust = Math.max(0, Math.min(100, u.trust + TRUST_POINTS[kind]));
    s.trustLog = [{ userId, kind, points: TRUST_POINTS[kind], at: now().toISOString() }, ...(s.trustLog ?? [])].slice(0, 300);
  };
  const isTeam = () => !!s.users.find((u) => u.id === s.currentUserId)?.admin;
  const teamOnly = () => { if (!isTeam()) throw new Error("Only our team can do this."); };
  const logTeam = (action: string, targetKind: string, targetId: string | null, note: string | null = null) => {
    const u = me();
    s.teamLog = [{ id: id(), action, targetKind, targetId, target: null, note, at: now().toISOString(), by: u.handle ?? u.displayName ?? "Team" }, ...(s.teamLog ?? [])].slice(0, 300);
  };
  const targetsOf = (uid: string) => {
    const sh = s.shops.find((x) => x.ownerId === uid);
    return [uid, ...(sh ? [sh.id, ...s.posts.filter((p) => p.shopId === sh.id).map((p) => p.id)] : []), ...s.comments.filter((c) => c.userId === uid).map((c) => c.id)];
  };
  const personRow = (u: DUser): TeamPerson => {
    const sh = s.shops.find((x) => x.ownerId === u.id); const sus = s.suspensions?.[u.id]; const targets = targetsOf(u.id);
    return {
      id: u.id, name: u.displayName, handle: u.handle ?? null, email: u.email ?? null, role: u.admin ? "admin" : "user", trust: u.trust, tier: tierFor(u.trust),
      createdAt: u.createdAt ?? "2026-10-01T08:00:00.000Z", avatarUrl: mediaUrl(u.avatar), setUp: !!(u.handle && u.adult && u.terms),
      suspendedAt: sus?.at ?? null, suspendedReason: sus?.reason ?? null,
      shop: sh ? { id: sh.id, name: sh.name, handle: sh.handle, status: sh.status, category: sh.category, idStatus: sh.checks.idStatus, bankStatus: sh.checks.bankStatus, certStatus: sh.checks.certStatus } : null,
      ordersBought: s.orders.filter((o) => o.buyerId === u.id && o.status !== "pending_payment").length,
      ordersSold: s.orders.filter((o) => o.shopOwnerId === u.id && o.status !== "pending_payment").length,
      reportsAgainst: s.reports.filter((r) => r.status === "open" && targets.includes(r.targetId)).length,
    };
  };
  /** Demo version of check_alerts(): raises each alert once. */
  const demoAlerts = () => {
    const out = (s.alerts = s.alerts ?? []);
    const raise = (kind: string, severity: TeamAlert["severity"], title: string, body: string, link: string, dedupe: string) => {
      if (out.some((a) => a.dedupe === dedupe)) return;
      out.unshift({ id: id(), kind, severity, title, body, link, createdAt: now().toISOString(), seen: false, dedupe });
    };
    s.reports.filter((r) => r.status === "open").forEach((r) => raise("report", "urgent", "New report: " + r.reason.replace(/_/g, " "), `Someone reported a ${r.targetKind}. Answer within 24 hours.`, "/team/reports", "report:" + r.id));
    s.shops.filter((x) => x.checks.idStatus === "pending" || x.checks.certStatus === "pending").forEach((x) => raise("check", "normal", "Seller check waiting: " + x.name, "Check their ID or certificate.", "/team/checks", "check:" + x.id));
    s.orders.filter((o) => o.status === "paid" && o.shipBy && new Date(o.shipBy) < now()).forEach((o) => raise("late", "urgent", "Late to ship: " + o.product.title, o.shop.name + " hasn't shipped.", "/team/orders?f=late", "late:" + o.id));
    if (s.payouts.some((p) => p.topUpCents > 0 && !p.topUpPaid)) raise("topup", "normal", "Top ups to pay soon", "Welcome credit top ups are due.", "/team/money", "topup:" + now().toISOString().slice(0, 10));
    s.alerts = out.slice(0, 100);
  };
  const notSuspended = () => {
    if (s.currentUserId && s.suspensions?.[s.currentUserId]) throw new Error("This account is suspended. Email support if you think this is a mistake.");
  };
  // Team switches, same rules as the database (migration 0021).
  const featureState = (uid: string | null | undefined, key: AccountFeature) => (uid ? s.features?.[uid]?.[key]?.state : undefined) ?? "auto";
  const notOff = (key: AccountFeature) => {
    if (featureState(s.currentUserId, key) === "off") throw new Error(featureOffMessage(key));
  };
  const goodOrders = (shopId: string) => s.orders.filter((o) => o.shop.id === shopId && o.status === "completed" && (!o.review || o.review.stars >= 4)).length;
  const publicShop = (sh: DShop): ShopPublic => {
    const t = ownerOf(sh.id).trust;
    return {
      id: sh.id, name: sh.name, handle: sh.handle, category: sh.category, bio: sh.bio, trustScore: t, tier: tierFor(t),
      sales: s.orders.filter((o) => o.shop.id === sh.id && ["delivered", "completed"].includes(o.status)).length,
      followers: s.follows.filter((f) => f.shopId === sh.id).length, founding: !!sh.foundingUntil && new Date(sh.foundingUntil) > now(),
    };
  };
  const canSell = (sh: DShop) => sh.status === "open" && sh.checks.idStatus === "approved" && sh.checks.bankStatus === "approved" && sh.checks.rulesAccepted;

  function grantReward(uid: string, kind: Reward["kind"], o: DOrder) {
    s.rewards = s.rewards ?? [];
    if (s.suspensions?.[uid] || featureState(uid, "welcome_credit") === "off") return;
    if (s.rewards.some((r) => r.userId === uid && r.kind === kind) || o.totals.itemPrice < 10000) return;
    const given = s.rewards.filter((r) => r.status !== "forfeited").reduce((n, r) => n + r.amountCents, 0);
    if (given + 5000 > 1_500_000) return;
    s.rewards.unshift({ id: id(), userId: uid, kind, amountCents: 5000, status: "pending", usableFrom: o.releasableAt, createdAt: now().toISOString(),
      seen: false, orderTitle: o.product.title, earnedOrderId: o.id, usedOrderId: null });
    notify(uid, "Surprise! You earned R50", `${kind === "first_buy" ? "A thank you for your first order." : kind === "first_auction" ? "A thank you for your first auction win." : "A thank you for your first sale."} It's yours to spend once the return window closes. One reward comes off an order of R200 or more.`, "/me");
  }
  const readyReward = (uid: string) => (s.rewards ?? []).filter((r) => r.userId === uid && r.status === "ready").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

  function setStatus(o: DOrder, to: OrderStatus) {
    if (!canTransition(o.status, to)) throw new Error(`Order cannot go from ${o.status} to ${to}`);
    const t = now();
    const title = o.product.title;
    if (to === "paid") {
      o.paidAt = t.toISOString();
      o.shipBy = shipBy(t).toISOString();
      const p = s.products.find((x) => x.id === o.product.id)!;
      for (const item of [p, ...(o.bundleIds ?? []).map((bid) => s.products.find((x) => x.id === bid)!).filter(Boolean)]) {
        if (item.mode !== "order_now") { item.stock = Math.max(0, item.stock - 1); if (item.stock === 0) item.status = "sold_out"; }
        item.heldFor = null; item.heldUntil = null;
      }
      if (o.offerId) (s.offers ?? []).forEach((of) => { if (of.id === o.offerId) of.status = "used"; });
      notify(o.shopOwnerId, `New order: ${title}`, "Ship within 2 days. The money is held safely until the return window closes.", `/sell/orders/${o.id}`);
      notify(o.buyerId, "Payment received", `Your money is held safely. We will tell you when ${title} ships.`, `/orders/${o.id}`);
    }
    if (to === "shipped") { o.shippedAt = t.toISOString(); notify(o.buyerId, `On the way: ${title}`, o.trackingRef ? `Tracking: ${o.trackingRef}` : "The seller has sent your order.", `/orders/${o.id}`); }
    if (to === "delivered") {
      o.deliveredAt = t.toISOString();
      o.releasableAt = releasableAt(o.mode, t).toISOString();
      notify(o.buyerId, `Delivered: ${title}`, o.mode === "buy_now" ? "You have 7 days to return it if you change your mind." : "Tell us within the check period if something is wrong.", `/orders/${o.id}`);
      // Surprise rewards, same rules as the database (migration 0024).
      grantReward(o.buyerId, o.mode === "auction" ? "first_auction" : "first_buy", o);
      grantReward(o.shopOwnerId, "first_sale", o);
    }
    if (to === "completed") {
      trust(o.shopOwnerId, "order_kept"); schedulePayout(o);
      // A delivery stamp for an Instant EFT order of R200 or more, like the database (0029).
      if (/ozow|instant.?eft/i.test(o.paymentMethod ?? "") && o.totals.itemPrice >= DELIVERY_PERKS.stampMinOrder && !(s.stamps ?? []).some((x) => x.earnedOrderId === o.id)) {
        s.stamps = [...(s.stamps ?? []), { userId: o.buyerId, earnedOrderId: o.id, usedOrderId: null }];
        const n = s.stamps.filter((x) => x.userId === o.buyerId && !x.usedOrderId).length;
        notify(o.buyerId, n >= 5 ? "Half price delivery unlocked" : `Delivery stamp ${n} of 5`,
          n >= 5 ? "You have 5 Instant EFT stamps. Your next courier or locker delivery is half price." : `Paying with Instant EFT earned you a stamp. ${5 - n} more for half price delivery.`, "/inbox");
      }
      (s.rewards ?? []).filter((r) => r.earnedOrderId === o.id && r.status === "pending").forEach((r) => {
        r.status = "ready"; notify(r.userId, "Your R50 is ready", "It comes off your next order of R200 or more, by itself.", "/me");
      });
    }
    if (to === "refunded" || to === "cancelled") {
      (s.stamps ?? []).forEach((x) => { if (x.usedOrderId === o.id) x.usedOrderId = null; });
      (s.rewards ?? []).forEach((r) => {
        if (r.earnedOrderId === o.id && (r.status === "pending" || r.status === "ready")) r.status = "forfeited";
        if (r.usedOrderId === o.id && r.status === "used") { r.status = "ready"; r.usedOrderId = null; }
      });
    }
    if (to === "refunded") {
      if (o.status === "paid") {
        trust(o.shopOwnerId, "not_shipped");
        const p = s.products.find((x) => x.id === o.product.id)!;
        p.stock += 1; if (p.status === "sold_out") p.status = "live";
      }
      notify(o.buyerId, "Refund on the way", "Your money is going back to your card or account.", `/orders/${o.id}`);
    }
    o.status = to;
  }

  function schedulePayout(o: DOrder) {
    const tier = tierFor(ownerOf(o.shop.id).trust);
    const rel = new Date(o.releasableAt ?? now().toISOString());
    const payOn = payoutDate(tier, rel);
    s.payouts.unshift({ id: id(), orderId: o.id, shopId: o.shop.id, amountCents: o.totals.sellerPayout, releasableAt: rel.toISOString(),
      payOn: payOn ? payOn.toISOString().slice(0, 10) : null, status: payOn ? "scheduled" : "held",
      topUpCents: o.totals.creditTopUp ?? 0, topUpPaid: false });
  }

  // ===== Auctions (same rules as migration 0016). Auctions use the real clock, not the demo day skip. =====
  const roundBids = (p: DProduct) => (s.bids ?? []).filter((b) => b.productId === p.id && b.round === (p.auctionRound ?? 0)).sort((a, b) => b.amountCents - a.amountCents || a.at.localeCompare(b.at));
  const handleOf = (uid: string) => s.users.find((x) => x.id === uid)?.handle ?? null;
  function settleAuction(p: DProduct) {
    if (p.mode !== "auction") return;
    const owner = shopOf(p.shopId).ownerId;
    if (p.auctionState === "open" && p.auctionEndsAt && Date.now() >= new Date(p.auctionEndsAt).getTime()) {
      const top = roundBids(p)[0];
      if (top && top.amountCents >= (p.reserveCents ?? 0)) {
        Object.assign(p, { auctionState: "won", auctionWinner: top.bidderId, auctionPriceCents: top.amountCents, auctionPayBy: new Date(Date.now() + 2 * 3600e3).toISOString(), status: "sold_out" });
        notify(top.bidderId, `You won: ${p.title}`, `Pay R${top.amountCents / 100} within 2 hours to keep it. Your money is held safely until it arrives.`, `/i/${p.id}`);
        notify(owner, `Sold at auction: ${p.title}`, `R${top.amountCents / 100}. The winner has 2 hours to pay.`, `/i/${p.id}`);
      } else {
        Object.assign(p, { auctionState: "unsold", status: "draft" });
        notify(owner, `Auction ended: ${p.title}`, top ? "The reserve wasn't met. You can list it again." : "No bids this time. You can list it again.");
      }
      save();
    } else if (p.auctionState === "won" && p.auctionPayBy && Date.now() > new Date(p.auctionPayBy).getTime()
               && !s.orders.some((o) => o.product.id === p.id && o.buyerId === p.auctionWinner && !["pending_payment", "cancelled"].includes(o.status))) {
      Object.assign(p, { auctionState: "unpaid", status: "draft" });
      if (p.auctionWinner) { trust(p.auctionWinner, "unpaid_auction_win"); notify(p.auctionWinner, "Auction win cancelled", `${p.title} wasn't paid within 2 hours, so you lost trust points.`); }
      notify(owner, `Winner didn't pay: ${p.title}`, "You can list it again.");
      save();
    }
  }
  function auctionInfoFor(p: DProduct): AuctionInfo {
    const viewer = s.currentUserId;
    const bs = roundBids(p);
    const top = bs[0];
    return {
      productId: p.id, state: p.auctionState ?? null, endsAt: p.auctionEndsAt ?? null, startCents: p.priceCents,
      currentCents: top?.amountCents ?? null, bidCount: bs.length,
      minNextCents: top ? top.amountCents + bidStep(top.amountCents) : p.priceCents,
      reserveSet: p.reserveCents != null, reserveMet: p.reserveCents == null || (top?.amountCents ?? 0) >= p.reserveCents,
      leaderIsMe: !!top && top.bidderId === viewer, myTopCents: bs.filter((b) => b.bidderId === viewer)[0]?.amountCents ?? null,
      winnerIsMe: !!viewer && p.auctionWinner === viewer, priceCents: p.auctionPriceCents ?? null, payBy: p.auctionPayBy ?? null,
      recent: bs.slice(0, 5).map((b) => ({ who: b.bidderId === viewer ? "You" : maskHandle(handleOf(b.bidderId)), amountCents: b.amountCents, at: b.at })),
    };
  }

  /** Same jobs as the run-due server function. */
  function runDue() {
    for (const p of s.products) settleAuction(p);
    const t = now();
    for (const o of s.orders) {
      if (o.status === "paid" && o.shipBy && new Date(o.shipBy) < t) setStatus(o, "refunded");
      else if (o.status === "delivered" && o.releasableAt && new Date(o.releasableAt) <= t) setStatus(o, "completed");
    }
    const today = t.toISOString().slice(0, 10);
    for (const p of s.payouts) if (p.status === "scheduled" && p.payOn && p.payOn <= today) p.status = "released";
  }

  const toFeed = (po: DPost): FeedItem => {
    const p = s.products.find((x) => x.id === po.productId)!;
    const edit = po.edit ? { ...po.edit, clips: po.edit.clips.map((c) => ({ ...c, video: { ...c.video, url: mediaUrl(c.video.url) } })) } : undefined;
    return { postId: po.id, caption: po.caption, product: p, shop: publicShop(shopOf(po.shopId)), edit, video: DEMO_CLIPS[po.id] ? { ...po.video, url: DEMO_CLIPS[po.id], kind: "video" } : { ...po.video, url: mediaUrl(po.video.url) } };
  };
  const typingIn = new Set<string>();
  const offerOf = (oid?: string | null) => {
    const of = oid ? (s.offers ?? []).find((x) => x.id === oid) : undefined;
    if (!of) return null;
    const listedCents = of.productIds.reduce((n, pid) => n + (s.products.find((p) => p.id === pid)?.priceCents ?? 0), 0);
    return { id: of.id, productIds: of.productIds, priceCents: of.priceCents, listedCents, expiresAt: of.expiresAt, status: of.status, madeBy: of.madeBy ?? "seller" };
  };
  const blockedBetween = (a: string, b: string) => s.blocks.some((x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a));
  const toConv = (c: State["conversations"][number], viewer: string) => {
    const sh = shopOf(c.shopId);
    const msgs = s.messages.filter((m) => m.conversationId === c.id);
    const lastMsg = msgs[msgs.length - 1];
    const last = lastMsg && { ...lastMsg, body: lastMsg.offerId ? "Sent an offer" : lastMsg.body || (lastMsg.image ? "Sent a photo" : "") };
    return { id: c.id, shopId: sh.id, shopName: sh.name, shopHandle: sh.handle,
      otherName: c.buyerId === viewer ? sh.name : s.users.find((x) => x.id === c.buyerId)?.displayName || "Buyer",
      iAmSeller: c.buyerId !== viewer, lastBody: last?.body ?? null, lastAt: c.lastAt,
      unread: msgs.filter((m) => m.senderId !== viewer && !m.readAt).length, buyerId: c.buyerId };
  };
  const visible = (po: DPost) => {
    const p = s.products.find((x) => x.id === po.productId);
    const sh = shopOf(po.shopId);
    return p?.status === "live" && sh.status === "open" && ownerOf(sh.id).trust >= 40;
  };

  const api: Api = {
    mode: "demo",
    async currentUser() {
      return s.users.find((u) => u.id === s.currentUserId) ?? null;
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async sendCode(contact) {
      await wait();
      if (contact.trim().length < 5) throw new Error("Enter your email or cell number.");
    },
    async verifyCode(contact, code) {
      await wait();
      if (code.trim() !== CODE) throw new Error("That code did not work. In the demo, use 123456.");
      const key = contact.trim().toLowerCase();
      // Demo: sign in as a sample shop owner to try the seller side of chats (lebo@, kamva@ or ayesha@shop.demo).
      const SAMPLE: Record<string, string> = { "lebo@shop.demo": "u-lebo", "kamva@shop.demo": "u-luxe", "ayesha@shop.demo": "u-sweet" };
      let u = SAMPLE[key] ? s.users.find((x) => x.id === SAMPLE[key]) : s.users.find((x) => x.email === key || x.phone === key);
      if (!u) {
        u = { id: id(), displayName: key.split("@")[0], trust: 50, welcomeUsed: false, admin: key.startsWith("admin"), createdAt: now().toISOString(),
          ...(key.includes("@") ? { email: key } : { phone: key }) };
        s.users.push(u);
      }
      s.currentUserId = u.id;
      save();
      listeners.forEach((l) => l(u!));
      return u;
    },
    async signOut() {
      s.currentUserId = null;
      save();
      listeners.forEach((l) => l(null));
    },

    async feed(offset = 0) {
      await mediaReady;
      await wait(150);
      runDue();
      const sales = (shopId: string) => s.orders.filter((o) => o.shop.id === shopId && !["pending_payment", "cancelled", "refunded"].includes(o.status)).length;
      const bonus = (shopId: string) => ({ top: 10, trusted: 5, standard: 0, restricted: 0 })[tierFor(ownerOf(shopId).trust)];
      const rank = (po: DPost) => 3 * sales(po.shopId) + bonus(po.shopId) - (now().getTime() - new Date(po.createdAt).getTime()) / 86400e3;
      // Team switch: "off" hides the shop from the feed, "on" shows it even under trust 40.
      const inFeed = (po: DPost) => { const o = shopOf(po.shopId).ownerId; const st = featureState(o, "in_feed");
        return st === "on" ? (() => { const p = s.products.find((x) => x.id === po.productId); return p?.status === "live" && shopOf(po.shopId).status === "open"; })() : st !== "off" && visible(po); };
      return s.posts.filter(inFeed).sort((a, b) => rank(b) - rank(a)).slice(offset, offset + 20).map(toFeed);
    },
    async shop(handle) {
      await mediaReady;
      const sh = s.shops.find((x) => x.handle === handle && x.status === "open");
      if (!sh) return null;
      return { shop: publicShop(sh), items: s.posts.filter((p) => p.shopId === sh.id && visible(p)).map(toFeed) };
    },
    async checkout(input: CheckoutInput) {
      notSuspended(); notOff("buy");
      await wait();
      const u = me();
      const p = s.products.find((x) => x.id === input.productId);
      if (p) settleAuction(p);
      const auction = p?.mode === "auction";
      if (auction) {
        if (p!.auctionState !== "won" || p!.auctionWinner !== u.id) throw new Error("Only the winner can pay for this auction.");
        if (!p!.auctionPayBy || new Date(p!.auctionPayBy) < new Date()) throw new Error("The 2 hours to pay have passed.");
      } else if (!p || p.status !== "live") throw new Error("This item is no longer available.");
      if (!p) throw new Error("This item is no longer available.");
      const sh = shopOf(p.shopId);
      if (sh.ownerId === u.id) throw new Error("You cannot buy your own item.");
      if (p.sizes.length && !p.sizes.includes(input.size ?? "")) throw new Error("Pick a size.");
      const dd = input.deliveryDetails;
      if (bookedByUs(input.delivery) && !(dd.name?.trim() && (dd.phone ?? "").replace(/\D/g, "").length >= 9)) throw new Error("Add your name and cell number for the courier.");
      if (input.delivery === "pudo_locker" && !DEMO_POINTS.some((x) => x.id === input.pickupPoint?.id)) throw new Error("Pick a locker.");
      if (input.delivery === "courier" && !(dd.street && dd.suburb && dd.city && dd.province && /^\d{4}$/.test(dd.postalCode ?? "")))
        throw new Error("Check the delivery address: street, suburb, city, province and a 4 digit postal code.");
      if (p.mode === "order_now" && (!input.foodDate || !input.foodSlot)) throw new Error("Pick a date and time slot.");
      if (p.heldFor && p.heldFor !== u.id && p.heldUntil && new Date(p.heldUntil) > new Date()) throw new Error("The seller is holding this item for someone else right now.");
      let itemPrice = auction ? p.auctionPriceCents! : p.priceCents;
      let bundleIds: string[] = [];
      let title = p.title;
      if (input.offerId) {
        const of = (s.offers ?? []).find((x) => x.id === input.offerId);
        const conv = of && s.conversations.find((c) => c.id === of.conversationId);
        if (!of || !conv || conv.buyerId !== u.id) throw new Error("This offer is for someone else.");
        if (of.status !== "open" || new Date(of.expiresAt) < new Date()) throw new Error("This offer has ended.");
        if (of.productIds[0] !== p.id) throw new Error("This offer is for a different item.");
        bundleIds = of.productIds.slice(1);
        if (bundleIds.some((bid) => { const x = s.products.find((y) => y.id === bid); return !x || x.status !== "live" || (x.mode === "buy_now" && x.stock < 1); }))
          throw new Error("Something in this bundle is no longer available.");
        if (bundleIds.length) title = `Bundle: ${p.title} + ${bundleIds.length} more`;
        itemPrice = of.priceCents;
      }
      const reward = featureState(u.id, "welcome_credit") !== "off" ? readyReward(u.id) : undefined;
      const parcelSize = orderParcelSize([p, ...bundleIds.map((b) => s.products.find((y) => y.id === b))].map((x) => x?.parcelSize));
      if (deliveryFee(input.delivery, parcelSize) === null) throw new Error(`This parcel is ${PARCEL_SIZES[parcelSize].label.toLowerCase()}, too big for a locker. Pick courier or collection.`);
      const point = input.delivery === "pudo_locker" ? DEMO_POINTS.find((x) => x.id === input.pickupPoint?.id) ?? null : null;
      if (point) dd.locker = point.name;
      const myStamps = (s.stamps ?? []).filter((x) => x.userId === u.id && !x.usedOrderId);
      const totals = orderTotals({ itemPrice, delivery: input.delivery, parcelSize, welcomeCreditAvailable: !!reward, stampsReady: myStamps.length >= 5,
        foundingUntil: sh.foundingUntil ? new Date(sh.foundingUntil) : null, at: now() });
      const oid = id();
      const o: DOrder = {
        id: oid, status: "pending_payment", mode: p.mode, product: { id: p.id, title }, bundleIds, offerId: input.offerId ?? null, shop: { id: sh.id, name: sh.name, handle: sh.handle },
        buyerId: u.id, shopOwnerId: sh.ownerId, size: input.size ?? null, delivery: input.delivery, deliveryDetails: input.deliveryDetails as Record<string, string>,
        foodDate: input.foodDate ?? null, foodSlot: input.foodSlot ?? null, totals, checkoutUrl: `/mock-pay/${oid}`, trackingRef: null, packingCode: packingCodeFor(oid),
        parcelSize: p.mode === "order_now" ? null : parcelSize, pickupPoint: point, courierName: null, hasLabel: false, trackingStatus: null,
        paidAt: null, shipBy: null, shippedAt: null, deliveredAt: null, releasableAt: null, createdAt: now().toISOString(), ret: null, review: null,
      };
      s.orders.unshift(o);
      if (reward && totals.creditUsed > 0) { reward.status = "used"; reward.usedOrderId = oid; }
      if (totals.deliveryPerk === "stamp") myStamps.slice(0, 5).forEach((x) => { x.usedOrderId = oid; });
      save();
      return { orderId: oid, checkoutUrl: o.checkoutUrl!, totals };
    },
    async mockPay(orderId) {
      await wait(400);
      const o = s.orders.find((x) => x.id === orderId && x.buyerId === me().id);
      if (!o || o.status !== "pending_payment") throw new Error("Nothing to pay.");
      o.paymentMethod = "OZOW (test)";
      setStatus(o, "paid");
      const ap = s.products.find((x) => x.id === o.product.id && x.mode === "auction");
      if (ap) Object.assign(ap, { auctionState: "paid", status: "sold_out", stock: 0 });
      save();
    },
    async checkPayment(orderId) {
      const o = s.orders.find((x) => x.id === orderId && x.buyerId === me().id);
      return !!o && !["pending_payment", "cancelled"].includes(o.status);
    },
    async myOrders() {
      runDue();
      const u = me();
      return s.orders.filter((o) => o.buyerId === u.id);
    },
    async order(oid) {
      runDue();
      const u = me();
      return s.orders.find((o) => o.id === oid && (o.buyerId === u.id || o.shopOwnerId === u.id || u.admin)) ?? null;
    },
    async cancelUnpaid(oid) {
      const o = s.orders.find((x) => x.id === oid && x.buyerId === me().id);
      if (!o || o.status !== "pending_payment") throw new Error("Only unpaid orders can be cancelled.");
      setStatus(o, "cancelled");
      save();
    },
    async confirmReceived(oid) {
      const o = s.orders.find((x) => x.id === oid && x.buyerId === me().id);
      if (!o || o.status !== "shipped") throw new Error("Only shipped orders can be marked as received");
      setStatus(o, "delivered");
      save();
    },
    async requestReturn(oid, reason, details) {
      const o = s.orders.find((x) => x.id === oid && x.buyerId === me().id);
      if (!o || o.status !== "delivered") throw new Error("Returns open once the order is delivered");
      if (o.releasableAt && now() > new Date(o.releasableAt)) throw new Error("The return window has closed");
      if (!returnReasonsFor(o.mode).includes(reason)) throw new Error("Auctions and made to order items cannot be returned for a change of mind");
      o.ret = { reason, details, status: "requested", postagePayer: RETURN_POSTAGE_PAYER[reason] };
      setStatus(o, "return_requested");
      notify(o.shopOwnerId, "Return requested", "The buyer wants to return an order. The payout waits until it is sorted out.", `/sell/orders/${o.id}`);
      save();
    },
    async leaveReview(oid, stars) {
      const o = s.orders.find((x) => x.id === oid && x.buyerId === me().id);
      if (!o || !["delivered", "completed"].includes(o.status)) throw new Error("You can review once the order arrives");
      if (o.review) throw new Error("You already reviewed this order.");
      o.review = { stars };
      if (stars === 5) trust(o.shopOwnerId, "five_star_review");
      save();
    },
    async notifications() {
      const u = me();
      runDue(); // closes ended auctions, like the scheduled job on the server
      return s.notifications.filter((n) => n.userId === u.id);
    },
    async markAllRead() {
      const u = me();
      s.notifications.forEach((n) => { if (n.userId === u.id && !n.readAt) n.readAt = now().toISOString(); });
      save();
    },
    async myProfile() {
      await mediaReady;
      const u = me();
      return {
        id: u.id, displayName: u.displayName, bio: u.bio ?? "", email: u.email, trustScore: u.trust, createdAt: u.createdAt ?? now().toISOString(),
        handle: u.handle ?? null, avatarUrl: mediaUrl(u.avatar), handleChangedAt: u.handleChangedAt ?? null, setUp: !!(u.handle && u.adult && u.terms),
        ordersCount: s.orders.filter((o) => o.buyerId === u.id && !["pending_payment", "cancelled"].includes(o.status)).length,
      };
    },
    async updateProfile(displayName, bio) {
      me().displayName = displayName.trim();
      me().bio = bio.trim().slice(0, 150);
      save();
      listeners.forEach((l) => l(me()));
    },
    async availableHandles(list) {
      const u = s.users.find((x) => x.id === s.currentUserId);
      return list.slice(0, 12).map((h) => h.toLowerCase()).filter((h) => !demoHandleProblem(h, u?.id));
    },
    async completeAccount(name, handle, adult, terms) {
      await wait();
      if (!adult) throw new Error("You need to be 18 or older to use myHaul.");
      if (!terms) throw new Error("Please accept the terms to continue.");
      if (!name.trim() || name.trim().length > 40) throw new Error("Add your name (up to 40 characters).");
      await this.setUsername(handle);
      const u = me();
      u.displayName = name.trim(); u.adult = true; u.terms = true;
      save();
      listeners.forEach((l) => l(u));
    },
    async setUsername(handle) {
      const u = me();
      const h = handle.trim().toLowerCase();
      if (u.handle === h) return;
      const problem = demoHandleProblem(h, u.id);
      if (problem) throw new Error(problem);
      if (u.handle && u.handleChangedAt && new Date(u.handleChangedAt).getTime() > Date.now() - 30 * 86400e3) {
        throw new Error(`You can change your username again on ${new Date(new Date(u.handleChangedAt).getTime() + 30 * 86400e3).toLocaleDateString("en-ZA", { day: "numeric", month: "long" })}.`);
      }
      u.handleChangedAt = u.handle ? new Date().toISOString() : null;
      u.handle = h;
      save();
    },
    async setAvatar(photo) {
      const u = me();
      u.avatar = photo ? await stash(photo) : null;
      save();
      listeners.forEach((l) => l(u));
      return mediaUrl(u.avatar);
    },
    async shopAvatars(ids) {
      await mediaReady;
      const out: Record<string, string> = {};
      ids.forEach((sid) => { const sh = s.shops.find((x) => x.id === sid); const url = sh && mediaUrl(s.users.find((x) => x.id === sh.ownerId)?.avatar); if (url) out[sid] = url; });
      return out;
    },
    async reactions() {
      const u = s.users.find((x) => x.id === s.currentUserId);
      const mine = (s.reactions ?? []).filter((r) => u && r.userId === u.id);
      return { liked: mine.filter((r) => r.kind === "like").map((r) => r.postId), reposted: mine.filter((r) => r.kind === "repost").map((r) => r.postId) };
    },
    async react(postId, kind, on) {
      const u = me();
      s.reactions = (s.reactions ?? []).filter((r) => !(r.userId === u.id && r.postId === postId && r.kind === kind));
      if (on) s.reactions.unshift({ userId: u.id, postId, kind, at: now().toISOString() });
      save();
    },
    async postCounts(ids) {
      // A little starting activity on the sample posts so the counts look real.
      const base: Record<string, [number, number]> = { "po-1": [214, 12], "po-2": [96, 7], "po-3": [341, 28], "po-4": [58, 3], "po-5": [133, 9] };
      return Object.fromEntries(ids.map((pid) => {
        const rs = (s.reactions ?? []).filter((r) => r.postId === pid);
        const [l, r] = base[pid] ?? [0, 0];
        return [pid, { likes: l + rs.filter((x) => x.kind === "like").length, reposts: r + rs.filter((x) => x.kind === "repost").length }];
      }));
    },
    async reactedPosts(kind, shopId) {
      await mediaReady;
      const who = shopId ? shopOf(shopId).ownerId : me().id;
      return (s.reactions ?? []).filter((r) => r.userId === who && r.kind === kind)
        .map((r) => s.posts.find((po) => po.id === r.postId)).filter((po): po is DPost => !!po && visible(po)).map(toFeed);
    },
    async followingReposts() {
      await mediaReady;
      const u = me();
      const owners = new Map(s.follows.filter((f) => f.userId === u.id).map((f) => [shopOf(f.shopId).ownerId, shopOf(f.shopId).handle]));
      return (s.reactions ?? []).filter((r) => r.kind === "repost" && owners.has(r.userId))
        .map((r) => ({ r, po: s.posts.find((x) => x.id === r.postId) }))
        .filter((x): x is { r: typeof x.r; po: DPost } => !!x.po && visible(x.po))
        .map(({ r, po }) => ({ ...toFeed(po), repostedBy: owners.get(r.userId) }));
    },
    async productPhotos(productId) {
      await mediaReady;
      return (s.posts.find((p) => p.productId === productId)?.photos ?? []).map((u) => mediaUrl(u)).filter((u): u is string => !!u);
    },
    async suggestListing() {
      // Demo mode can't read the photo: it returns a clearly labelled example so you can see how suggestions work.
      await wait(900);
      return { title: "Denim jacket, light wash, size M", label: "pre_loved", condition: "good", priceCents: 42000,
        description: "Classic light wash denim jacket with button front and chest pockets.", demo: true };
    },
    async report(kind, targetId, reason, details) {
      const u = me();
      s.reports.push({ id: id(), reporterId: u.id, targetKind: kind, targetId, reason, details: details.slice(0, 500), createdAt: now().toISOString(), status: "open" });
      save();
    },
    async block(target) {
      const u = me();
      const who = target.userId ?? (target.shopId ? shopOf(target.shopId).ownerId : undefined);
      if (!who || who === u.id) throw new Error("You can't block that account.");
      if (!s.blocks.some((b) => b.blockerId === u.id && b.blockedId === who)) s.blocks.push({ blockerId: u.id, blockedId: who });
      save();
    },
    async unblock(userId) {
      const u = me();
      s.blocks = s.blocks.filter((b) => !(b.blockerId === u.id && b.blockedId === userId));
      save();
    },
    async blocked() {
      const u = s.users.find((x) => x.id === s.currentUserId);
      if (!u) return [];
      return s.blocks.filter((b) => b.blockerId === u.id).map((b) => {
        const person = s.users.find((x) => x.id === b.blockedId);
        const sh = s.shops.find((x) => x.ownerId === b.blockedId);
        return { userId: b.blockedId, name: person?.displayName || "User", shopId: sh?.id ?? null, shopHandle: sh?.handle ?? null };
      });
    },
    async savePushToken() { /* demo: nothing to send to */ },
    async auctionInfo(ids) {
      const out: Record<string, AuctionInfo> = {};
      for (const pid of ids) { const p = s.products.find((x) => x.id === pid && x.mode === "auction"); if (p) { settleAuction(p); out[pid] = auctionInfoFor(p); } }
      return out;
    },
    async placeBid(productId, amountCents) {
      notSuspended(); notOff("bid");
      await wait(200);
      const u = me();
      const p = s.products.find((x) => x.id === productId);
      if (p) settleAuction(p);
      if (!p || p.mode !== "auction" || p.status !== "live" || p.auctionState !== "open" || !p.auctionEndsAt || Date.now() >= new Date(p.auctionEndsAt).getTime()) throw new Error("This auction has ended.");
      const sh = shopOf(p.shopId);
      if (sh.status !== "open") throw new Error("This auction has ended.");
      if (sh.ownerId === u.id) throw new Error("You can't bid on your own item.");
      if (!u.handle || !u.adult) throw new Error("Finish setting up your account to bid.");
      if (u.trust < 40) throw new Error("Your account is under review, so you can't bid right now.");
      if (blockedBetween(u.id, sh.ownerId)) throw new Error("You can't bid on this shop.");
      const top = roundBids(p)[0];
      const min = top ? top.amountCents + bidStep(top.amountCents) : p.priceCents;
      if (amountCents < min) throw new Error(`The lowest bid now is R${min / 100}.`);
      if (amountCents > Math.max(min * 5, 100000)) throw new Error("That's far above the current bid. Check the amount.");
      s.bids = [...(s.bids ?? []), { id: id(), productId: p.id, round: p.auctionRound ?? 0, bidderId: u.id, amountCents, at: new Date().toISOString() }];
      if (new Date(p.auctionEndsAt).getTime() - Date.now() < 2 * 60e3) p.auctionEndsAt = new Date(Date.now() + 2 * 60e3).toISOString();
      if (top && top.bidderId !== u.id) notify(top.bidderId, "You've been outbid", `${p.title} is now at R${amountCents / 100}. Bid again before it ends.`, `/i/${p.id}`);
      notify(sh.ownerId, `New bid: R${amountCents / 100}`, p.title, `/i/${p.id}`);
      save();
      return auctionInfoFor(p);
    },
    async settleAuction(productId) {
      const p = s.products.find((x) => x.id === productId);
      if (p) settleAuction(p);
    },
    async savedDelivery() {
      const u = s.users.find((x) => x.id === s.currentUserId);
      return (u && s.delivery?.[u.id]) || null;
    },
    async saveDelivery(d) {
      const u = me();
      s.delivery = { ...(s.delivery ?? {}) };
      if (d) s.delivery[u.id] = d; else delete s.delivery[u.id];
      save();
    },
    async deliveryStamps() {
      const u = s.users.find((x) => x.id === s.currentUserId);
      return u ? (s.stamps ?? []).filter((x) => x.userId === u.id && !x.usedOrderId).length : 0;
    },
    async parcelSizes(ids) {
      return Object.fromEntries(ids.map((i) => [i, s.products.find((p) => p.id === i)?.parcelSize ?? "small"]));
    },
    async pickupPoints() {
      await wait(300);
      return { points: DEMO_POINTS, cities: ["Cape Town", "Johannesburg", "Pretoria", "Durban"] };
    },
    async shopPickup() {
      const sh = s.shops.find((x) => x.ownerId === me().id);
      return (sh && s.pickup?.[sh.id]) || null;
    },
    async saveShopPickup(p) {
      const sh = s.shops.find((x) => x.ownerId === me().id);
      if (!sh) throw new Error("Open your shop first.");
      if (!/^\d{4}$/.test(p.postalCode) || !p.province || p.street.trim().length < 3 || p.phone.replace(/\D/g, "").length < 9) throw new Error("Check the address and cell number.");
      s.pickup = { ...(s.pickup ?? {}), [sh.id]: p };
      save();
    },
    async courierLabel(oid) {
      const o = s.orders.find((x) => x.id === oid && (x.shopOwnerId === me().id || me().admin));
      if (!o?.trackingRef || !o.hasLabel) throw new Error("There's no courier label for this order.");
      return `/mock-label/${o.trackingRef}`;
    },
    async shipmentEvents(oid) {
      return (s.shipEvents?.[oid] ?? []).slice().sort((a, b) => b.at.localeCompare(a.at));
    },
    async saveInterests(interests) {
      const u = s.users.find((x) => x.id === s.currentUserId);
      if (!u) return;
      s.interests = { ...(s.interests ?? {}), [u.id]: interests };
      save();
    },
    async reportError(e) {
      try {
        s.errors = [{ id: id(), message: e.message.slice(0, 500), stack: e.stack?.slice(0, 4000) ?? null, path: e.path ?? null, platform: e.platform ?? null,
          version: e.version ?? null, createdAt: new Date().toISOString(), userId: s.currentUserId }, ...(s.errors ?? [])].slice(0, 50);
        save();
      } catch { /* never throw */ }
    },
    async recentErrors() {
      if (!me().admin) throw new Error("Team only.");
      return s.errors ?? [];
    },
    async signInWithPassword(email, password) {
      if (password !== CODE) throw new Error("Wrong email or password. In the demo, the password is 123456.");
      return this.verifyCode(email, CODE);
    },
    async deleteAccount() {
      const u = me();
      const open = s.orders.filter((o) => (o.buyerId === u.id || o.shopOwnerId === u.id) && !["completed", "cancelled", "refunded"].includes(o.status)).length;
      if (open) throw new Error(`You have ${open} open ${open === 1 ? "order" : "orders"}. Finish ${open === 1 ? "it" : "them"} first, then delete your account.`);
      const myShops = s.shops.filter((x) => x.ownerId === u.id).map((x) => x.id);
      s.posts = s.posts.filter((p) => !myShops.includes(p.shopId));
      s.shops.forEach((x) => { if (x.ownerId === u.id && x.status !== "banned") x.status = "paused"; });
      s.comments = s.comments.filter((c) => c.userId !== u.id);
      s.reactions = (s.reactions ?? []).filter((r) => r.userId !== u.id);
      s.follows = s.follows.filter((f) => f.userId !== u.id);
      s.blocks = s.blocks.filter((b) => b.blockerId !== u.id && b.blockedId !== u.id);
      const convs = s.conversations.filter((c) => c.buyerId === u.id || myShops.includes(c.shopId)).map((c) => c.id);
      s.conversations = s.conversations.filter((c) => !convs.includes(c.id));
      s.messages = s.messages.filter((m) => !convs.includes(m.conversationId));
      s.notifications = s.notifications.filter((n) => n.userId !== u.id);
      u.displayName = "Deleted user"; u.bio = ""; u.email = undefined;
      s.currentUserId = null;
      save();
      listeners.forEach((l) => l(null));
    },
    async openReports() {
      return s.reports.filter((r) => r.status === "open").map((r) => {
        const summary = r.targetKind === "post" ? s.posts.find((p) => p.id === r.targetId)?.caption
          : r.targetKind === "comment" ? s.comments.find((c) => c.id === r.targetId)?.body
          : r.targetKind === "shop" ? s.shops.find((x) => x.id === r.targetId)?.name : "";
        return { id: r.id, targetKind: r.targetKind, targetId: r.targetId, reason: r.reason, details: r.details, createdAt: r.createdAt, summary: summary ?? "" };
      });
    },
    async handleReport(rid, action) {
      if (!me().admin) throw new Error("Only our team can do this.");
      const r = s.reports.find((x) => x.id === rid);
      if (!r) throw new Error("Report not found.");
      if (action === "remove") {
        if (r.targetKind === "post") s.posts = s.posts.filter((p) => p.id !== r.targetId);
        if (r.targetKind === "comment") s.comments.forEach((c) => { if (c.id === r.targetId) c.hidden = true; });
        if (r.targetKind === "shop") s.shops.forEach((x) => { if (x.id === r.targetId) x.status = "banned"; });
        if (r.targetKind === "post") { const po = s.posts.find((p) => p.id === r.targetId); if (po) s.products.forEach((p) => { if (p.id === po.productId) p.status = "removed"; }); }
      }
      r.status = action === "remove" ? "actioned" : "dismissed";
      logTeam(action === "remove" ? "Acted on report" : "Dismissed report", "report", r.id, `${r.reason} on a ${r.targetKind}`);
      save();
    },

    async comments(postId) {
      await mediaReady;
      const viewer = s.currentUserId;
      const post = s.posts.find((p) => p.id === postId);
      return s.comments.filter((c) => c.postId === postId && !c.hidden && !(viewer && blockedBetween(viewer, c.userId)))
        .map((c) => {
          const sh = s.shops.find((x) => x.ownerId === c.userId);
          const who = s.users.find((x) => x.id === c.userId);
          return { id: c.id, body: c.body, createdAt: c.createdAt, userId: c.userId, name: who?.displayName || who?.handle || "User",
            shopHandle: sh?.handle ?? null, isSeller: !!post && sh?.id === post.shopId, mine: c.userId === viewer, userHandle: who?.handle ?? null, avatarUrl: mediaUrl(who?.avatar) };
        });
    },
    async addComment(postId, body) {
      notSuspended(); notOff("comment");
      const u = me();
      const text = body.trim();
      if (!text) throw new Error("Write something first.");
      if (isRude(text)) throw new Error("Please keep it friendly. That message has words we don't allow.");
      const post = s.posts.find((p) => p.id === postId);
      if (!post) throw new Error("This post is gone.");
      if (blockedBetween(u.id, shopOf(post.shopId).ownerId)) throw new Error("You can't comment here.");
      s.comments.push({ id: id(), postId, userId: u.id, body: text.slice(0, 300), createdAt: now().toISOString() });
      if (shopOf(post.shopId).ownerId !== u.id) notify(shopOf(post.shopId).ownerId, "New comment", text.slice(0, 80));
      save();
    },
    async deleteComment(cid) {
      const u = me();
      const c = s.comments.find((x) => x.id === cid);
      const post = c && s.posts.find((p) => p.id === c.postId);
      if (!c || !(c.userId === u.id || (post && shopOf(post.shopId).ownerId === u.id) || u.admin)) throw new Error("You can't delete this comment.");
      s.comments = s.comments.filter((x) => x.id !== cid);
      save();
    },
    async commentCounts(ids) {
      return Object.fromEntries(ids.map((pid) => [pid, s.comments.filter((c) => c.postId === pid && !c.hidden).length]));
    },

    async conversations() {
      const u = s.users.find((x) => x.id === s.currentUserId);
      if (!u) return [];
      return s.conversations.filter((c) => (c.buyerId === u.id || shopOf(c.shopId).ownerId === u.id) && !blockedBetween(c.buyerId, shopOf(c.shopId).ownerId))
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt)).map((c) => toConv(c, u.id));
    },
    async openConversation(shopId) {
      const u = me();
      if (shopOf(shopId).ownerId === u.id) throw new Error("This is your own shop.");
      if (blockedBetween(u.id, shopOf(shopId).ownerId)) throw new Error("You can't message this shop.");
      let c = s.conversations.find((x) => x.buyerId === u.id && x.shopId === shopId);
      if (!c) { c = { id: id(), buyerId: u.id, shopId, lastAt: now().toISOString() }; s.conversations.push(c); save(); }
      return c.id;
    },
    async thread(cid) {
      const u = me();
      const c = s.conversations.find((x) => x.id === cid && (x.buyerId === u.id || shopOf(x.shopId).ownerId === u.id));
      if (!c) throw new Error("This chat isn't available.");
      s.messages.forEach((m) => { if (m.conversationId === cid && m.senderId !== u.id && !m.readAt) m.readAt = now().toISOString(); });
      save();
      return { conversation: toConv(c, u.id), messages: s.messages.filter((m) => m.conversationId === cid)
        .map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt, mine: m.senderId === u.id, readAt: m.readAt, productId: m.productId ?? null,
          imageUrl: mediaUrl(m.image ?? null), offer: offerOf(m.offerId) })), typing: typingIn.has(cid) };
    },
    async productItem(productId) {
      await mediaReady;
      const p = s.products.find((x) => x.id === productId);
      if (!p) return null;
      const post = s.posts.find((x) => x.productId === productId);
      return post ? toFeed(post) : { postId: p.id, caption: p.title, product: p, shop: publicShop(shopOf(p.shopId)), video: {} };
    },
    async makeOffer(cid, productIds, priceCents, hours) {
      notSuspended(); notOff("offers");
      const u = me();
      const c = s.conversations.find((x) => x.id === cid);
      if (!c || shopOf(c.shopId).ownerId !== u.id) throw new Error("Only the shop in this chat can make an offer.");
      const items = productIds.map((pid) => s.products.find((p) => p.id === pid));
      if (!productIds.length || items.some((p) => !p || p.shopId !== c.shopId || p.status !== "live")) throw new Error("Offers can only include live items from your shop.");
      const listed = items.reduce((n, p) => n + p!.priceCents, 0);
      if (priceCents > listed) throw new Error(`An offer can't be more than the listed price (R${listed / 100}).`);
      if (priceCents < 5000) throw new Error("Special prices start at R50.");
      const of = { id: id(), conversationId: cid, productIds, priceCents, expiresAt: new Date(Date.now() + hours * 3600e3).toISOString(), status: "open" as const }; // real clock, not the demo time skip
      s.offers = [...(s.offers ?? []), of];
      s.messages.push({ id: id(), conversationId: cid, senderId: u.id, body: "", createdAt: now().toISOString(), readAt: null, offerId: of.id });
      c.lastAt = now().toISOString();
      notify(c.buyerId, "New offer", `${shopOf(c.shopId).name} sent you a special price.`, `/messages/${cid}`);
      save();
    },
    async buyerOffer(cid, productId, priceCents) {
      notSuspended();
      const u = me();
      const c = s.conversations.find((x) => x.id === cid);
      if (!c || c.buyerId !== u.id) throw new Error("Only the buyer in this chat can make an offer.");
      const p = s.products.find((x) => x.id === productId);
      if (!p || p.shopId !== c.shopId || p.status !== "live") throw new Error("That item isn't available.");
      if (p.mode !== "buy_now") throw new Error("Offers are only for Buy now items.");
      if (priceCents < 5000) throw new Error("Offers start at R50.");
      if (priceCents >= p.priceCents) throw new Error(`Offer less than the listed price (R${p.priceCents / 100}).`);
      if (priceCents * 2 < p.priceCents) throw new Error(`Offers can't be less than half the price (R${Math.ceil(p.priceCents / 200)}).`);
      if ((s.offers ?? []).some((o) => o.conversationId === cid && o.madeBy === "buyer" && o.status === "pending" && o.productIds.includes(productId)))
        throw new Error("You already have an offer waiting on this item.");
      const of = { id: id(), conversationId: cid, productIds: [productId], priceCents, expiresAt: new Date(Date.now() + 24 * 3600e3).toISOString(), status: "pending" as const, madeBy: "buyer" as const };
      s.offers = [...(s.offers ?? []), of];
      s.messages.push({ id: id(), conversationId: cid, senderId: u.id, body: "", createdAt: now().toISOString(), readAt: null, offerId: of.id });
      c.lastAt = now().toISOString();
      notify(shopOf(c.shopId).ownerId, `New offer: R${priceCents / 100}`, `Someone offered R${priceCents / 100} for ${p.title}.`, `/messages/${cid}`);
      save();
    },
    async answerOffer(oid, accept) {
      const u = me();
      const of = (s.offers ?? []).find((x) => x.id === oid);
      const c = of && s.conversations.find((x) => x.id === of.conversationId);
      if (!of || !c || shopOf(c.shopId).ownerId !== u.id) throw new Error("Only the seller can answer this offer.");
      if (of.status !== "pending") throw new Error("This offer has already been answered or has ended.");
      of.status = accept ? "open" : "declined";
      if (accept) of.expiresAt = new Date(Date.now() + 24 * 3600e3).toISOString();
      notify(c.buyerId, accept ? "Offer accepted" : "Offer declined", accept ? "Pay within 24 hours to get it." : "The seller declined your offer.", `/messages/${c.id}`);
      save();
    },
    async holdProduct(productId, buyerId, hours) {
      const u = me();
      const p = s.products.find((x) => x.id === productId);
      if (!p || shopOf(p.shopId).ownerId !== u.id) throw new Error("Only the seller can hold this item.");
      if (hours === 0) { p.heldFor = null; p.heldUntil = null; }
      else { p.heldFor = buyerId; p.heldUntil = new Date(Date.now() + hours * 3600e3).toISOString(); }
      save();
    },
    async shopReplyMinutes(shopId) {
      if (shopId.startsWith("s-")) return { "s-lebo": 25, "s-luxe": 50, "s-sweet": 90 }[shopId] ?? null; // sample shops
      const times = s.conversations.filter((c) => c.shopId === shopId).map((c) => {
        const ms = s.messages.filter((m) => m.conversationId === c.id);
        const asked = ms.find((m) => m.senderId === c.buyerId);
        const answered = ms.find((m) => m.senderId !== c.buyerId && asked && m.createdAt > asked.createdAt);
        return asked && answered ? (new Date(answered.createdAt).getTime() - new Date(asked.createdAt).getTime()) / 60000 : null;
      }).filter((x): x is number => x !== null).sort((a, b) => a - b);
      return times.length ? Math.round(times[Math.floor(times.length / 2)]) : null;
    },
    async sendMessage(cid, body, productId, image) {
      notSuspended(); notOff("message");
      const u = me();
      const text = body.trim();
      const c = s.conversations.find((x) => x.id === cid);
      if (!c || (!text && !image)) return;
      if (text && isRude(text)) throw new Error("Please keep it friendly. That message has words we don't allow.");
      const ownerId = shopOf(c.shopId).ownerId;
      if (blockedBetween(c.buyerId, ownerId)) throw new Error("You can't message this account.");
      if (productId && s.products.find((p) => p.id === productId)?.shopId !== c.shopId) throw new Error("That item is from a different shop.");
      s.messages.push({ id: id(), conversationId: cid, senderId: u.id, body: text.slice(0, 1000), createdAt: now().toISOString(), readAt: null, productId: productId ?? null, image: image ? await stash(image) : null });
      c.lastAt = now().toISOString();
      const other = u.id === c.buyerId ? ownerId : c.buyerId;
      notify(other, "New message", text.slice(0, 80), `/messages/${cid}`);
      save();
      // Demo: sample shops answer after a moment so you can see a conversation.
      if (other.startsWith("u-") && !s.messages.some((m) => m.conversationId === cid && m.senderId === other)) {
        window.setTimeout(() => typingIn.add(cid), 400); // "typing…" before the sample reply
        window.setTimeout(() => {
          typingIn.delete(cid);
          s.messages.push({ id: id(), conversationId: cid, senderId: other, createdAt: now().toISOString(), readAt: null,
            body: "Hi! Thanks for asking. Yes, it's available. Please order through the app so your money stays protected." });
          c.lastAt = now().toISOString();
          notify(c.buyerId, "New message", "Hi! Thanks for asking. Yes, it's available.", `/messages/${cid}`);
          save();
        }, 1500);
      }
    },

    async following() {
      const u = me();
      return s.follows.filter((f) => f.userId === u.id).map((f) => s.shops.find((x) => x.id === f.shopId)).filter(Boolean).map((sh) => publicShop(sh!));
    },
    async follow(shopId) {
      const u = me();
      if (!s.follows.some((f) => f.userId === u.id && f.shopId === shopId)) s.follows.push({ userId: u.id, shopId });
      save();
    },
    async unfollow(shopId) {
      const u = me();
      s.follows = s.follows.filter((f) => !(f.userId === u.id && f.shopId === shopId));
      save();
    },
    async welcomeCreditAvailable() {
      const u = me();
      return featureState(u.id, "welcome_credit") !== "off" && !!readyReward(u.id);
    },
    async myRewards() {
      if (!s.currentUserId) return [];
      runDue();
      return (s.rewards ?? []).filter((r) => r.userId === s.currentUserId).map(({ userId: _u, earnedOrderId: _e, usedOrderId: _x, ...r }) => r);
    },
    async markRewardsSeen(ids) {
      (s.rewards ?? []).forEach((r) => { if (ids.includes(r.id)) r.seen = true; });
      save();
    },
    async teamRewards(uid) {
      teamOnly();
      return (s.rewards ?? []).filter((r) => r.userId === uid).map(({ userId: _u, earnedOrderId: _e, usedOrderId: _x, ...r }) => r);
    },

    async myShop() {
      const sh = myShopRow();
      if (!sh) return null;
      return {
        id: sh.id, name: sh.name, handle: sh.handle, category: sh.category, status: sh.status, foundingUntil: sh.foundingUntil,
        trustScore: me().trust, goodOrders: goodOrders(sh.id), checks: sh.checks,
        products: s.products.filter((p) => p.shopId === sh.id && p.status !== "removed").map((p) => ({ ...p, posted: s.posts.some((po) => po.productId === p.id) })),
      };
    },
    async startShop(name, handle, category) {
      await wait();
      const u = me();
      const h = handle.toLowerCase();
      const problem = demoHandleProblem(h, u.id);
      if (problem) throw new Error(`Shop handle: ${problem}`);
      const existing = myShopRow();
      if (existing) {
        if (existing.status !== "onboarding") throw new Error("Your shop is already open");
        Object.assign(existing, { name, handle: h, category });
      } else {
        s.shops.push({ id: id(), ownerId: u.id, name, handle: h, category, bio: "", status: "onboarding", foundingUntil: null,
          checks: { phone: null, idStatus: "not_started", bankStatus: "not_started", bankName: null, bankLast4: null, certStatus: "not_started", rulesAccepted: false } });
      }
      save();
    },
    async submitId(phone) {
      await wait(500);
      const sh = myShopRow();
      if (!sh) throw new Error("Start your shop first");
      sh.checks.phone = phone;
      sh.checks.idStatus = "pending";
      save();
      // Demo: our team "approves" a few seconds later.
      setTimeout(() => {
        if (sh.checks.idStatus === "pending") {
          sh.checks.idStatus = "approved";
          trust(sh.ownerId, "verified");
          notify(sh.ownerId, "ID approved", "You earned your first 10 trust points.", "/sell");
          save();
        }
      }, 3000);
    },
    async addBank(input) {
      await wait(500);
      const sh = myShopRow();
      if (!sh) throw new Error("Start your shop first");
      const digits = input.accountNumber.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 13) throw new Error("Check the account number.");
      Object.assign(sh.checks, { bankStatus: "approved", bankName: input.bankName, bankLast4: digits.slice(-4) });
      save();
    },
    async submitFoodCert() {
      await wait(400);
      const sh = myShopRow();
      if (!sh) throw new Error("Start your shop first");
      sh.checks.certStatus = "pending";
      save();
      setTimeout(() => { if (sh.checks.certStatus === "pending") { sh.checks.certStatus = "approved"; save(); } }, 3000);
    },
    async acceptRules() {
      const sh = myShopRow();
      if (sh) sh.checks.rulesAccepted = true;
      save();
    },
    async openShop() {
      const sh = myShopRow();
      if (!sh) throw new Error("Start your shop first");
      if (!sh.checks.rulesAccepted) throw new Error("Accept the seller rules first");
      if (sh.checks.idStatus === "not_started") throw new Error("Add your ID first");
      if (sh.checks.bankStatus === "not_started") throw new Error("Add your bank account first");
      if (sh.status === "onboarding") {
        sh.status = "open";
        const opened = s.shops.filter((x) => x.status !== "onboarding").length;
        if (opened <= 50) sh.foundingUntil = new Date(now().getTime() + 90 * 86400e3).toISOString();
      }
      save();
    },
    async createListing(input: ListingInput, video, proof, onProgress, photos = [], edit = null) {
      notSuspended(); notOff("sell");
      const sh = myShopRow();
      if (!sh) throw new Error("Start your shop first.");
      const errors = validateListing({ title: input.title, description: input.description, price: input.priceCents, label: input.label,
        condition: input.condition ?? undefined, hasProof: !!proof, mode: input.mode });
      if (errors.length) throw new Error(errors[0]);
      for (const pct of [20, 50, 80, 100]) { await wait(120); onProgress?.(pct); }
      let live = canSell(sh);
      let message = live ? undefined : "Saved as a draft. It goes live once your ID and bank account are checked.";
      if (input.mode === "order_now" && sh.checks.certStatus !== "approved") { live = false; message = "Order now needs an approved Certificate of Acceptability."; }
      if (input.label === "authentic_designer") { live = false; message = "We check the proof before designer items go live. This usually takes a day."; }
      if (input.mode === "auction") {
        notOff("auctions");
        if (featureState(sh.ownerId, "auctions") !== "on" && goodOrders(sh.id) < 5) throw new Error("Auctions unlock after 5 delivered orders with good ratings.");
        if (input.reserveCents != null && (input.reserveCents < input.priceCents || input.reserveCents > input.priceCents * 10))
          throw new Error("The reserve must be between the starting bid and 10 times it.");
      }
      const pid = id();
      s.products.push({
        id: pid, shopId: sh.id, title: input.title, description: input.description, priceCents: input.priceCents, mode: input.mode, label: input.label,
        condition: input.condition, sizes: input.sizes, stock: input.stock, leadDays: input.leadDays, allergens: input.allergens, parcelSize: input.mode === "order_now" ? null : input.parcelSize ?? "small",
        status: live ? "live" : "draft", proofStatus: proof ? "pending" : "not_started",
        ...(input.mode === "auction" ? { stock: 1, reserveCents: input.reserveCents ?? null, auctionState: live ? "open" : null, auctionRound: 0,
          auctionEndsAt: new Date(Date.now() + (input.auctionDays ?? 3) * 86400e3).toISOString() } : {}),
      });
      if (edit) {
        const problems = validateEdit(edit.list);
        if (problems.length) throw new Error(problems[0]);
      }
      const first = edit?.files[0] ?? video;
      if (first && sh.status === "open") {
        const clipUrls = edit ? await Promise.all(edit.files.map((f) => stash(f))) : [];
        s.posts.unshift({ id: id(), shopId: sh.id, productId: pid, caption: input.caption, createdAt: now().toISOString(),
          edit: edit ? { clips: edit.list.clips.map((c, i) => ({ ...c, video: { url: clipUrls[i], kind: edit.files[i].type.startsWith("image/") ? "image" : "video" } })),
            marks: edit.list.marks.map((m) => ({ ...m, text: m.text?.trim() || undefined, productId: m.productId === "self" ? pid : m.productId })), cover: edit.list.cover } : undefined,
          photos: await Promise.all(photos.slice(0, 9).map((p) => stash(p))),
          video: { url: clipUrls[0] ?? await stash(first), kind: first.type.startsWith("image/") ? "image" : "video", demo: { bg: "#3f3f46", label: "Your post (this browser only)" } } });
      }
      save();
      return { live, message };
    },
    async sellerOrders() {
      runDue();
      const sh = myShopRow();
      return sh ? s.orders.filter((o) => o.shop.id === sh.id && o.status !== "pending_payment") : [];
    },
    async shipOrder(oid, trackingRef, packingVideo, packingPhoto) {
      const o = s.orders.find((x) => x.id === oid && x.shopOwnerId === me().id);
      if (!o || o.status !== "paid") throw new Error("Only paid orders can be shipped.");
      if (!packingVideo || !packingPhoto) throw new Error("Add the packing video and the photo of the sealed parcel before shipping.");
      // Courier and locker: booked through Bob Go (test booking here), like the server does.
      if (bookedByUs(o.delivery)) {
        const sh = s.shops.find((x) => x.ownerId === me().id);
        if (!sh || !s.pickup?.[sh.id]) throw new Error("Add your pickup address first (Me, then To ship), so the courier knows where to collect.");
        trackingRef = `MOCK${oid.slice(0, 8).toUpperCase()}`;
        o.courierName = o.delivery === "pudo_locker" ? "PUDO (test)" : "The Courier Guy (test)";
        o.hasLabel = true;
        o.trackingStatus = "submitted";
        s.shipEvents = { ...(s.shipEvents ?? {}), [oid]: [{ at: now().toISOString(), status: "submitted", message: "Booked. The courier collects from the seller.", location: null }] };
      }
      // Kept on this phone, like the private bucket on the server.
      for (const [k, f] of [[`packing-video-${oid}`, packingVideo], [`packing-photo-${oid}`, packingPhoto]] as const) {
        keepBlob(k, f); blobUrls.set(k, URL.createObjectURL(f));
      }
      o.packingVideo = `packing-video-${oid}`; o.packingPhoto = `packing-photo-${oid}`;
      o.trackingRef = trackingRef || null;
      setStatus(o, "shipped");
      if (o.paidAt && now().getTime() - new Date(o.paidAt).getTime() <= 48 * 3600e3) trust(o.shopOwnerId, "fast_ship_with_video");
      save();
    },
    async acceptReturn(oid) {
      const o = s.orders.find((x) => x.id === oid && x.shopOwnerId === me().id);
      if (!o || o.status !== "return_requested" || !o.ret) throw new Error("No return to accept.");
      o.ret.status = "in_transit";
      setStatus(o, "return_in_transit");
      notify(o.buyerId, "Return accepted", o.ret.postagePayer === "buyer" ? "Send the item back. You pay the return postage." : "Send the item back. The seller pays the return postage.", `/orders/${o.id}`);
      save();
    },
    async returnReceived(oid) {
      const o = s.orders.find((x) => x.id === oid && x.shopOwnerId === me().id);
      if (!o || o.status !== "return_in_transit" || !o.ret) throw new Error("No return on the way.");
      o.ret.status = "refunded";
      setStatus(o, "refunded");
      save();
    },
    async disputeReturn(oid) {
      const o = s.orders.find((x) => x.id === oid && x.shopOwnerId === me().id);
      if (!o || o.status !== "return_requested") throw new Error("No return to dispute.");
      if (o.ret?.reason === "changed_mind") throw new Error("Change of mind returns within 7 days are the buyer's right.");
      s.users.filter((u) => u.admin).forEach((a) => notify(a.id, "Return disputed", `Order for ${o.product.title}`, "/admin"));
      save();
    },
    async payouts() {
      runDue();
      const sh = myShopRow();
      return sh ? s.payouts.filter((p) => p.shopId === sh.id) : [];
    },

    // ===== Team dashboard (demo) =====
    async teamOverview() {
      teamOnly(); runDue();
      const t0 = now();
      const paid = s.orders.filter((o) => o.paidAt && !["cancelled", "refunded"].includes(o.status));
      const within = (iso: string | null, days: number) => !!iso && t0.getTime() - new Date(iso).getTime() < days * 86400e3;
      const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
      const daily = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(t0.getTime() - (13 - i) * 86400e3); const k = dayKey(d);
        const os = paid.filter((o) => dayKey(new Date(o.paidAt!)) === k);
        return { day: k, orders: os.length, salesCents: os.reduce((a, o) => a + o.totals.total, 0) };
      });
      const byStatus: TeamOverview["byStatus"] = {};
      s.orders.forEach((o) => { byStatus[o.status] = (byStatus[o.status] ?? 0) + 1; });
      const due = s.payouts.filter((p) => p.topUpCents > 0 && !p.topUpPaid);
      const last30 = paid.filter((o) => within(o.paidAt, 30));
      const out: TeamOverview = {
        people: s.users.length, peopleNew7: s.users.filter((u) => within(u.createdAt ?? null, 7)).length, suspended: Object.keys(s.suspensions ?? {}).length,
        shopsOpen: s.shops.filter((x) => x.status === "open").length, shopsOnboarding: s.shops.filter((x) => x.status === "onboarding").length,
        shopsClosed: s.shops.filter((x) => x.status === "paused" || x.status === "banned").length,
        checksWaiting: s.shops.filter((x) => x.checks.idStatus === "pending").length + s.shops.filter((x) => x.checks.certStatus === "pending").length,
        reportsOpen: s.reports.filter((r) => r.status === "open").length, returnsWaiting: s.orders.filter((o) => o.status === "return_requested").length,
        topUpsDue: due.length, topUpsDueCents: due.reduce((a, p) => a + p.topUpCents, 0),
        errors7: (s.errors ?? []).filter((e) => within(e.createdAt, 7)).length,
        liveListings: s.products.filter((p) => p.status === "live").length, auctionsOpen: s.products.filter((p) => p.mode === "auction" && p.auctionState === "open").length,
        ordersToday: paid.filter((o) => dayKey(new Date(o.paidAt!)) === dayKey(t0)).length, orders30: last30.length,
        sales30Cents: last30.reduce((a, o) => a + o.totals.total, 0), fees30Cents: last30.reduce((a, o) => a + o.totals.sellerFee + o.totals.protectionFee, 0),
        credit30Cents: last30.reduce((a, o) => a + o.totals.creditUsed, 0),
        toShip: s.orders.filter((o) => o.status === "paid").length, late: s.orders.filter((o) => o.status === "paid" && o.shipBy && new Date(o.shipBy) < t0).length,
        byStatus, daily,
      };
      return out;
    },
    async teamPeople(q, filter, offset = 0) {
      teamOnly();
      const needle = q.trim().toLowerCase();
      return s.users.map(personRow).filter((p) => {
        const hay = [p.name, p.handle, p.email, p.shop?.name, p.shop?.handle].filter(Boolean).join(" ").toLowerCase();
        if (needle && !hay.includes(needle)) return false;
        switch (filter) {
          case "sellers": return !!p.shop;
          case "buyers": return !p.shop;
          case "waiting": return p.shop?.idStatus === "pending" || p.shop?.certStatus === "pending";
          case "suspended": return !!p.suspendedAt;
          case "team": return p.role === "admin";
          default: return true;
        }
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(offset, offset + 50);
    },
    async teamPerson(uid) {
      teamOnly();
      const u = s.users.find((x) => x.id === uid);
      if (!u) throw new Error("Account not found.");
      const row = personRow(u);
      const sh = s.shops.find((x) => x.ownerId === u.id);
      const targets = targetsOf(u.id);
      const out: TeamPersonDetail = {
        ...row, bio: u.bio ?? "", city: "Cape Town", adultConfirmedAt: u.adult ? row.createdAt : null, termsAcceptedAt: u.terms ? row.createdAt : null,
        phone: sh?.checks.phone ?? null, bank: sh?.checks.bankName ? `${sh.checks.bankName} ending ${sh.checks.bankLast4}` : null,
        files: [], liveListings: sh ? s.products.filter((p) => p.shopId === sh.id && p.status === "live").length : 0,
        orders: s.orders.filter((o) => o.buyerId === u.id || o.shopOwnerId === u.id).slice(-20).reverse().map((o) => ({
          id: o.id, createdAt: o.createdAt, status: o.status, title: o.product.title, totalCents: o.totals.total,
          side: o.buyerId === u.id ? "bought" as const : "sold" as const,
          other: o.buyerId === u.id ? o.shop.name : (s.users.find((x) => x.id === o.buyerId)?.handle ?? "buyer") })),
        trustEvents: (s.trustLog ?? []).filter((e) => e.userId === u.id).slice(0, 20).map((e) => ({ kind: e.kind, points: e.points, note: null, at: e.at })),
        reports: s.reports.filter((r) => targets.includes(r.targetId)).map((r) => ({ id: r.id, reason: r.reason, targetKind: r.targetKind, details: r.details, status: r.status, createdAt: r.createdAt })),
        actions: (s.teamLog ?? []).filter((a) => a.targetId === u.id || (sh && a.targetId === sh.id)).map((a) => ({ action: a.action, note: a.note, at: a.at, by: a.by })),
      };
      return out;
    },
    async suspendAccount(uid, reason) {
      teamOnly();
      if (uid === s.currentUserId) throw new Error("You can't suspend your own account.");
      const u = s.users.find((x) => x.id === uid);
      if (!u) throw new Error("Account not found.");
      if (u.admin) throw new Error("Remove them from the team first.");
      if (!reason.trim()) throw new Error("Add a reason. The person sees it.");
      s.suspensions = s.suspensions ?? {};
      if (s.suspensions[uid]) throw new Error("This account is already suspended.");
      s.suspensions[uid] = { reason: reason.trim(), at: now().toISOString() };
      s.shops.forEach((x) => { if (x.ownerId === uid && x.status === "open") x.status = "paused"; });
      notify(uid, "Your account is suspended", `${reason.trim()} You can still see your orders. Email support if you think this is a mistake.`);
      logTeam("Suspended account", "user", uid, reason.trim());
      save();
    },
    async unsuspendAccount(uid) {
      teamOnly();
      if (!s.suspensions?.[uid]) throw new Error("This account isn't suspended.");
      delete s.suspensions[uid];
      s.shops.forEach((x) => { if (x.ownerId === uid && x.status === "paused") x.status = "open"; });
      notify(uid, "Your account is active again", "You can buy, sell and chat again.");
      logTeam("Lifted suspension", "user", uid);
      save();
    },
    async setShopStatus(shopId, status, reason) {
      teamOnly();
      const sh = shopOf(shopId);
      if (!sh) throw new Error("Shop not found.");
      if (status === "open" && !(sh.checks.idStatus === "approved" && sh.checks.bankStatus === "approved")) throw new Error("Approve the ID and bank checks first.");
      if (status === "open" && s.suspensions?.[sh.ownerId]) throw new Error("Lift the owner's suspension first.");
      if (status !== "open" && !reason?.trim()) throw new Error("Add a reason. The seller sees it.");
      sh.status = status;
      if (status === "banned") s.products.forEach((p) => { if (p.shopId === shopId && p.status === "live") p.status = "removed"; });
      notify(sh.ownerId, status === "open" ? "Your shop is open" : status === "paused" ? "Your shop is paused" : "Your shop is closed", reason?.trim() || "You can sell again.", "/me?tab=selling");
      logTeam(status === "open" ? "Opened shop" : status === "paused" ? "Paused shop" : "Closed shop", "shop", shopId, reason?.trim() || null);
      save();
    },
    async setTeamRole(uid, role) {
      teamOnly();
      if (uid === s.currentUserId) throw new Error("Someone else on the team has to change your role.");
      const u = s.users.find((x) => x.id === uid);
      if (!u) throw new Error("Account not found.");
      if (role === "admin" && s.suspensions?.[uid]) throw new Error("Lift the suspension first.");
      if (u.admin === (role === "admin")) return;
      u.admin = role === "admin";
      logTeam(role === "admin" ? "Added to the team" : "Removed from the team", "user", uid);
      save();
    },
    async teamOrders(q, filter, offset = 0) {
      teamOnly(); runDue();
      const needle = q.trim().toLowerCase(); const t0 = now();
      return s.orders.filter((o) => {
        const hay = `${o.product.title} ${o.shop.name} ${s.users.find((u) => u.id === o.buyerId)?.handle ?? ""} ${o.id}`.toLowerCase();
        if (needle && !hay.includes(needle)) return false;
        const late = o.status === "paid" && !!o.shipBy && new Date(o.shipBy) < t0;
        switch (filter) {
          case "to_ship": return o.status === "paid";
          case "late": return late;
          case "returns": return o.status === "return_requested" || o.status === "return_in_transit";
          case "open": return ["paid", "shipped", "delivered", "return_requested", "return_in_transit"].includes(o.status);
          case "done": return ["completed", "refunded", "cancelled"].includes(o.status);
          default: return o.status !== "pending_payment";
        }
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(offset, offset + 50).map((o): TeamOrder => {
        const p = s.payouts.find((x) => x.orderId === o.id); const buyer = s.users.find((u) => u.id === o.buyerId);
        return { id: o.id, createdAt: o.createdAt, paidAt: o.paidAt, status: o.status, mode: o.mode, title: o.product.title, shopName: o.shop.name, shopHandle: o.shop.handle,
          sellerId: o.shopOwnerId, buyerId: o.buyerId, buyer: buyer?.handle ?? buyer?.displayName ?? "buyer", totalCents: o.totals.total,
          feeCents: o.totals.sellerFee + o.totals.protectionFee, creditCents: o.totals.creditUsed, payoutCents: o.totals.sellerPayout,
          shipBy: o.shipBy, late: o.status === "paid" && !!o.shipBy && new Date(o.shipBy) < t0, trackingRef: o.trackingRef,
          payoutStatus: p?.status ?? null, payOn: p?.payOn ?? null, returnReason: o.ret?.reason ?? null, returnDetails: o.ret?.details ?? null };
      });
    },
    async teamListings(q, filter, offset = 0) {
      teamOnly(); runDue();
      const needle = q.trim().toLowerCase();
      return s.products.filter((p) => {
        const sh = shopOf(p.shopId);
        if (needle && !`${p.title} ${sh.name} ${sh.handle}`.toLowerCase().includes(needle)) return false;
        switch (filter) {
          case "auctions": return p.mode === "auction" && (p.status === "live" || p.status === "sold_out");
          case "removed": return p.status === "removed";
          case "proof": return p.proofStatus === "pending";
          default: return p.status === "live";
        }
      }).slice(offset, offset + 50).map((p): TeamListing => {
        const sh = shopOf(p.shopId); const postIds = s.posts.filter((po) => po.productId === p.id).map((po) => po.id);
        return { id: p.id, title: p.title, priceCents: p.priceCents, mode: p.mode, label: p.label, status: p.status, stock: p.stock, createdAt: now().toISOString(),
          removedReason: null, proofStatus: p.proofStatus, shopId: sh.id, shopName: sh.name, shopHandle: sh.handle, sellerId: sh.ownerId,
          auctionState: p.auctionState ?? null, auctionEndsAt: p.auctionEndsAt ?? null,
          reports: s.reports.filter((r) => r.status === "open" && postIds.includes(r.targetId)).length };
      });
    },
    async removeListing(productId, reason) {
      teamOnly();
      if (!reason.trim()) throw new Error("Add a reason. The seller sees it.");
      const p = s.products.find((x) => x.id === productId);
      if (!p) throw new Error("Listing not found.");
      p.status = "removed";
      notify(shopOf(p.shopId).ownerId, "Listing removed", `${p.title}: ${reason.trim()}`, "/me?tab=selling");
      logTeam("Removed listing", "product", productId, reason.trim());
      save();
    },
    async teamLog() {
      teamOnly();
      return (s.teamLog ?? []).map((a) => ({ ...a, target: a.targetKind === "user" ? (() => { const u = s.users.find((x) => x.id === a.targetId); return u ? (u.handle ? "@" + u.handle : u.displayName) : null; })()
        : a.targetKind === "shop" ? s.shops.find((x) => x.id === a.targetId)?.name ?? null
        : a.targetKind === "product" ? s.products.find((x) => x.id === a.targetId)?.title ?? null
        : a.targetKind === "order" ? s.orders.find((x) => x.id === a.targetId)?.product.title ?? null : null }));
    },
    async teamAlerts() {
      teamOnly(); runDue(); demoAlerts(); save();
      return (s.alerts ?? []).map(({ dedupe: _d, ...a }) => a);
    },
    async markAlertsSeen(ids) {
      teamOnly();
      (s.alerts ?? []).forEach((a) => { if (ids.includes(a.id)) a.seen = true; });
      save();
    },
    async teamPacking(oid) {
      teamOnly();
      const o = s.orders.find((x) => x.id === oid);
      if (!o) throw new Error("Order not found.");
      if (o.packingVideo) logTeam("Viewed packing proof", "order", oid);
      const since = now().getTime() - 90 * 86400e3;
      return { orderId: oid, code: o.packingCode, videoUrl: o.packingVideo ? blobUrls.get(o.packingVideo) ?? null : null,
        photoUrl: o.packingPhoto ? blobUrls.get(o.packingPhoto) ?? null : null, shippedAt: o.shippedAt, review: o.packingReview ?? null,
        reviewedAt: o.packingReviewedAt ?? null, purgedAt: null,
        strikes90: (s.packingStrikes ?? []).filter((x) => x.shopId === o.shop.id && new Date(x.at).getTime() > since).length };
    },
    async teamPackingReview(oid, ok, note) {
      teamOnly();
      const o = s.orders.find((x) => x.id === oid);
      if (!o) throw new Error("Order not found.");
      if (!o.packingVideo) throw new Error("This order has no packing video.");
      o.packingReviewedAt = now().toISOString();
      if (ok) { o.packingReview = "ok"; logTeam("Packing video OK", "order", oid); save(); return 0; }
      if (!note?.trim()) throw new Error("Say what was wrong. The seller sees it.");
      s.packingStrikes = s.packingStrikes ?? [];
      if (s.packingStrikes.some((x) => x.orderId === oid)) throw new Error("This order already has a strike.");
      s.packingStrikes.push({ shopId: o.shop.id, orderId: oid, note: note.trim(), at: now().toISOString() });
      o.packingReview = "strike";
      const since = now().getTime() - 90 * 86400e3;
      const n = s.packingStrikes.filter((x) => x.shopId === o.shop.id && new Date(x.at).getTime() > since).length;
      if (n === 1) notify(o.shopOwnerId, `Packing warning: ${o.product.title}`, `${note.trim()} Show the code, every side of the item and the sealing. 3 strikes in 90 days pauses your listings.`, `/sell/orders/${oid}`);
      else if (n === 2) { trust(o.shopOwnerId, "packing_strike"); notify(o.shopOwnerId, `Second packing strike: ${o.product.title}`, `${note.trim()} You lost trust points. One more in 90 days pauses your listings.`, `/sell/orders/${oid}`); }
      else {
        s.features = s.features ?? {};
        (s.features[o.shopOwnerId] = s.features[o.shopOwnerId] ?? {}).sell = { state: "off", reason: `${n} packing strikes in 90 days`, at: now().toISOString(), by: me().handle ?? "team" };
        notify(o.shopOwnerId, "Listings paused: packing rules", `${note.trim()} That is ${n} packing strikes in 90 days. Email help@myhaul.co.za to talk to us.`, `/sell/orders/${oid}`);
      }
      logTeam(`Packing strike ${n} of 3`, "order", oid, note.trim());
      save();
      return n;
    },
    async teamPackingQueue() {
      teamOnly();
      // The demo has few orders, so every unchecked shipment shows (the server picks about 1 in 20).
      return s.orders.filter((o) => o.packingVideo && !o.packingReview && o.shippedAt).map((o) => ({
        orderId: o.id, title: o.product.title, shopName: o.shop.name, sellerId: o.shopOwnerId, shippedAt: o.shippedAt!, code: o.packingCode }));
    },
    async teamPackingShare(oid, note) {
      teamOnly();
      const o = s.orders.find((x) => x.id === oid);
      if (!o) throw new Error("Order not found.");
      logTeam("Shared packing proof (7 day link)", "order", oid, note?.trim() || null);
      save();
      return { video: o.packingVideo ? blobUrls.get(o.packingVideo) ?? null : null, photo: o.packingPhoto ? blobUrls.get(o.packingPhoto) ?? null : null };
    },
    async teamFeatures(uid) {
      teamOnly();
      const u = s.users.find((x) => x.id === uid);
      if (!u) throw new Error("Account not found.");
      const sh = s.shops.find((x) => x.ownerId === uid);
      const good = sh ? goodOrders(sh.id) : 0;
      const ready = !!sh && canSell(sh);
      const rule: Record<AccountFeature, [boolean, string]> = {
        buy: [true, "Allowed"], bid: [true, "Allowed"], comment: [true, "Allowed"], message: [true, "Allowed"], offers: [true, "Allowed"],
        welcome_credit: [true, (s.rewards ?? []).filter((r) => r.userId === uid).map((r) => `${r.kind.replace("_", " ")} ${r.status}`).join(", ") || "None earned yet"],
        sell: [ready, !sh ? "No shop yet" : ready ? "Checks done" : "Waiting for ID and bank checks"],
        auctions: [good >= 5, `${good} of 5 good orders`], live: [good >= 5, `${good} of 5 good orders`],
        in_feed: [u.trust >= 40, `Trust ${u.trust}`], payouts: [u.trust >= 40, u.trust >= 40 ? "Paid by trust tier" : "Held: Restricted"],
      };
      return Object.fromEntries(ACCOUNT_FEATURE_KEYS.map((k) => {
        const x = s.features?.[uid]?.[k];
        const f: TeamFeature = { state: x?.state ?? "auto", reason: x?.reason ?? null, at: x?.at ?? null, by: x?.by ?? null, autoOk: rule[k][0], autoNote: rule[k][1] };
        return [k, f];
      })) as Record<AccountFeature, TeamFeature>;
    },
    async setAccountFeature(uid, key, state, reason) {
      teamOnly();
      if (!s.users.find((x) => x.id === uid)) throw new Error("Account not found.");
      if (state === "on" && !canForceOn(key)) throw new Error("This one can only be turned off. Its checks protect buyers and are required by law.");
      s.features = s.features ?? {};
      const mine = (s.features[uid] = s.features[uid] ?? {});
      const label = key.replace("_", " ");
      if (state === "auto") {
        if (!mine[key]) return;
        delete mine[key];
      } else {
        if (!reason?.trim()) throw new Error("Add a reason so the team knows why.");
        mine[key] = { state, reason: reason.trim(), at: now().toISOString(), by: me().handle ?? "team" };
        if (state === "off") notify(uid, `${label[0].toUpperCase() + label.slice(1)} is turned off for your account`, "Email help@myhaul.co.za if you think this is a mistake.");
      }
      logTeam(`${label[0].toUpperCase() + label.slice(1)}: ${state === "auto" ? "back to normal rules" : state === "on" ? "turned on" : "turned off"}`, "user", uid, reason?.trim() || null);
      save();
    },
    async myFeatures() {
      const mine = s.currentUserId ? s.features?.[s.currentUserId] ?? {} : {};
      return Object.fromEntries(Object.entries(mine).map(([k, v]) => [k, v!.state]));
    },
    async mySuspension() {
      const x = s.currentUserId ? s.suspensions?.[s.currentUserId] : undefined;
      return x ? { reason: x.reason, at: x.at } : null;
    },

    async isAdmin() {
      return !!s.users.find((u) => u.id === s.currentUserId)?.admin;
    },
    async pendingReviews() {
      const out: PendingReview[] = [];
      for (const sh of s.shops) {
        if (sh.checks.idStatus === "pending") out.push({ shopId: sh.id, shopName: sh.name, what: "id", files: [] });
        if (sh.checks.certStatus === "pending") out.push({ shopId: sh.id, shopName: sh.name, what: "cert", files: [] });
      }
      return out;
    },
    async adminReview(shopId, what, approved) {
      if (!(await api.isAdmin())) throw new Error("Admins only");
      const sh = shopOf(shopId);
      const st: ReviewStatus = approved ? "approved" : "rejected";
      if (what === "id") { if (approved && sh.checks.idStatus !== "approved") trust(sh.ownerId, "verified"); sh.checks.idStatus = st; }
      else sh.checks.certStatus = st;
      logTeam(`${approved ? "Approved" : "Rejected"} ${what === "id" ? "ID check" : "food certificate"}`, "shop", sh.id);
      notify(sh.ownerId, approved ? "Check approved" : "Check needs attention", approved ? `Your ${what === "id" ? "ID" : "certificate"} check is approved.` : `Please upload your ${what === "id" ? "ID" : "certificate"} again.`, "/me?tab=selling");
      save();
    },
    async disputedOrders() {
      return s.orders.filter((o) => o.status === "return_requested");
    },
    async decideReturn(oid, uphold) {
      if (!(await api.isAdmin())) throw new Error("Admins only.");
      const o = s.orders.find((x) => x.id === oid);
      if (!o || o.status !== "return_requested" || !o.ret) throw new Error("No open return.");
      if (uphold) { trust(o.shopOwnerId, o.ret.reason === "faulty" ? "flaw_not_shown" : "not_as_described"); o.ret.status = "in_transit"; setStatus(o, "return_in_transit"); }
      else { trust(o.buyerId, "return_claim_rejected"); o.ret.status = "rejected"; setStatus(o, "completed"); }
      logTeam(uphold ? "Return: buyer is right" : "Return: seller is right", "order", o.id, o.ret.reason);
      save();
    },

    async topUpsDue() {
      return s.payouts.filter((p) => p.topUpCents > 0 && !p.topUpPaid).map((p) => {
        const sh = shopOf(p.shopId);
        const o = s.orders.find((x) => x.id === p.orderId); const buyer = o && s.users.find((u) => u.id === o.buyerId);
        const flags: string[] = [];
        if (o && buyer?.createdAt && new Date(o.createdAt).getTime() - new Date(buyer.createdAt).getTime() < 48 * 3600e3) flags.push("Buyer account under 2 days old");
        if (o && (o.delivery === "collect_cpt" || o.delivery === "collect_baker")) flags.push("Collected in person (no courier proof)");
        if (o && o.status !== "completed") flags.push("Order not finished yet");
        return { payoutId: p.id, shopName: sh.name, bank: `${sh.checks.bankName} ending ${sh.checks.bankLast4}`, amountCents: p.topUpCents, payOn: p.payOn,
          buyer: buyer?.handle ?? buyer?.displayName, buyerId: buyer?.id, sellerId: sh.ownerId, flags };
      });
    },
    async markTopUpPaid(payoutId) {
      if (!(await api.isAdmin())) throw new Error("Admins only");
      const p = s.payouts.find((x) => x.id === payoutId);
      if (p && !p.topUpPaid) { p.topUpPaid = true; logTeam("Marked top up paid", "payout", p.id, `R${Math.round(p.topUpCents / 100)}`); }
      save();
    },

    demo: {
      async markDelivered(oid) {
        const o = s.orders.find((x) => x.id === oid);
        if (!o) return;
        if (o.status === "paid") { o.trackingRef = o.trackingRef ?? "DEMO123"; setStatus(o, "shipped"); }
        if (o.status === "shipped") setStatus(o, "delivered");
        save();
      },
      async skipDays(days) {
        s.clockOffsetMs += days * 86400e3;
        runDue();
        save();
      },
      async reset() {
        s = seed();
        save();
        listeners.forEach((l) => l(null));
      },
    },
  };
  return api;
}

// Demo adapter: the whole app runs in the browser with sample data, using the same rules as the server.
// Used when no Supabase keys are set. Sign in with any email or phone and the code 123456.
import {
  canTransition, orderTotals, payoutDate, releasableAt, returnReasonsFor, shipBy, tierFor, TRUST_POINTS, validateListing,
  RETURN_POSTAGE_PAYER, type OrderStatus, type TrustEventKind,
} from "@app/core";
import type {
  Api, Category, CheckoutInput, FeedItem, ListingInput, MyShop, Notification, Order, Payout, PendingReview, ProductPublic, ReviewStatus,
  ShopPublic, User,
} from "./types";

interface DShop {
  id: string; ownerId: string; name: string; handle: string; category: Category; bio: string;
  status: MyShop["status"]; foundingUntil: string | null;
  checks: MyShop["checks"];
}
interface DProduct extends ProductPublic { shopId: string; proofStatus: ReviewStatus }
interface DPost { id: string; shopId: string; productId: string; caption: string; video: FeedItem["video"]; createdAt: string }
interface DOrder extends Order { shopOwnerId: string }
interface DUser extends User { trust: number; welcomeUsed: boolean; admin: boolean; createdAt?: string; bio?: string }
type DPayout = Payout & { shopId: string; topUpCents: number; topUpPaid: boolean };
interface State {
  users: DUser[]; currentUserId: string | null; shops: DShop[]; products: DProduct[]; posts: DPost[]; orders: DOrder[];
  notifications: (Notification & { userId: string })[]; payouts: DPayout[]; clockOffsetMs: number;
  follows: { userId: string; shopId: string }[];
  reactions?: { userId: string; postId: string; kind: "like" | "repost"; at: string }[];
}

const KEY = "lsa-demo-v2";
const CODE = "123456";
const id = () => crypto.randomUUID();
const approvedChecks = (): MyShop["checks"] => ({
  phone: "0820000000", idStatus: "approved", bankStatus: "approved", bankName: "Capitec", bankLast4: "1234", certStatus: "approved", rulesAccepted: true,
});

function seed(): State {
  const bots: DUser[] = [
    { id: "u-lebo", displayName: "Lebo", trust: 78, welcomeUsed: true, admin: false },
    { id: "u-luxe", displayName: "Kamva", trust: 92, welcomeUsed: true, admin: false },
    { id: "u-sweet", displayName: "Ayesha", trust: 66, welcomeUsed: true, admin: false },
  ];
  const shops: DShop[] = [
    { id: "s-lebo", ownerId: "u-lebo", name: "Lebo's Thrift", handle: "thrift.with.lebo", category: "clothes", bio: "Thrift and new basics. Cape Town.", status: "open", foundingUntil: null, checks: approvedChecks() },
    { id: "s-luxe", ownerId: "u-luxe", name: "Luxe Resale CT", handle: "luxe.resale.ct", category: "designer", bio: "Checked designer pre loved.", status: "open", foundingUntil: null, checks: approvedChecks() },
    { id: "s-sweet", ownerId: "u-sweet", name: "Sweet Crumbs", handle: "sweetcrumbs.ct", category: "food", bio: "Celebration cakes, Gardens.", status: "open", foundingUntil: null, checks: approvedChecks() },
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
    p({ id: "p-cake", shopId: "s-sweet", title: "Celebration cake, 20 cm", priceCents: 65000, mode: "order_now", leadDays: 2, stock: 99, allergens: "Gluten, eggs, dairy", description: "Vanilla, chocolate or red velvet. Add a message." }),
  ];
  const v = (bg: string, label: string, scene?: string) => ({ demo: { bg, label, scene } });
  const now = Date.now();
  const posts: DPost[] = [
    { id: "po-1", shopId: "s-lebo", productId: "p-tee", caption: "3 ways to style one oversized tee for summer", video: v("#5b4636", "Seller video: styling the tee", "tee"), createdAt: new Date(now - 3600e3).toISOString() },
    { id: "po-2", shopId: "s-luxe", productId: "p-shirt", caption: "Silk shirt, worn twice. Receipt checked.", video: v("#2f3a4a", "Seller video: shirt close up", "shirt"), createdAt: new Date(now - 7200e3).toISOString() },
    { id: "po-3", shopId: "s-sweet", productId: "p-cake", caption: "Decorating a celebration cake", video: v("#6b4a4a", "Seller video: decorating a cake", "cake"), createdAt: new Date(now - 9000e3).toISOString() },
    { id: "po-4", shopId: "s-lebo", productId: "p-denim", caption: "Real denim, every mark on camera", video: v("#34495e", "Seller video: denim jacket", "denim"), createdAt: new Date(now - 12000e3).toISOString() },
    { id: "po-5", shopId: "s-lebo", productId: "p-runner", caption: "Chunky runner, no logos", video: v("#4a4a3a", "Seller video: runners", "runner"), createdAt: new Date(now - 15000e3).toISOString() },
  ];
  return { users: bots, currentUserId: null, shops, products, posts, orders: [], notifications: [], payouts: [], clockOffsetMs: 0, follows: [] };
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...seed(), ...JSON.parse(raw) };
  } catch { /* storage blocked: start fresh */ }
  return seed();
}

export function createDemoApi(): Api {
  let s = load();
  const listeners = new Set<(u: User | null) => void>();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  };
  const now = () => new Date(Date.now() + s.clockOffsetMs);
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

  function setStatus(o: DOrder, to: OrderStatus) {
    if (!canTransition(o.status, to)) throw new Error(`Order cannot go from ${o.status} to ${to}`);
    const t = now();
    const title = o.product.title;
    if (to === "paid") {
      o.paidAt = t.toISOString();
      o.shipBy = shipBy(t).toISOString();
      const p = s.products.find((x) => x.id === o.product.id)!;
      if (p.mode !== "order_now") { p.stock = Math.max(0, p.stock - 1); if (p.stock === 0) p.status = "sold_out"; }
      if (o.totals.creditUsed > 0) s.users.find((u) => u.id === o.buyerId)!.welcomeUsed = true;
      notify(o.shopOwnerId, `New order: ${title}`, "Ship within 2 days. The money is held safely until the return window closes.", `/sell/orders/${o.id}`);
      notify(o.buyerId, "Payment received", `Your money is held safely. We will tell you when ${title} ships.`, `/orders/${o.id}`);
    }
    if (to === "shipped") { o.shippedAt = t.toISOString(); notify(o.buyerId, `On the way: ${title}`, o.trackingRef ? `Tracking: ${o.trackingRef}` : "The seller has sent your order.", `/orders/${o.id}`); }
    if (to === "delivered") {
      o.deliveredAt = t.toISOString();
      o.releasableAt = releasableAt(o.mode, t).toISOString();
      notify(o.buyerId, `Delivered: ${title}`, o.mode === "buy_now" ? "You have 7 days to return it if you change your mind." : "Tell us within the check period if something is wrong.", `/orders/${o.id}`);
    }
    if (to === "completed") { trust(o.shopOwnerId, "order_kept"); schedulePayout(o); }
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

  /** Same jobs as the run-due server function. */
  function runDue() {
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
    return { postId: po.id, caption: po.caption, product: p, shop: publicShop(shopOf(po.shopId)), video: po.video };
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
      let u = s.users.find((x) => x.email === key || x.phone === key);
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
      await wait(150);
      runDue();
      const sales = (shopId: string) => s.orders.filter((o) => o.shop.id === shopId && !["pending_payment", "cancelled", "refunded"].includes(o.status)).length;
      const bonus = (shopId: string) => ({ top: 10, trusted: 5, standard: 0, restricted: 0 })[tierFor(ownerOf(shopId).trust)];
      const rank = (po: DPost) => 3 * sales(po.shopId) + bonus(po.shopId) - (now().getTime() - new Date(po.createdAt).getTime()) / 86400e3;
      return s.posts.filter(visible).sort((a, b) => rank(b) - rank(a)).slice(offset, offset + 20).map(toFeed);
    },
    async shop(handle) {
      const sh = s.shops.find((x) => x.handle === handle && x.status === "open");
      if (!sh) return null;
      return { shop: publicShop(sh), items: s.posts.filter((p) => p.shopId === sh.id && visible(p)).map(toFeed) };
    },
    async checkout(input: CheckoutInput) {
      await wait();
      const u = me();
      const p = s.products.find((x) => x.id === input.productId);
      if (!p || p.status !== "live") throw new Error("This item is no longer available.");
      const sh = shopOf(p.shopId);
      if (sh.ownerId === u.id) throw new Error("You cannot buy your own item.");
      if (p.sizes.length && !p.sizes.includes(input.size ?? "")) throw new Error("Pick a size.");
      if (input.delivery === "pudo_locker" && !input.deliveryDetails.locker) throw new Error("Pick a PUDO locker.");
      if (input.delivery === "courier" && !(input.deliveryDetails.address && input.deliveryDetails.name && input.deliveryDetails.phone))
        throw new Error("Add your name, phone and address for the courier.");
      if (p.mode === "order_now" && (!input.foodDate || !input.foodSlot)) throw new Error("Pick a date and time slot.");
      const paidBefore = s.orders.some((o) => o.buyerId === u.id && !["pending_payment", "cancelled"].includes(o.status));
      const totals = orderTotals({ itemPrice: p.priceCents, delivery: input.delivery, welcomeCreditAvailable: !u.welcomeUsed && !paidBefore,
        foundingUntil: sh.foundingUntil ? new Date(sh.foundingUntil) : null, at: now() });
      const oid = id();
      const o: DOrder = {
        id: oid, status: "pending_payment", mode: p.mode, product: { id: p.id, title: p.title }, shop: { id: sh.id, name: sh.name, handle: sh.handle },
        buyerId: u.id, shopOwnerId: sh.ownerId, size: input.size ?? null, delivery: input.delivery, deliveryDetails: input.deliveryDetails as Record<string, string>,
        foodDate: input.foodDate ?? null, foodSlot: input.foodSlot ?? null, totals, checkoutUrl: `/mock-pay/${oid}`, trackingRef: null,
        paidAt: null, shipBy: null, shippedAt: null, deliveredAt: null, releasableAt: null, createdAt: now().toISOString(), ret: null, review: null,
      };
      s.orders.unshift(o);
      save();
      return { orderId: oid, checkoutUrl: o.checkoutUrl!, totals };
    },
    async mockPay(orderId) {
      await wait(400);
      const o = s.orders.find((x) => x.id === orderId && x.buyerId === me().id);
      if (!o || o.status !== "pending_payment") throw new Error("Nothing to pay.");
      setStatus(o, "paid");
      save();
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
      return s.notifications.filter((n) => n.userId === u.id);
    },
    async markAllRead() {
      const u = me();
      s.notifications.forEach((n) => { if (n.userId === u.id && !n.readAt) n.readAt = now().toISOString(); });
      save();
    },
    async myProfile() {
      const u = me();
      return {
        id: u.id, displayName: u.displayName, bio: u.bio ?? "", email: u.email, trustScore: u.trust, createdAt: u.createdAt ?? now().toISOString(),
        ordersCount: s.orders.filter((o) => o.buyerId === u.id && !["pending_payment", "cancelled"].includes(o.status)).length,
      };
    },
    async updateProfile(displayName, bio) {
      me().displayName = displayName.trim();
      me().bio = bio.trim().slice(0, 150);
      save();
      listeners.forEach((l) => l(me()));
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
    async reactedPosts(kind) {
      const u = me();
      return (s.reactions ?? []).filter((r) => r.userId === u.id && r.kind === kind)
        .map((r) => s.posts.find((po) => po.id === r.postId)).filter((po): po is DPost => !!po && visible(po)).map(toFeed);
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
      return !u.welcomeUsed && !s.orders.some((o) => o.buyerId === u.id && !["pending_payment", "cancelled"].includes(o.status));
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
      if (!/^[a-z0-9._]{3,30}$/.test(h)) throw new Error("Use 3 to 30 letters, numbers, dots or underscores.");
      if (s.shops.some((x) => x.handle === h && x.ownerId !== u.id)) throw new Error("That shop name is taken.");
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
    async createListing(input: ListingInput, video, proof, onProgress) {
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
      const pid = id();
      s.products.push({
        id: pid, shopId: sh.id, title: input.title, description: input.description, priceCents: input.priceCents, mode: input.mode, label: input.label,
        condition: input.condition, sizes: input.sizes, stock: input.stock, leadDays: input.leadDays, allergens: input.allergens,
        status: live ? "live" : "draft", proofStatus: proof ? "pending" : "not_started",
      });
      if (video && sh.status === "open") {
        s.posts.unshift({ id: id(), shopId: sh.id, productId: pid, caption: input.caption, createdAt: now().toISOString(),
          video: { url: URL.createObjectURL(video), demo: { bg: "#3f3f46", label: "Your video (this browser only)" } } });
      }
      save();
      return { live, message };
    },
    async sellerOrders() {
      runDue();
      const sh = myShopRow();
      return sh ? s.orders.filter((o) => o.shop.id === sh.id && o.status !== "pending_payment") : [];
    },
    async shipOrder(oid, trackingRef, packingVideo) {
      const o = s.orders.find((x) => x.id === oid && x.shopOwnerId === me().id);
      if (!o || o.status !== "paid") throw new Error("Only paid orders can be shipped.");
      if ((o.delivery === "courier" || o.delivery === "pudo_locker") && !trackingRef) throw new Error("Add the tracking number.");
      o.trackingRef = trackingRef || null;
      setStatus(o, "shipped");
      if (packingVideo && o.paidAt && now().getTime() - new Date(o.paidAt).getTime() <= 48 * 3600e3) trust(o.shopOwnerId, "fast_ship_with_video");
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
      save();
    },

    async topUpsDue() {
      return s.payouts.filter((p) => p.topUpCents > 0 && !p.topUpPaid).map((p) => {
        const sh = shopOf(p.shopId);
        return { payoutId: p.id, shopName: sh.name, bank: `${sh.checks.bankName} ending ${sh.checks.bankLast4}`, amountCents: p.topUpCents, payOn: p.payOn };
      });
    },
    async markTopUpPaid(payoutId) {
      if (!(await api.isAdmin())) throw new Error("Admins only");
      const p = s.payouts.find((x) => x.id === payoutId);
      if (p) p.topUpPaid = true;
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

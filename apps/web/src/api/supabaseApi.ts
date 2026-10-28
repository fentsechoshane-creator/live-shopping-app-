// Live adapter: talks to Supabase (database, auth, storage) and our server functions.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateListing } from "@app/core";
import type {
  MyProfile, ShopPublic,
  Api, BankInput, Category, CheckoutInput, FeedItem, ListingInput, MyShop, Notification, Order, Payout, PendingReview,
  ProductPublic, User,
} from "./types";

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey);

  const toUser = (u: any): User => ({ id: u.id, email: u.email, phone: u.phone, displayName: u.user_metadata?.display_name ?? "" });

  async function uid(): Promise<string> {
    const { data } = await sb.auth.getUser();
    if (!data.user) throw new Error("Please sign in.");
    return data.user.id;
  }

  /** Throws the database message, which our rules write in plain English. */
  function check<T>(res: { data: T; error: { message: string } | null }): T {
    if (res.error) throw new Error(cleanError(res.error.message));
    return res.data;
  }

  async function call<T = any>(fn: string, body: Record<string, any>): Promise<T> {
    const { data, error } = await sb.functions.invoke(fn, { body });
    if (error) {
      let msg = "Something went wrong. Please try again.";
      try {
        const j = await (error as any).context?.json?.();
        if (j?.error) msg = j.error;
      } catch { /* keep default */ }
      throw new Error(msg);
    }
    return data as T;
  }

  const videoUrl = (path: string | null) => (path ? sb.storage.from("videos").getPublicUrl(path).data.publicUrl : null);

  const toProduct = (p: any): ProductPublic => ({
    id: p.id, title: p.title, description: p.description ?? "", priceCents: p.price_cents, mode: p.mode, label: p.label,
    condition: p.condition, sizes: p.sizes ?? [], stock: p.stock, leadDays: p.lead_days, allergens: p.allergens, status: p.status ?? "live",
  });

  const ORDER_SELECT = "*, products(id, title), shops(id, name, handle), returns(*), reviews(stars)";
  const toOrder = (o: any): Order => ({
    id: o.id, status: o.status, mode: o.mode, buyerId: o.buyer_id,
    product: { id: o.products?.id, title: o.products?.title ?? "Item" },
    shop: { id: o.shops?.id, name: o.shops?.name ?? "", handle: o.shops?.handle ?? "" },
    size: o.size, delivery: o.delivery, deliveryDetails: o.delivery_details ?? {}, foodDate: o.food_date, foodSlot: o.food_slot,
    totals: {
      itemPrice: o.item_price_cents, deliveryFee: o.delivery_fee_cents, protectionFee: o.protection_fee_cents,
      creditUsed: o.credit_cents, total: o.total_cents, sellerFee: o.seller_fee_cents, sellerPayout: o.seller_payout_cents,
      creditTopUp: o.credit_topup_cents ?? 0,
    },
    checkoutUrl: o.checkout_url, trackingRef: o.tracking_ref, paidAt: o.paid_at, shipBy: o.ship_by, shippedAt: o.shipped_at,
    deliveredAt: o.delivered_at, releasableAt: o.releasable_at, createdAt: o.created_at,
    ret: o.returns ? { reason: o.returns.reason, details: o.returns.details, status: o.returns.status, postagePayer: o.returns.postage_payer } : null,
    review: o.reviews ? { stars: o.reviews.stars } : null,
  });

  async function upload(bucket: "videos" | "private", file: File, prefix: string): Promise<string> {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${await uid()}/${prefix}-${crypto.randomUUID()}.${ext}`;
    check(await sb.storage.from(bucket).upload(path, file, { contentType: file.type || undefined, upsert: false }));
    return path;
  }

  function putWithProgress(url: string, file: File, onProgress?: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("Video upload failed.")));
      xhr.onerror = () => reject(new Error("Video upload failed. Check your connection."));
      xhr.send(file);
    });
  }

  async function myShopId(): Promise<string | null> {
    const { data } = await sb.rpc("my_shop_id");
    return (data as string | null) ?? null;
  }

  const api: Api = {
    mode: "live",

    async currentUser() {
      const { data } = await sb.auth.getUser();
      return data.user ? toUser(data.user) : null;
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, s) => cb(s?.user ? toUser(s.user) : null));
      return () => data.subscription.unsubscribe();
    },
    async sendCode(contact) {
      const res = contact.includes("@")
        ? await sb.auth.signInWithOtp({ email: contact.trim(), options: { shouldCreateUser: true } })
        : await sb.auth.signInWithOtp({ phone: toE164(contact) });
      if (res.error) throw new Error(res.error.message);
    },
    async verifyCode(contact, code) {
      const res = contact.includes("@")
        ? await sb.auth.verifyOtp({ email: contact.trim(), token: code.trim(), type: "email" })
        : await sb.auth.verifyOtp({ phone: toE164(contact), token: code.trim(), type: "sms" });
      if (res.error || !res.data.user) throw new Error(res.error?.message ?? "That code did not work.");
      return toUser(res.data.user);
    },
    async signOut() {
      await sb.auth.signOut();
    },

    async feed(offset = 0) {
      const rows = check(await sb.rpc("feed", { p_limit: 20, p_offset: offset })) as any[];
      return rows.map((r): FeedItem => ({
        postId: r.post_id, caption: r.caption,
        product: toProduct({ ...r, id: r.product_id, status: "live" }),
        shop: { id: r.shop_id, name: r.shop_name, handle: r.shop_handle, category: r.category, trustScore: r.trust_score, tier: r.tier },
        video: { muxPlaybackId: r.playback_id, url: videoUrl(r.storage_path) },
      }));
    },
    async shop(handle) {
      const rows = check(await sb.rpc("shop_public", { p_handle: handle })) as any[];
      const s = rows[0];
      if (!s) return null;
      const shop = {
        id: s.shop_id, name: s.name, handle: s.handle, category: s.category as Category, bio: s.bio, trustScore: s.trust_score,
        tier: s.tier, sales: s.sales, followers: s.followers, founding: s.founding,
      };
      const posts = check(await sb.from("posts").select("id, caption, products!inner(*), media(mux_playback_id, storage_path, status)")
        .eq("shop_id", s.shop_id).eq("status", "live").eq("products.status", "live").order("created_at", { ascending: false })) as any[];
      return {
        shop,
        items: posts.filter((p) => p.media?.status === "ready").map((p) => ({
          postId: p.id, caption: p.caption, product: toProduct(p.products), shop,
          video: { muxPlaybackId: p.media.mux_playback_id, url: videoUrl(p.media.storage_path) },
        })),
      };
    },
    async checkout(input: CheckoutInput) {
      return call("checkout", input as unknown as Record<string, any>);
    },
    async mockPay(orderId) {
      await call("order-action", { orderId, action: "mock_pay" });
    },
    async myOrders() {
      const me = await uid();
      return (check(await sb.from("orders").select(ORDER_SELECT).eq("buyer_id", me).order("created_at", { ascending: false })) as any[]).map(toOrder);
    },
    async order(id) {
      const { data } = await sb.from("orders").select(ORDER_SELECT).eq("id", id).maybeSingle();
      return data ? toOrder(data) : null;
    },
    async cancelUnpaid(id) {
      await call("order-action", { orderId: id, action: "cancel_unpaid" });
    },
    async confirmReceived(id) {
      check(await sb.rpc("confirm_received", { p_order: id }));
    },
    async requestReturn(id, reason, details) {
      check(await sb.rpc("request_return", { p_order: id, p_reason: reason, p_details: details }));
    },
    async leaveReview(id, stars, body) {
      check(await sb.rpc("leave_review", { p_order: id, p_stars: stars, p_body: body }));
    },
    async notifications() {
      const rows = check(await sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(50)) as any[];
      return rows.map((n): Notification => ({ id: String(n.id), title: n.title, body: n.body, link: n.link, readAt: n.read_at, createdAt: n.created_at }));
    },
    async markAllRead() {
      check(await sb.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null));
    },
    async myProfile(): Promise<MyProfile> {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error("Please sign in.");
      const { data: p } = await sb.from("profiles").select("display_name, trust_score, created_at").eq("id", u.user.id).single();
      const { count } = await sb.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", u.user.id)
        .not("status", "in", "(pending_payment,cancelled)");
      return {
        id: u.user.id, displayName: p?.display_name || u.user.email?.split("@")[0] || "", email: u.user.email,
        trustScore: p?.trust_score ?? 50, createdAt: p?.created_at ?? u.user.created_at, ordersCount: count ?? 0,
      };
    },
    async updateProfile(displayName) {
      check(await sb.from("profiles").update({ display_name: displayName.trim() }).eq("id", await uid()));
    },
    async following() {
      const rows = check(await sb.from("follows").select("shops(id, name, handle, category)").eq("user_id", await uid())) as any[];
      return rows.filter((r) => r.shops).map((r): ShopPublic => ({
        id: r.shops.id, name: r.shops.name, handle: r.shops.handle, category: r.shops.category, trustScore: 50, tier: "standard",
      }));
    },
    async follow(shopId) {
      const res = await sb.from("follows").insert({ user_id: await uid(), shop_id: shopId });
      if (res.error && !res.error.message.includes("duplicate")) throw new Error(res.error.message);
    },
    async unfollow(shopId) {
      check(await sb.from("follows").delete().eq("user_id", await uid()).eq("shop_id", shopId));
    },
    async welcomeCreditAvailable() {
      const me = await uid();
      const { data } = await sb.from("profiles").select("welcome_credit_used").eq("id", me).single();
      const { count } = await sb.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", me)
        .not("status", "in", "(pending_payment,cancelled)");
      return !data?.welcome_credit_used && (count ?? 0) === 0;
    },

    async myShop() {
      const me = await uid();
      const { data: s } = await sb.from("shops").select("*, seller_checks(*), products(*), posts(product_id)").eq("owner_id", me).maybeSingle();
      if (!s) return null;
      const { data: prof } = await sb.from("profiles").select("trust_score").eq("id", me).single();
      const { data: good } = await sb.rpc("good_orders", { p_shop: s.id });
      const c = s.seller_checks ?? {};
      const posted = new Set((s.posts ?? []).map((p: any) => p.product_id));
      const shop: MyShop = {
        id: s.id, name: s.name, handle: s.handle, category: s.category, status: s.status, foundingUntil: s.founding_until,
        trustScore: prof?.trust_score ?? 50, goodOrders: (good as number) ?? 0,
        checks: {
          phone: c.phone ?? null, idStatus: c.id_status ?? "not_started", bankStatus: c.bank_status ?? "not_started",
          bankName: c.bank_name ?? null, bankLast4: c.bank_last4 ?? null, certStatus: c.cert_status ?? "not_started",
          rulesAccepted: !!c.rules_accepted_at,
        },
        products: (s.products ?? []).filter((p: any) => p.status !== "removed")
          .map((p: any) => ({ ...toProduct(p), proofStatus: p.proof_status, posted: posted.has(p.id) })),
      };
      return shop;
    },
    async startShop(name, handle, category) {
      check(await sb.rpc("start_shop", { p_name: name, p_handle: handle, p_category: category }));
    },
    async submitId(phone, idDoc, selfie) {
      const a = await upload("private", idDoc, "id");
      const b = await upload("private", selfie, "selfie");
      check(await sb.rpc("submit_id", { p_phone: phone, p_id_doc_path: a, p_selfie_path: b }));
    },
    async addBank(input: BankInput) {
      await call("seller-bank", input as unknown as Record<string, any>);
    },
    async submitFoodCert(file) {
      const p = await upload("private", file, "certificate");
      check(await sb.rpc("submit_food_cert", { p_path: p }));
    },
    async acceptRules() {
      check(await sb.rpc("accept_seller_rules"));
    },
    async openShop() {
      check(await sb.rpc("open_shop"));
    },
    async createListing(input: ListingInput, video, proof, onProgress) {
      const errors = validateListing({ title: input.title, description: input.description, price: input.priceCents, label: input.label,
        condition: input.condition ?? undefined, hasProof: !!proof, mode: input.mode });
      if (errors.length) throw new Error(errors[0]);
      const shopId = await myShopId();
      if (!shopId) throw new Error("Start your shop first.");
      const row = {
        shop_id: shopId, title: input.title, description: input.description, price_cents: input.priceCents, mode: input.mode,
        label: input.label, condition: input.condition, sizes: input.sizes, stock: input.stock, lead_days: input.leadDays, allergens: input.allergens,
      };
      // Try to go live. If a rule blocks it (for example, checks not done yet), save as a draft and say why.
      let live = true;
      let message: string | undefined;
      let res = await sb.from("products").insert({ ...row, status: "live" }).select("id").single();
      if (res.error) {
        live = false;
        message = cleanError(res.error.message);
        res = await sb.from("products").insert({ ...row, status: "draft" }).select("id").single();
      }
      const productId = (check(res as any) as any).id as string;
      if (proof && input.label === "authentic_designer") {
        const p = await upload("private", proof, "proof");
        check(await sb.rpc("submit_designer_proof", { p_product: productId, p_path: p }));
        live = false;
        message = "We check the proof before designer items go live. This usually takes a day.";
      }
      if (video) {
        let mediaId: string;
        const up = await call<{ useStorage?: boolean; mediaId?: string; uploadUrl?: string }>("mux-upload", {});
        if (up.useStorage) {
          const path = await upload("videos", video, "clip");
          onProgress?.(100);
          mediaId = (check(await sb.from("media").insert({ owner_id: await uid(), kind: "video", storage_path: path, status: "ready" }).select("id").single()) as any).id;
        } else {
          await putWithProgress(up.uploadUrl!, video, onProgress);
          mediaId = up.mediaId!;
        }
        const posted = await sb.from("posts").insert({ shop_id: shopId, product_id: productId, media_id: mediaId, caption: input.caption });
        if (posted.error && live) message = "Saved. Your video posts once your shop is open.";
      }
      return { live, message };
    },
    async sellerOrders() {
      const shopId = await myShopId();
      if (!shopId) return [];
      return (check(await sb.from("orders").select(ORDER_SELECT).eq("shop_id", shopId).neq("status", "pending_payment")
        .order("created_at", { ascending: false })) as any[]).map(toOrder);
    },
    async shipOrder(id, trackingRef, packingVideo) {
      let packingMediaId: string | null = null;
      if (packingVideo) {
        const path = await upload("private", packingVideo, "packing");
        packingMediaId = (check(await sb.from("media").insert({ owner_id: await uid(), kind: "video", storage_path: path, status: "ready" }).select("id").single()) as any).id;
      }
      await call("order-action", { orderId: id, action: "ship", trackingRef: trackingRef || null, packingMediaId });
    },
    async acceptReturn(id) {
      await call("order-action", { orderId: id, action: "accept_return" });
    },
    async returnReceived(id) {
      await call("order-action", { orderId: id, action: "return_received" });
    },
    async disputeReturn(id) {
      await call("order-action", { orderId: id, action: "dispute_return" });
    },
    async payouts() {
      const rows = check(await sb.from("payouts").select("*").order("created_at", { ascending: false })) as any[];
      return rows.map((p): Payout => ({ id: p.id, orderId: p.order_id, amountCents: p.amount_cents, payOn: p.pay_on, status: p.status, releasableAt: p.releasable_at }));
    },

    async isAdmin() {
      const { data } = await sb.rpc("is_admin");
      return !!data;
    },
    async pendingReviews() {
      const rows = check(await sb.from("seller_checks").select("*, shops(name)").or("id_status.eq.pending,cert_status.eq.pending")) as any[];
      const signed = async (p: string | null) => (p ? (await sb.storage.from("private").createSignedUrl(p, 600)).data?.signedUrl ?? "" : "");
      const out: PendingReview[] = [];
      for (const r of rows) {
        if (r.id_status === "pending")
          out.push({ shopId: r.shop_id, shopName: r.shops?.name, what: "id", files: [
            { label: "ID document", url: await signed(r.id_doc_path) }, { label: "Selfie", url: await signed(r.selfie_path) }] });
        if (r.cert_status === "pending")
          out.push({ shopId: r.shop_id, shopName: r.shops?.name, what: "cert", files: [{ label: "Certificate", url: await signed(r.cert_path) }] });
      }
      return out;
    },
    async adminReview(shopId, what, approved) {
      check(await sb.rpc("admin_review", { p_shop: shopId, p_what: what, p_approved: approved, p_note: null }));
    },
    async disputedOrders() {
      return (check(await sb.from("orders").select(ORDER_SELECT).eq("status", "return_requested").order("created_at")) as any[]).map(toOrder);
    },
    async decideReturn(orderId, uphold) {
      await call("order-action", { orderId, action: "decide_return", uphold });
    },
    async topUpsDue() {
      const rows = check(await sb.from("payouts").select("id, topup_cents, pay_on, shops(name, seller_checks(bank_name, bank_last4))")
        .gt("topup_cents", 0).is("topup_paid_at", null).neq("status", "cancelled").order("pay_on")) as any[];
      return rows.map((r) => ({
        payoutId: r.id, shopName: r.shops?.name ?? "", amountCents: r.topup_cents, payOn: r.pay_on,
        bank: r.shops?.seller_checks ? `${r.shops.seller_checks.bank_name} ending ${r.shops.seller_checks.bank_last4}` : "",
      }));
    },
    async markTopUpPaid(payoutId) {
      check(await sb.rpc("admin_mark_topup_paid", { p_payout: payoutId }));
    },
  };
  return api;
}

/** 082 123 4567 -> +27821234567 */
function toE164(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("27")) return "+" + d;
  if (d.startsWith("0")) return "+27" + d.slice(1);
  return "+" + d;
}

/** Postgres errors arrive with technical prefixes. Keep the readable part. */
function cleanError(msg: string): string {
  return msg.replace(/^.*?ERROR:\s*/, "").replace(/\s*CONTEXT:.*$/s, "");
}


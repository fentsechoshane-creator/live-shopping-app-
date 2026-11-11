// Live adapter: talks to Supabase (database, auth, storage) and our server functions.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateListing } from "@app/core";
import type {
  ListingSuggestion, SellerStats, Conversation, OpenReport, SharedPost,
  MyProfile, ShopPublic,
  Api, BankInput, Category, CheckoutInput, FeedItem, ListingInput, MyShop, Notification, Order, Payout, PendingReview, SellerCharge,
  ProductPublic, User, TeamPerson, TeamPersonDetail, Reward, LiveShow, LiveChatMessage, LiveSummary,
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

  const isImage = (path: string | null) => !!path && /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(path);
  const avatarUrl = (path: string | null | undefined) => (path ? sb.storage.from("avatars").getPublicUrl(path).data.publicUrl : null);
  const videoUrl = (path: string | null) => (path ? sb.storage.from("videos").getPublicUrl(path).data.publicUrl : null);

  // The product fields anyone may read (0025 hides the auction reserve, proof file path and winner).
  const PRODUCT_COLS = "id, shop_id, title, description, price_cents, mode, label, condition, sizes, stock, lead_days, allergens, proof_status, status, created_at, held_for, held_until, auction_ends_at, auction_state, auction_round, auction_price_cents, auction_pay_by";
  const toProduct = (p: any): ProductPublic => ({
    id: p.id, title: p.title, description: p.description ?? "", priceCents: p.price_cents, mode: p.mode, label: p.label,
    condition: p.condition, sizes: p.sizes ?? [], stock: p.stock, leadDays: p.lead_days, allergens: p.allergens, status: p.status ?? "live",
    parcelSize: p.parcel_size ?? null,
  });

  const ORDER_SELECT = "*, products(id, title), shops(id, name, handle), returns(*), reviews(stars)";
  const toOrder = (o: any): Order => ({
    id: o.id, status: o.status, mode: o.mode, buyerId: o.buyer_id, paymentMethod: o.payment_method ?? null,
    product: { id: o.products?.id, title: o.products?.title ?? "Item" },
    shop: { id: o.shops?.id, name: o.shops?.name ?? "", handle: o.shops?.handle ?? "" },
    size: o.size, delivery: o.delivery, deliveryDetails: o.delivery_details ?? {}, foodDate: o.food_date, foodSlot: o.food_slot,
    totals: {
      itemPrice: o.item_price_cents, deliveryFee: o.delivery_fee_cents, protectionFee: o.protection_fee_cents,
      creditUsed: o.credit_cents, total: o.total_cents, sellerFee: o.seller_fee_cents, sellerPayout: o.seller_payout_cents, chargesTaken: o.charges_taken_cents ?? 0,
      creditTopUp: o.credit_topup_cents ?? 0, deliveryDiscount: o.delivery_discount_cents ?? 0,
    },
    checkoutUrl: o.checkout_url, trackingRef: o.tracking_ref, parcelSize: o.parcel_size ?? null, courierName: o.courier_name ?? null,
    hasLabel: !!o.shipment_id, pickupPoint: o.pickup_point ?? null, trackingStatus: o.tracking_status ?? null, packingCode: o.packing_code ?? null, paidAt: o.paid_at, shipBy: o.ship_by, shippedAt: o.shipped_at,
    deliveredAt: o.delivered_at, releasableAt: o.releasable_at, createdAt: o.created_at,
    ret: o.returns ? { reason: o.returns.reason, details: o.returns.details, status: o.returns.status, postagePayer: o.returns.postage_payer } : null,
    review: o.reviews ? { stars: o.reviews.stars } : null,
    cancelledBy: o.cancelled_by ?? null, cancelReason: o.cancel_reason ?? null, cancelRequestedAt: o.cancel_requested_at ?? null, bookingFailedAt: o.booking_failed_at ?? null,
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

  const toConversation = (r: any): Conversation => ({
    id: r.id, shopId: r.shop_id, shopName: r.shop_name, shopHandle: r.shop_handle, otherName: r.other_name, iAmSeller: r.i_am_seller,
    lastBody: r.last_body, lastAt: r.last_at, unread: r.unread, buyerId: r.buyer_id,
    otherAvatarUrl: avatarUrl(r.other_avatar), lastMine: !!r.last_mine,
  });
  /** The editor's clips and marks, ready for the player. Empty or missing means a plain one video post. */
  const playEdit = (edit: any, clips: any): FeedItem["edit"] => (edit && Array.isArray(clips) && clips.length ? {
    clips: clips.map((c: any) => ({ start: Number(c.start), end: Number(c.end), muted: !!c.muted, inApp: !!c.inApp,
      video: { muxPlaybackId: c.playbackId ?? null, url: videoUrl(c.path), kind: c.kind === "image" ? "image" : "video" } })),
    marks: Array.isArray(edit.marks) ? edit.marks : [], cover: Number(edit.cover) || 0,
  } : undefined);
  const feedItem = (r: any): FeedItem => ({
    postId: r.post_id, caption: r.caption, edit: playEdit(r.edit, r.clips),
    product: toProduct({ ...r, id: r.product_id, status: "live" }),
    shop: { id: r.shop_id, name: r.shop_name, handle: r.shop_handle, category: r.category, trustScore: r.trust_score, tier: r.tier },
    video: { muxPlaybackId: r.playback_id, url: videoUrl(r.storage_path), kind: isImage(r.storage_path) ? "image" : "video" },
  });

  /** Posts the public can see, by id (migration 0041). */
  const postsById = async (ids: string[]): Promise<Map<string, FeedItem>> => {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return new Map();
    const rows = (check(await sb.rpc("feed_posts", { p_ids: uniq })) as any[]) ?? [];
    return new Map(rows.map((r) => [r.post_id as string, feedItem(r)]));
  };

  // ===== Chats that update straight away (Supabase Realtime, migration 0041) =====
  // "typing…" travels as a broadcast on the chat's channel and lasts 4 seconds. Nothing is stored.
  const typingUntil = new Map<string, number>();
  const chatChannels = new Map<string, any>();
  let lastTypingSent = 0;
  let myId: string | null = null;
  sb.auth.getUser().then(({ data }) => { myId = data.user?.id ?? null; });
  sb.auth.onAuthStateChange((_e, sess) => { myId = sess?.user?.id ?? null; });

  // ===== Live selling helpers =====
  const liveShops = async (ids: string[]): Promise<Record<string, ShopPublic>> => {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return {};
    const rows = (check(await sb.from("shops").select("id, name, handle, category").in("id", uniq)) as any[]) ?? [];
    return Object.fromEntries(rows.map((r) => [r.id, { id: r.id, name: r.name, handle: r.handle, category: r.category, trustScore: 50, tier: "standard" } as ShopPublic]));
  };
  const toShow = (r: any, shop: ShopPublic, pinned: FeedItem | null, auction: FeedItem | null): LiveShow => ({
    id: r.id, title: r.title, status: r.status, startsAt: r.startsAt, startedAt: r.startedAt ?? null, endedAt: r.endedAt ?? null,
    shop, pinned, auction, peakViewers: Number(r.peakViewers ?? 0), reminded: !!r.reminded, reminders: Number(r.reminders ?? 0), mine: !!r.mine,
  });

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
        ? await sb.auth.signInWithOtp({ email: contact.trim(), options: { shouldCreateUser: true, emailRedirectTo: backHere() } })
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
      return rows.map(feedItem);
    },
    async shop(handle) {
      const rows = check(await sb.rpc("shop_public", { p_handle: handle })) as any[];
      const s = rows[0];
      if (!s) return null;
      const shop = {
        id: s.shop_id, name: s.name, handle: s.handle, category: s.category as Category, bio: s.bio, trustScore: s.trust_score,
        tier: s.tier, sales: s.sales, followers: s.followers, founding: s.founding,
      };
      const posts = check(await sb.from("posts").select(`id, caption, edit, clips, products!inner(${PRODUCT_COLS}), media(mux_playback_id, storage_path, status)`)
        .eq("shop_id", s.shop_id).eq("status", "live").eq("products.status", "live").order("created_at", { ascending: false })) as any[];
      return {
        shop,
        items: posts.filter((p) => p.media?.status === "ready").map((p) => ({
          postId: p.id, caption: p.caption, product: toProduct(p.products), shop, edit: playEdit(p.edit, p.clips),
          video: { muxPlaybackId: p.media.mux_playback_id, url: videoUrl(p.media.storage_path), kind: isImage(p.media.storage_path) ? "image" : "video" },
        })),
      };
    },
    async checkout(input: CheckoutInput) {
      return call("checkout", input as unknown as Record<string, any>);
    },
    async mockPay(orderId) {
      await call("order-action", { orderId, action: "mock_pay" });
    },
    async checkPayment(orderId) {
      return (await call<{ paid: boolean }>("order-action", { orderId, action: "check_payment" })).paid === true;
    },
    async myOrders() {
      const me = await uid();
      return (check(await sb.from("orders").select(ORDER_SELECT).eq("buyer_id", me).order("created_at", { ascending: false })) as any[]).map(toOrder);
    },
    async order(id) {
      const { data } = await sb.from("orders").select(ORDER_SELECT).eq("id", id).maybeSingle();
      return data ? toOrder(data) : null;
    },
    async cancelOrder(id, reason) {
      const r = await call<{ cancelled?: boolean }>("order-action", { orderId: id, action: "cancel", reason });
      return { cancelled: !!r.cancelled };
    },
    async answerCancel(id, accept) {
      await call("order-action", { orderId: id, action: "answer_cancel", accept });
    },
    async sellerCancelOrder(id, reason) {
      await call("order-action", { orderId: id, action: "seller_cancel", reason });
    },
    async teamCancelOrder(id, reason, sellerFault) {
      await call("order-action", { orderId: id, action: "team_cancel", reason, sellerFault: sellerFault === true });
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
      const { data: p } = await sb.from("profiles").select("display_name, bio, trust_score, created_at, handle, avatar_path, handle_changed_at, adult_confirmed_at, terms_accepted_at").eq("id", u.user.id).single();
      const { count } = await sb.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", u.user.id)
        .not("status", "in", "(pending_payment,cancelled)");
      return {
        id: u.user.id, displayName: p?.display_name || u.user.email?.split("@")[0] || "", bio: p?.bio ?? "", email: u.user.email,
        trustScore: p?.trust_score ?? 50, createdAt: p?.created_at ?? u.user.created_at, ordersCount: count ?? 0,
        handle: p?.handle ?? null, avatarUrl: avatarUrl(p?.avatar_path), handleChangedAt: p?.handle_changed_at ?? null,
        setUp: !!(p?.handle && p?.adult_confirmed_at && p?.terms_accepted_at),
      };
    },
    async updateProfile(displayName, bio) {
      check(await sb.from("profiles").update({ display_name: displayName.trim(), bio: bio.trim().slice(0, 150) }).eq("id", await uid()));
    },
    async auctionInfo(ids) {
      if (!ids.length) return {};
      const rows = check(await sb.rpc("auctions_info", { p_products: [...new Set(ids)].slice(0, 50) })) as any[];
      return Object.fromEntries(rows.map((r) => [r.productId, r]));
    },
    async placeBid(productId, amountCents, opts) {
      return check(await sb.rpc("place_bid", { p_product: productId, p_amount: amountCents, p_max: !!opts?.max })) as any;
    },
    async settleAuction(productId) {
      await sb.rpc("settle_auction", { p_product: productId });
    },
    async availableHandles(list) {
      return (check(await sb.rpc("available_handles", { p_handles: list.slice(0, 12).map((h) => h.toLowerCase()) })) as string[]) ?? [];
    },
    async completeAccount(name, handle, adult, terms) {
      check(await sb.rpc("complete_account", { p_name: name, p_handle: handle, p_adult: adult, p_terms: terms }));
    },
    async setUsername(handle) {
      check(await sb.rpc("set_username", { p_handle: handle }));
    },
    async setAvatar(photo) {
      const me = await uid();
      const { data: old } = await sb.from("profiles").select("avatar_path").eq("id", me).single();
      let path: string | null = null;
      if (photo) {
        path = `${me}/avatar-${Date.now()}.jpg`; // a new name each time, so phones don't show the old photo from cache
        const up = await sb.storage.from("avatars").upload(path, photo, { contentType: photo.type || "image/jpeg", upsert: true });
        if (up.error) throw new Error("Couldn't upload the photo. Try again.");
      }
      check(await sb.from("profiles").update({ avatar_path: path }).eq("id", me));
      if ((old as any)?.avatar_path) await sb.storage.from("avatars").remove([(old as any).avatar_path]).catch(() => {});
      return avatarUrl(path);
    },
    async shopAvatars(ids) {
      if (!ids.length) return {};
      const rows = check(await sb.rpc("shop_avatars", { p_shops: [...new Set(ids)].slice(0, 100) })) as any[];
      return Object.fromEntries(rows.map((r) => [r.shop_id, avatarUrl(r.avatar_path)!]));
    },
    async reactions() {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) return { liked: [], reposted: [] };
      const rows = check(await sb.from("post_reactions").select("post_id, kind").eq("user_id", u.user.id)) as any[];
      return { liked: rows.filter((r) => r.kind === "like").map((r) => r.post_id), reposted: rows.filter((r) => r.kind === "repost").map((r) => r.post_id) };
    },
    async react(postId, kind, on) {
      const me = await uid();
      if (on) {
        const res = await sb.from("post_reactions").insert({ user_id: me, post_id: postId, kind });
        if (res.error && !res.error.message.includes("duplicate")) throw new Error(res.error.message);
      } else {
        check(await sb.from("post_reactions").delete().eq("user_id", me).eq("post_id", postId).eq("kind", kind));
      }
    },
    async postCounts(ids) {
      if (!ids.length) return {};
      const rows = check(await sb.rpc("post_counts", { p_ids: ids })) as any[];
      return Object.fromEntries(rows.map((r) => [r.post_id, { likes: r.likes, reposts: r.reposts }]));
    },
    async reactedPosts(kind, shopId) {
      let who: string;
      if (shopId) {
        const { data } = await sb.from("shops").select("owner_id").eq("id", shopId).single();
        if (!data) return [];
        who = data.owner_id;
      } else who = await uid();
      const rows = check(await sb.from("post_reactions").select("post_id").eq("user_id", who).eq("kind", kind)
        .order("created_at", { ascending: false })) as any[];
      const order = rows.map((r) => r.post_id as string).slice(0, 200);
      const live = await postsById(order);
      return order.map((id) => live.get(id)).filter((x): x is FeedItem => !!x);
    },
    async followingReposts() {
      const follows = check(await sb.from("follows").select("shops(owner_id, handle)").eq("user_id", await uid())) as any[];
      const owners = new Map<string, string>(follows.filter((f) => f.shops).map((f) => [f.shops.owner_id, f.shops.handle]));
      if (!owners.size) return [];
      const rows = check(await sb.from("post_reactions").select("post_id, user_id").eq("kind", "repost").in("user_id", [...owners.keys()])
        .order("created_at", { ascending: false }).limit(50)) as any[];
      const live = await postsById(rows.map((r) => r.post_id));
      const out: FeedItem[] = [];
      for (const r of rows) {
        const it = live.get(r.post_id);
        if (it) out.push({ ...it, repostedBy: owners.get(r.user_id) });
      }
      return out;
    },
    async report(kind, targetId, reason, details) {
      check(await sb.from("reports").insert({ reporter_id: await uid(), target_kind: kind, target_id: targetId, reason, details: details.slice(0, 500) }));
    },
    async block(target) {
      let who = target.userId;
      if (!who && target.shopId) who = ((check(await sb.from("shops").select("owner_id").eq("id", target.shopId).single()) as any).owner_id);
      if (!who) throw new Error("Couldn't find that account.");
      const res = await sb.from("blocks").insert({ blocker_id: await uid(), blocked_id: who });
      if (res.error && !res.error.message.includes("duplicate")) throw new Error(res.error.message);
    },
    async unblock(userId) {
      check(await sb.from("blocks").delete().eq("blocker_id", await uid()).eq("blocked_id", userId));
    },
    async blocked() {
      const rows = check(await sb.rpc("my_blocks")) as any[];
      return rows.map((r) => ({ userId: r.user_id, name: r.name, shopId: r.shop_id, shopHandle: r.shop_handle }));
    },
    async savePushToken(token, platform) {
      const res = await sb.from("device_tokens").upsert({ token, user_id: await uid(), platform, last_seen_at: new Date().toISOString() }, { onConflict: "token" });
      if (res.error) throw new Error(res.error.message);
    },
    async savedDelivery() {
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) return null;
      const { data } = await sb.from("delivery_details").select("delivery, locker, name, phone, address, suburb, city, province, postal_code, pickup_point").eq("user_id", auth.user.id).maybeSingle();
      if (!data) return null;
      const d = data as any;
      return { delivery: d.delivery ?? undefined, locker: d.locker ?? undefined, name: d.name ?? undefined, phone: d.phone ?? undefined,
        street: d.address ?? undefined, suburb: d.suburb ?? undefined, city: d.city ?? undefined, province: d.province ?? undefined,
        postalCode: d.postal_code ?? undefined, pickupPoint: d.pickup_point ?? null };
    },
    async deliveryStamps() {
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) return 0;
      const { count } = await sb.from("delivery_stamps").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).is("used_order_id", null);
      return count ?? 0;
    },
    async parcelSizes(ids) {
      if (!ids.length) return {};
      const rows = check(await sb.from("products").select("id, parcel_size").in("id", ids.slice(0, 20))) as any[];
      return Object.fromEntries(rows.map((r) => [r.id, r.parcel_size ?? "small"]));
    },
    async pickupPoints(where) {
      return call("delivery", where);
    },
    async checkDelivery(c) {
      const r = await call<{ ok: boolean; message?: string | null; quoteCents?: number | null }>("delivery", { check: "route", ...c });
      return { ok: r.ok, message: r.message ?? null, quoteCents: typeof r.quoteCents === "number" && r.quoteCents > 0 ? r.quoteCents : null };
    },
    async shopPickup() {
      const shopId = await myShopId();
      if (!shopId) return null;
      const { data } = await sb.from("shop_pickup").select("*").eq("shop_id", shopId).maybeSingle();
      const p = data as any;
      return p ? { name: p.name, phone: p.phone, street: p.street, suburb: p.suburb, city: p.city, province: p.province, postalCode: p.postal_code } : null;
    },
    async saveShopPickup(p) {
      const shopId = await myShopId();
      if (!shopId) throw new Error("Open your shop first.");
      // Bob Go checks couriers can find the address before it's saved.
      const ok = await call<{ ok: boolean; message?: string }>("delivery", { check: "pickup", address: { street: p.street, suburb: p.suburb, city: p.city, province: p.province, postalCode: p.postalCode } });
      if (!ok.ok) throw new Error(ok.message ?? "Couriers can't find this address. Check it and try again.");
      check(await sb.from("shop_pickup").upsert({ shop_id: shopId, name: p.name.trim(), phone: p.phone.trim(), street: p.street.trim(), suburb: p.suburb.trim(),
        city: p.city.trim(), province: p.province, postal_code: p.postalCode.trim() }, { onConflict: "shop_id" }));
    },
    async courierLabel(orderId) {
      return (await call<{ url: string }>("order-action", { orderId, action: "label" })).url;
    },
    async shipmentEvents(orderId) {
      const rows = check(await sb.from("shipment_events").select("happened_at, status, message, location").eq("order_id", orderId).order("happened_at", { ascending: false })) as any[];
      return rows.map((r) => ({ at: r.happened_at, status: r.status, message: r.message, location: r.location }));
    },
    async saveDelivery(d) {
      const me = await uid();
      if (!d) { check(await sb.from("delivery_details").delete().eq("user_id", me)); return; }
      check(await sb.from("delivery_details").upsert({
        user_id: me, delivery: d.delivery ?? null, locker: d.locker ?? null, name: d.name ?? null, phone: d.phone ?? null, address: d.street ?? d.address ?? null,
        suburb: d.suburb ?? null, city: d.city ?? null, province: d.province || null, postal_code: d.postalCode || null, pickup_point: d.pickupPoint ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" }));
    },
    async saveInterests(interests) {
      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) return;
      check(await sb.from("profiles").update({ interests }).eq("id", auth.user.id));
    },
    async reportError(e) {
      try {
        await sb.from("app_errors").insert({
          message: e.message.slice(0, 500) || "Unknown error", stack: e.stack?.slice(0, 4000) ?? null, path: e.path?.slice(0, 200) ?? null,
          platform: e.platform ?? null, version: e.version?.slice(0, 40) ?? null,
        });
      } catch { /* never throw */ }
    },
    async recentErrors() {
      const rows = check(await sb.from("app_errors").select("*").order("created_at", { ascending: false }).limit(50)) as any[];
      return rows.map((r) => ({ id: String(r.id), message: r.message, stack: r.stack, path: r.path, platform: r.platform, version: r.version, createdAt: r.created_at, userId: r.user_id }));
    },
    async signInWithPassword(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.user) throw new Error("Wrong email or password.");
      return (await api.currentUser())!;
    },
    async deleteAccount() {
      await call("delete-account", { confirm: "DELETE" });
      await sb.auth.signOut();
    },
    async openReports() {
      const rows = check(await sb.from("reports").select("id, target_kind, target_id, reason, details, created_at").eq("status", "open").order("created_at")) as any[];
      const out: OpenReport[] = [];
      for (const r of rows) {
        let summary = "";
        if (r.target_kind === "post") summary = ((await sb.from("posts").select("caption").eq("id", r.target_id).maybeSingle()).data as any)?.caption ?? "";
        if (r.target_kind === "comment") summary = ((await sb.from("comments").select("body").eq("id", r.target_id).maybeSingle()).data as any)?.body ?? "";
        if (r.target_kind === "shop") summary = ((await sb.from("shops").select("name").eq("id", r.target_id).maybeSingle()).data as any)?.name ?? "";
        out.push({ id: r.id, targetKind: r.target_kind, targetId: r.target_id, reason: r.reason, details: r.details, createdAt: r.created_at, summary });
      }
      return out;
    },
    async handleReport(id, action) {
      check(await sb.rpc("admin_handle_report", { p_report: id, p_action: action }));
    },

    async comments(postId) {
      const { data: u } = await sb.auth.getUser();
      const rows = check(await sb.rpc("post_comments", { p_post: postId })) as any[];
      return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at, userId: r.user_id, name: r.name, shopHandle: r.shop_handle,
        isSeller: r.is_seller, mine: r.user_id === u.user?.id, userHandle: r.user_handle ?? null, avatarUrl: avatarUrl(r.avatar_path) }));
    },
    async addComment(postId, body) {
      check(await sb.from("comments").insert({ post_id: postId, user_id: await uid(), body: body.trim() }));
    },
    async deleteComment(id) {
      check(await sb.from("comments").delete().eq("id", id));
    },
    async commentCounts(ids) {
      if (!ids.length) return {};
      const rows = check(await sb.rpc("comment_counts", { p_ids: ids })) as any[];
      return Object.fromEntries(rows.map((r) => [r.post_id, r.comments]));
    },

    // ----- Friends and sharing (migration 0033) -----
    async followPerson(userId, on) {
      check(await sb.rpc("follow_person", { p_user: userId, p_on: on }));
    },
    async person(handle) {
      const r = check(await sb.rpc("person_page", { p_handle: handle })) as any;
      if (!r) return null;
      return { id: r.id, name: r.name || `@${r.handle}`, handle: r.handle, avatarUrl: avatarUrl(r.avatarPath), bio: r.bio ?? "",
        followers: r.followers, following: r.following, shop: r.shop ?? null, iFollow: !!r.iFollow, followsMe: !!r.followsMe, me: !!r.me, blocked: !!r.blocked };
    },
    async findPeople(query) {
      if (query.trim().length < 2) return [];
      const rows = check(await sb.rpc("find_people", { p_query: query })) as any[];
      return rows.map((r) => ({ id: r.id, name: r.name || `@${r.handle}`, handle: r.handle, avatarUrl: avatarUrl(r.avatar_path), iFollow: r.i_follow, followsMe: r.follows_me }));
    },
    async followBacks() {
      const rows = check(await sb.rpc("follow_backs")) as any[];
      return rows.map((r) => ({ id: r.id, name: r.name || `@${r.handle}`, handle: r.handle, avatarUrl: avatarUrl(r.avatar_path) }));
    },
    async friends() {
      const rows = check(await sb.rpc("my_friends")) as any[];
      return rows.map((r) => ({ id: r.id, name: r.name || `@${r.handle}`, handle: r.handle, avatarUrl: avatarUrl(r.avatar_path), chatId: r.chat_id }));
    },
    async friendChats() {
      const rows = check(await sb.rpc("my_friend_chats")) as any[];
      return rows.map((r) => ({ id: r.id, other: { id: r.other_id, name: r.other_name || `@${r.other_handle}`, handle: r.other_handle, avatarUrl: avatarUrl(r.other_avatar) },
        lastBody: r.last_body, lastShared: !!r.last_shared, lastMine: !!r.last_mine, lastAt: r.last_at, unread: r.unread, friends: !!r.friends }));
    },
    async friendChatWith(userId) {
      return check(await sb.rpc("friend_chat_with", { p_user: userId })) as string;
    },
    async friendChat(chatId) {
      const me = await uid();
      const chats = await api.friendChats();
      const chat = chats.find((c) => c.id === chatId);
      if (!chat) throw new Error("This chat isn't available.");
      const rows = check(await sb.from("friend_messages").select("id, body, created_at, sender_id, read_at, post_id, shared").eq("chat_id", chatId).order("created_at").limit(300)) as any[];
      const cards = new Map<string, SharedPost | null>();
      for (const id of new Set(rows.filter((r) => r.post_id).map((r) => r.post_id as string))) {
        const c = check(await sb.rpc("shared_post_card", { p_post: id })) as any;
        cards.set(id, c ? { postId: c.postId, productId: c.productId, title: c.title, priceCents: c.priceCents, mode: c.mode, shopName: c.shopName, shopHandle: c.shopHandle,
          thumb: c.playbackId ? `https://image.mux.com/${c.playbackId}/thumbnail.jpg?width=360&time=${c.cover ?? 0}` : c.kind === "image" ? videoUrl(c.path) : null, available: !!c.available } : null);
      }
      return { other: chat.other, friends: chat.friends, messages: rows.map((r) => ({ id: r.id, body: r.body, mine: r.sender_id === me, createdAt: r.created_at, readAt: r.read_at,
        shared: r.shared, post: r.post_id ? cards.get(r.post_id) ?? null : null })) };
    },
    async sendToFriend(userId, body) {
      check(await sb.rpc("send_to_friend", { p_to: userId, p_body: body, p_post: null }));
    },
    async sharePost(postId, userIds, note) {
      return check(await sb.rpc("share_post", { p_post: postId, p_to: userIds, p_note: note?.trim() || null })) as number;
    },
    async readFriendChat(chatId) {
      check(await sb.rpc("read_friend_chat", { p_chat: chatId }));
    },

    async conversations() {
      const rows = check(await sb.rpc("my_conversations")) as any[];
      return rows.map(toConversation);
    },
    async openConversation(shopId) {
      const me = await uid();
      const found = (await sb.from("conversations").select("id").eq("buyer_id", me).eq("shop_id", shopId).maybeSingle()).data as any;
      if (found) return found.id;
      return ((check(await sb.from("conversations").insert({ buyer_id: me, shop_id: shopId }).select("id").single()) as any).id);
    },
    async thread(conversationId) {
      const me = await uid();
      const convs = (check(await sb.rpc("my_conversations")) as any[]).map(toConversation);
      const conversation = convs.find((c) => c.id === conversationId);
      if (!conversation) throw new Error("This chat isn't available.");
      const rows = check(await sb.from("messages").select("id, body, created_at, sender_id, read_at, product_id, image_path, offers(id, product_ids, price_cents, expires_at, status, made_by)")
        .eq("conversation_id", conversationId).order("created_at")) as any[];
      const offerIds = rows.flatMap((r) => r.offers?.product_ids ?? []);
      const prices = offerIds.length ? Object.fromEntries(((await sb.from("products").select("id, price_cents").in("id", offerIds)).data ?? []).map((p: any) => [p.id, p.price_cents])) : {};
      const images = await Promise.all(rows.map(async (r) => (r.image_path ? (await sb.storage.from("private").createSignedUrl(r.image_path, 3600)).data?.signedUrl ?? null : null)));
      await sb.from("messages").update({ read_at: new Date().toISOString() }).eq("conversation_id", conversationId).neq("sender_id", me).is("read_at", null);
      return { conversation, typing: (typingUntil.get(conversationId) ?? 0) > Date.now(), messages: rows.map((r, i) => ({ id: r.id, body: r.body, createdAt: r.created_at, mine: r.sender_id === me, readAt: r.read_at, productId: r.product_id,
        imageUrl: images[i],
        offer: r.offers ? { id: r.offers.id, productIds: r.offers.product_ids, priceCents: r.offers.price_cents, expiresAt: r.offers.expires_at, status: r.offers.status, madeBy: r.offers.made_by ?? "seller",
          listedCents: r.offers.product_ids.reduce((n: number, id: string) => n + (prices[id] ?? 0), 0) } : null })) };
    },
    async sendMessage(conversationId, body, productId, image) {
      const imagePath = image ? await upload("private", image, "chat") : null;
      check(await sb.from("messages").insert({ conversation_id: conversationId, sender_id: await uid(), body: body.trim(), product_id: productId ?? null, image_path: imagePath }));
    },
    // ===== Live selling (migration 0040, live-token function) =====
    async liveShows() {
      const rows = ((check(await sb.rpc("live_shows_list")) as any[]) ?? []).filter(Boolean);
      const shops = await liveShops(rows.map((r) => r.shopId));
      return rows.filter((r) => shops[r.shopId]).map((r) => toShow(r, shops[r.shopId], null, null));
    },
    async liveShow(showId) {
      const r = check(await sb.rpc("live_show_info", { p_show: showId })) as any;
      if (!r) return null;
      const shops = await liveShops([r.shopId]);
      if (!shops[r.shopId]) return null;
      const pinned = r.pinnedProductId ? await api.productItem(r.pinnedProductId) : null;
      let auction = r.auctionProductId ? await api.productItem(r.auctionProductId) : null;
      if (auction && !auction.video.url && !auction.video.muxPlaybackId) {
        // A live auction is a copy of a listing: show the original's video or photo.
        const from = (await sb.from("products").select("from_product_id").eq("id", r.auctionProductId).maybeSingle()).data?.from_product_id;
        const parent = from ? (from === pinned?.product.id ? pinned : await api.productItem(from)) : null;
        if (parent) auction = { ...auction, video: parent.video, edit: undefined };
      }
      if (auction && r.auctionProductId) api.settleAuction(r.auctionProductId).catch(() => {});
      return toShow(r, shops[r.shopId], pinned, auction);
    },
    async createShow(title, startsAt) {
      return check(await sb.rpc("live_create", { p_title: title, p_starts_at: startsAt })) as string;
    },
    async goLive(showId) {
      check(await sb.rpc("live_go", { p_show: showId }));
    },
    async endShow(showId) {
      return check(await sb.rpc("live_end", { p_show: showId })) as LiveSummary;
    },
    async pinLiveItem(showId, productId) {
      check(await sb.rpc("live_pin", { p_show: showId, p_product: productId }));
    },
    async startLiveAuction(showId, productId, startCents, seconds, suddenDeath) {
      return check(await sb.rpc("live_start_auction", { p_show: showId, p_product: productId, p_start_cents: startCents, p_seconds: seconds, p_sudden_death: suddenDeath })) as string;
    },
    async reportLiveViewers(showId, count) {
      await sb.rpc("live_viewers", { p_show: showId, p_count: count });
    },
    async liveChat(showId) {
      const rows = (check(await sb.rpc("live_chat_since", { p_show: showId })) as any[]) ?? [];
      return rows.reverse().map((m): LiveChatMessage => ({ id: m.id, who: m.who, isSeller: !!m.is_seller, body: m.body, at: m.at }));
    },
    async sayLive(showId, body) {
      check(await sb.rpc("live_say", { p_show: showId, p_body: body }));
    },
    async hideLiveChat(messageId) {
      check(await sb.rpc("live_hide_chat", { p_id: messageId }));
    },
    async setLiveReminder(showId, on) {
      const me = await uid();
      if (on) {
        const { error } = await sb.from("live_reminders").insert({ show_id: showId, user_id: me });
        if (error && error.code !== "23505") throw new Error(error.message.includes("row-level") ? "This show has ended." : error.message);
      } else check(await sb.from("live_reminders").delete().eq("show_id", showId).eq("user_id", me));
    },
    async liveToken(showId, role) {
      return await call<{ url: string; token: string }>("live-token", { showId, role });
    },
    watchLive(showId, onChange) {
      // Changes arrive straight away through Supabase Realtime; a slow check every 8 seconds covers a dropped connection.
      const ch = sb.channel(`live-${showId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "live_shows", filter: `id=eq.${showId}` }, () => onChange())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_chat", filter: `show_id=eq.${showId}` }, () => onChange())
        .subscribe();
      const t = window.setInterval(onChange, 8000);
      return () => { window.clearInterval(t); sb.removeChannel(ch); };
    },
    watchThread(conversationId, onChange) {
      const ch = sb.channel(`chat-${conversationId}`, { config: { broadcast: { self: false } } })
        .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => {
          typingUntil.delete(conversationId); onChange();
        })
        .on("broadcast", { event: "typing" }, (msg: any) => {
          if (msg?.payload?.from && msg.payload.from === myId) return;
          typingUntil.set(conversationId, Date.now() + 4000);
          onChange();
          window.setTimeout(onChange, 4100);
        })
        .subscribe();
      chatChannels.set(conversationId, ch);
      // Offers changing and a dropped connection are covered by a slow check.
      const t = window.setInterval(onChange, 15000);
      return () => { window.clearInterval(t); chatChannels.delete(conversationId); sb.removeChannel(ch); };
    },
    watchFriendChat(chatId, onChange) {
      const ch = sb.channel(`friends-${chatId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "friend_messages", filter: `chat_id=eq.${chatId}` }, () => onChange())
        .subscribe();
      const t = window.setInterval(onChange, 15000);
      return () => { window.clearInterval(t); sb.removeChannel(ch); };
    },
    sendTyping(conversationId) {
      if (Date.now() - lastTypingSent < 2500) return;
      lastTypingSent = Date.now();
      chatChannels.get(conversationId)?.send({ type: "broadcast", event: "typing", payload: { from: myId } }).catch(() => {});
    },
    watchAuctions(productIds, onChange) {
      const ids = [...new Set(productIds)].slice(0, 100);
      if (!ids.length) return () => {};
      const ch = sb.channel(`auctions-${ids.join(",").slice(0, 60)}-${Math.random().toString(36).slice(2, 8)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "auction_ticks", filter: `product_id=in.(${ids.join(",")})` }, () => onChange())
        .subscribe();
      const t = window.setInterval(onChange, 10000);
      return () => { window.clearInterval(t); sb.removeChannel(ch); };
    },
    async search(q, f, offset = 0) {
      const rows = check(await sb.rpc("search_items", {
        p_q: q.trim(), p_category: f.category ?? null, p_size: f.size ?? null, p_min: f.minCents ?? null, p_max: f.maxCents ?? null,
        p_province: f.province ?? null, p_sort: f.sort ?? "best", p_limit: 20, p_offset: offset,
      })) as any[];
      return (rows ?? []).map(feedItem);
    },
    async searchSizes() {
      return ((check(await sb.rpc("search_sizes")) as string[] | null) ?? []);
    },
    async shopReviews(shopId) {
      const r = check(await sb.rpc("shop_reviews", { p_shop: shopId })) as any;
      return { count: Number(r?.count ?? 0), average: r?.average != null ? Number(r.average) : null,
        stars: r?.stars ?? { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }, recent: r?.recent ?? [] };
    },
    async recordViews(postIds) {
      if (!myId || !postIds.length) return;
      await sb.rpc("record_views", { p_posts: postIds.slice(0, 30) }); // best effort: a missed view is fine
    },
    async sellerStats(days) {
      const r = check(await sb.rpc("seller_stats", { p_days: days })) as any;
      return { ...r, series: r.series ?? [], top: r.top ?? [] } as SellerStats;
    },
    async acceptInvite(handle) {
      return !!check(await sb.rpc("accept_invite", { p_handle: handle }));
    },
    async myInvites() {
      return Number(check(await sb.rpc("my_invites")) ?? 0);
    },
    async productItem(productId) {
      const p = (await sb.from("products").select(`${PRODUCT_COLS}, shops(id, name, handle, category)`).eq("id", productId).maybeSingle()).data as any;
      if (!p) return null;
      const post = (await sb.from("posts").select("id, caption, edit, clips, media(mux_playback_id, storage_path)").eq("product_id", productId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as any;
      const m = post?.media;
      return {
        postId: post?.id ?? p.id, caption: post?.caption ?? p.title, edit: post ? playEdit(post.edit, post.clips) : undefined, product: { ...toProduct(p), heldFor: p.held_for, heldUntil: p.held_until },
        shop: { id: p.shops.id, name: p.shops.name, handle: p.shops.handle, category: p.shops.category, trustScore: 50, tier: "standard" },
        video: m ? { muxPlaybackId: m.mux_playback_id, url: videoUrl(m.storage_path), kind: isImage(m.storage_path) ? "image" : "video" } : {},
      };
    },
    async makeOffer(conversationId, productIds, priceCents, hours) {
      const offerId = check(await sb.rpc("make_offer", { p_conversation: conversationId, p_products: productIds, p_price: priceCents, p_hours: hours })) as string;
      check(await sb.from("messages").insert({ conversation_id: conversationId, sender_id: await uid(), body: "", offer_id: offerId }));
    },
    async buyerOffer(conversationId, productId, priceCents) {
      const offerId = check(await sb.rpc("buyer_offer", { p_conversation: conversationId, p_product: productId, p_price: priceCents })) as string;
      check(await sb.from("messages").insert({ conversation_id: conversationId, sender_id: await uid(), body: "", offer_id: offerId }));
    },
    async answerOffer(offerId, accept) {
      check(await sb.rpc("answer_offer", { p_offer: offerId, p_accept: accept }));
    },
    async holdProduct(productId, buyerId, hours) {
      check(await sb.rpc("hold_product", { p_product: productId, p_buyer: buyerId, p_hours: hours }));
    },
    async shopReplyMinutes(shopId) {
      const { data } = await sb.rpc("shop_reply_minutes", { p_shop: shopId });
      return typeof data === "number" ? data : null;
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
      const { data: u } = await sb.auth.getUser();
      if (!u.user) return false;
      const { count } = await sb.from("rewards").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).eq("status", "ready");
      return (count ?? 0) > 0; // the checkout function checks the full rules again
    },
    async myRewards() {
      return ((check(await sb.rpc("my_rewards")) as any[]) ?? []) as Reward[];
    },
    async markRewardsSeen(ids) {
      if (ids.length) check(await sb.from("rewards").update({ seen_at: new Date().toISOString() }).in("id", ids));
    },
    async teamRewards(userId) {
      return ((check(await sb.rpc("admin_rewards", { p_user: userId })) as any[]) ?? []).map((r, i) => ({ id: String(i), seen: true, ...r })) as Reward[];
    },

    async myShop() {
      const me = await uid();
      const { data: s } = await sb.from("shops").select(`*, seller_checks(*), products(${PRODUCT_COLS}), posts(product_id)`).eq("owner_id", me).maybeSingle();
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
          rulesAccepted: !!c.rules_accepted_at, payoutSchedule: c.payout_schedule ?? "WEEKLY",
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
    async createListing(input: ListingInput, video, proof, onProgress, photos = [], edit = null) {
      const errors = validateListing({ title: input.title, description: input.description, price: input.priceCents, label: input.label,
        condition: input.condition ?? undefined, hasProof: !!proof, mode: input.mode });
      if (errors.length) throw new Error(errors[0]);
      const shopId = await myShopId();
      if (!shopId) throw new Error("Start your shop first.");
      const row = {
        shop_id: shopId, title: input.title, description: input.description, price_cents: input.priceCents, mode: input.mode,
        label: input.label, condition: input.condition, sizes: input.sizes, stock: input.stock, lead_days: input.leadDays, allergens: input.allergens,
        ...(input.mode !== "order_now" ? { parcel_size: input.parcelSize ?? "small" } : {}),
        ...(input.mode === "auction" ? {
          stock: 1, reserve_cents: input.reserveCents ?? null,
          auction_ends_at: new Date(Date.now() + (input.auctionDays ?? 3) * 86400e3).toISOString(),
        } : {}),
      };
      // Try to go live. If a rule blocks it (for example, checks not done yet), save as a draft and say why.
      let live = true;
      let message: string | undefined;
      let res = await sb.from("products").insert({ ...row, status: "live" }).select("id").single();
      // Until the delivery update (0028) is on the database, it has no parcel size yet: list without it.
      if (res.error && /parcel_size/.test(res.error.message)) {
        delete (row as Record<string, unknown>).parcel_size;
        res = await sb.from("products").insert({ ...row, status: "live" }).select("id").single();
      }
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
      // One clip: photos go straight to storage, videos to Mux when it's set up.
      const uploadClip = async (file: File, progress?: (pct: number) => void) => {
        const photo = file.type.startsWith("image/");
        const up = photo ? { useStorage: true } as { useStorage?: boolean; mediaId?: string; uploadUrl?: string }
          : await call<{ useStorage?: boolean; mediaId?: string; uploadUrl?: string }>("mux-upload", {});
        if (up.useStorage) {
          const path = await upload("videos", file, "clip");
          progress?.(100);
          return (check(await sb.from("media").insert({ owner_id: await uid(), kind: photo ? "image" : "video", storage_path: path, status: "ready" }).select("id").single()) as any).id as string;
        }
        await putWithProgress(up.uploadUrl!, file, progress);
        return up.mediaId!;
      };
      const files = edit?.files.length ? edit.files : video ? [video] : [];
      if (files.length) {
        // Every clip uploads once; progress is shared across them.
        const ids: string[] = [];
        for (const [i, f] of files.entries()) ids.push(await uploadClip(f, (pct) => onProgress?.(Math.round(((i + pct / 100) / files.length) * 100))));
        const posted = await sb.from("posts").insert({ shop_id: shopId, product_id: productId, media_id: ids[0], caption: input.caption }).select("id").single();
        if (posted.error && live) message = "Saved. Your video posts once your shop is open.";
        if (!posted.error && edit) {
          const saved = await sb.rpc("set_post_edit", { p_post: (posted.data as any).id, p_edit: {
            clips: edit.list.clips.map((c, i) => ({ ...c, media: ids[i] })),
            marks: edit.list.marks.map((m) => (m.productId === "self" ? { ...m, productId } : m)), cover: edit.list.cover } });
          if (saved.error) message = `Posted, but the edit wasn't saved: ${cleanError(saved.error.message)}`;
        }
      }
      for (const [i, photo] of photos.slice(0, 9).entries()) {
        const path = await upload("videos", photo, "photo");
        check(await sb.from("listing_photos").insert({ product_id: productId, storage_path: path, position: i + 1 }));
      }
      return { live, message };
    },
    async productPhotos(productId) {
      const rows = check(await sb.from("listing_photos").select("storage_path").eq("product_id", productId).order("position")) as any[];
      return rows.map((r) => videoUrl(r.storage_path)!).filter(Boolean);
    },
    async suggestListing(photo) {
      try {
        const image = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(photo); });
        return await call<ListingSuggestion>("suggest-listing", { image });
      } catch {
        return null; // not set up, or the AI could not read it: the seller just types as normal
      }
    },
    async sellerOrders() {
      const shopId = await myShopId();
      if (!shopId) return [];
      return (check(await sb.from("orders").select(ORDER_SELECT).eq("shop_id", shopId).neq("status", "pending_payment")
        .order("created_at", { ascending: false })) as any[]).map(toOrder);
    },
    async shipOrder(id, trackingRef, packingVideo, packingPhoto) {
      // Both go to the private bucket: only the seller and our team can open them.
      const me = await uid();
      const add = async (file: File, kind: "video" | "image", prefix: string) => {
        const path = await upload("private", file, prefix);
        return (check(await sb.from("media").insert({ owner_id: me, kind, storage_path: path, status: "ready" }).select("id").single()) as any).id as string;
      };
      const packingMediaId = await add(packingVideo, "video", "packing");
      const packingPhotoMediaId = await add(packingPhoto, "image", "parcel");
      await call("order-action", { orderId: id, action: "ship", trackingRef: trackingRef || null, packingMediaId, packingPhotoMediaId });
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
    async updateListing(productId, c) {
      const { data: old } = await sb.from("products").select("status, mode").eq("id", productId).single();
      if (!old) throw new Error("That listing is gone.");
      if (old.mode === "auction") throw new Error("Auctions can't be changed once they're posted.");
      // Stock decides whether a Buy now listing is on sale; made to order listings are always open.
      const status = old.status === "removed" || old.status === "draft" ? old.status : old.mode === "buy_now" && c.stock < 1 ? "sold_out" : "live";
      check(await sb.from("products").update({ title: c.title.trim(), description: c.description.trim(), price_cents: c.priceCents,
        ...(old.mode === "buy_now" ? { stock: c.stock } : {}), sizes: c.sizes, status }).eq("id", productId));
    },
    async takeDownListing(productId) {
      check(await sb.from("products").update({ status: "removed" }).eq("id", productId));
      check(await sb.from("posts").update({ status: "removed" }).eq("product_id", productId));
    },
    async sellerCharges(shopId) {
      const id = shopId ?? (check(await sb.from("shops").select("id").eq("owner_id", await uid()).single()) as any).id;
      const [owed, rows] = await Promise.all([
        sb.rpc("seller_owed", { p_shop: id }),
        sb.from("seller_charges").select("*").eq("shop_id", id).order("created_at", { ascending: false }).limit(100),
      ]);
      return {
        owedCents: (check(owed) as number) ?? 0,
        charges: ((check(rows) as any[]) ?? []).map((c): SellerCharge => ({ id: c.id, orderId: c.order_id, kind: c.kind, amountCents: c.amount_cents, note: c.note, createdAt: c.created_at })),
      };
    },
    async setPayoutSchedule(schedule) {
      await call("seller-bank", { schedule });
    },
    async teamAddCharge(shopId, kind, amountCents, note, orderId) {
      check(await sb.rpc("team_add_seller_charge", { p_shop: shopId, p_kind: kind, p_amount: amountCents, p_note: note, p_order: orderId ?? null }));
    },
    async teamRemoveCharge(id) {
      check(await sb.rpc("team_remove_seller_charge", { p_id: id }));
    },

    // ===== Team dashboard =====
    async teamOverview() {
      return check(await sb.rpc("admin_overview")) as any;
    },
    async teamPeople(q, filter, offset = 0) {
      const rows = check(await sb.rpc("admin_people", { p_q: q, p_filter: filter, p_limit: 50, p_offset: offset })) as any[];
      return rows.map(toPerson);
    },
    async teamPerson(id) {
      const r = check(await sb.rpc("admin_person", { p_user: id })) as any;
      const signed = async (p: string | null) => (p ? (await sb.storage.from("private").createSignedUrl(p, 600)).data?.signedUrl ?? "" : "");
      const files: { label: string; url: string }[] = [];
      if (r.idFiles?.id) files.push({ label: "ID document", url: await signed(r.idFiles.id) });
      if (r.idFiles?.selfie) files.push({ label: "Selfie with ID", url: await signed(r.idFiles.selfie) });
      if (r.idFiles?.cert) files.push({ label: "Food certificate", url: await signed(r.idFiles.cert) });
      const out: TeamPersonDetail = { ...toPerson(r), bio: r.bio ?? "", city: r.city ?? "", adultConfirmedAt: r.adultConfirmedAt, termsAcceptedAt: r.termsAcceptedAt,
        phone: r.phone, bank: r.bank, files, liveListings: r.liveListings ?? 0, orders: r.orders ?? [], trustEvents: r.trustEvents ?? [], reports: r.reports ?? [], actions: r.actions ?? [] };
      return out;
    },
    async teamPacking(orderId) {
      const r = check(await sb.rpc("admin_packing", { p_order: orderId })) as any;
      const sign = async (p: string | null) => (p ? (await sb.storage.from("private").createSignedUrl(p, 600)).data?.signedUrl ?? null : null);
      return { orderId, code: r.code, videoUrl: await sign(r.video), photoUrl: await sign(r.photo), shippedAt: r.shippedAt,
        review: r.review, reviewedAt: r.reviewedAt, purgedAt: r.purgedAt, strikes90: Number(r.strikes90 ?? 0) };
    },
    async teamPackingReview(orderId, ok, note) {
      return Number(check(await sb.rpc("admin_packing_review", { p_order: orderId, p_ok: ok, p_note: note ?? null })) ?? 0);
    },
    async teamPackingQueue() {
      return (check(await sb.rpc("admin_packing_queue")) as any[]) ?? [];
    },
    async teamPackingShare(orderId, note) {
      const r = check(await sb.rpc("admin_packing", { p_order: orderId })) as any;
      const week = 7 * 86400;
      const sign = async (p: string | null) => (p ? (await sb.storage.from("private").createSignedUrl(p, week)).data?.signedUrl ?? null : null);
      const out = { video: await sign(r.video), photo: await sign(r.photo) };
      check(await sb.rpc("admin_packing_shared", { p_order: orderId, p_note: note ?? null }));
      return out;
    },
    async teamFeatures(userId) {
      return check(await sb.rpc("admin_features", { p_user: userId })) as any;
    },
    async setAccountFeature(userId, feature, state, reason) {
      check(await sb.rpc("admin_set_feature", { p_user: userId, p_feature: feature, p_state: state, p_reason: reason ?? null }));
    },
    async myFeatures() {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) return {};
      const { data } = await sb.from("account_features").select("feature, state").eq("user_id", u.user.id);
      return Object.fromEntries(((data ?? []) as { feature: string; state: "on" | "off" }[]).map((r) => [r.feature, r.state]));
    },
    async suspendAccount(userId, reason) {
      check(await sb.rpc("admin_suspend", { p_user: userId, p_reason: reason }));
    },
    async unsuspendAccount(userId) {
      check(await sb.rpc("admin_unsuspend", { p_user: userId }));
    },
    async setShopStatus(shopId, status, reason) {
      check(await sb.rpc("admin_set_shop_status", { p_shop: shopId, p_status: status, p_reason: reason ?? null }));
    },
    async setTeamRole(userId, role) {
      check(await sb.rpc("admin_set_role", { p_user: userId, p_role: role }));
    },
    async teamOrders(q, filter, offset = 0) {
      return check(await sb.rpc("admin_orders", { p_q: q, p_filter: filter, p_limit: 50, p_offset: offset })) as any[];
    },
    async teamListings(q, filter, offset = 0) {
      return check(await sb.rpc("admin_listings", { p_q: q, p_filter: filter, p_limit: 50, p_offset: offset })) as any[];
    },
    async removeListing(productId, reason) {
      if (!reason.trim()) throw new Error("Add a reason. The seller sees it.");
      check(await sb.rpc("admin_remove_product", { p_product: productId, p_reason: reason.trim(), p_counterfeit: false }));
    },
    async teamLog() {
      return (check(await sb.rpc("admin_log", { p_limit: 200 })) as any[]).map((a) => ({ ...a, id: String(a.id) }));
    },
    async teamAlerts() {
      const rows = check(await sb.from("team_alerts").select("*").order("created_at", { ascending: false }).limit(100)) as any[];
      return rows.map((a) => ({ id: String(a.id), kind: a.kind, severity: a.severity, title: a.title, body: a.body, link: a.link, createdAt: a.created_at, seen: !!a.seen_at }));
    },
    async markAlertsSeen(ids) {
      if (ids.length) check(await sb.from("team_alerts").update({ seen_at: new Date().toISOString() }).in("id", ids.map(Number)));
    },
    async mySuspension() {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) return null;
      const { data } = await sb.from("suspensions").select("reason, at").eq("user_id", u.user.id).maybeSingle();
      return data ? { reason: (data as any).reason, at: (data as any).at } : null;
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
      // Includes warning signs (new buyer, same phone as the seller, collected in person, many credit orders).
      const rows = check(await sb.rpc("admin_topups")) as any[];
      return rows.map((r) => ({ payoutId: r.payoutId, shopName: r.shopName, bank: r.bank, amountCents: r.amountCents, payOn: r.payOn,
        buyer: r.buyer, buyerId: r.buyerId, sellerId: r.sellerId, flags: r.flags ?? [] }));
    },
    async markTopUpPaid(payoutId) {
      check(await sb.rpc("admin_mark_topup_paid", { p_payout: payoutId }));
    },
  };
  function toPerson(r: any): TeamPerson {
    return { id: r.id, name: r.name ?? "", handle: r.handle, email: r.email, role: r.role, trust: r.trust, tier: r.tier, createdAt: r.createdAt,
      avatarUrl: avatarUrl(r.avatarPath), setUp: !!r.setUp, suspendedAt: r.suspendedAt ?? null, suspendedReason: r.suspendedReason ?? null,
      shop: r.shop ?? null, ordersBought: r.ordersBought ?? 0, ordersSold: r.ordersSold ?? 0, reportsAgainst: r.reportsAgainst ?? 0 };
  }
  return api;
}

/** 082 123 4567 -> +27821234567 */
/**
 * Where the sign in link in the email should land: the page you were on (like /team), not the home page.
 * Only pages on our own site; Supabase also checks it against its list of allowed addresses.
 */
function backHere(): string | undefined {
  if (typeof location === "undefined" || !/^https?:$/.test(location.protocol)) return undefined;
  let path = location.pathname + location.search;
  if (location.pathname.startsWith("/signin")) path = new URLSearchParams(location.search).get("next") ?? "/";
  if (!path.startsWith("/") || path.startsWith("//")) path = "/";
  return location.origin + path;
}

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


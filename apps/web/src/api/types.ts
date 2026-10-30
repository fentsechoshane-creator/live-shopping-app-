import type {
  Cents, Condition, DeliveryOption, ListingLabel, OrderStatus, OrderTotals, ReturnReason, SaleMode, SellerTier,
} from "@app/core";

export type Category = "clothes" | "beauty" | "food" | "designer";
export type ReviewStatus = "not_started" | "pending" | "approved" | "rejected";

export interface User {
  id: string;
  email?: string;
  phone?: string;
  displayName: string;
}

/** Where a video can be played from. */
export interface VideoSource {
  muxPlaybackId?: string | null;
  url?: string | null;
  /** A photo post instead of a video. */
  kind?: "video" | "image";
  /** Demo only: a coloured placeholder with a label. */
  demo?: { bg: string; label: string; scene?: string };
}

export interface FeedItem {
  postId: string;
  caption: string;
  product: ProductPublic;
  shop: ShopPublic;
  video: VideoSource;
  /** Set when the post shows up because a followed shop reposted it. */
  repostedBy?: string;
}

export type Reaction = "like" | "repost";
export type ReportReason = "counterfeit" | "not_as_shown" | "offensive" | "scam" | "spam" | "other";
export type ReportTarget = "post" | "shop" | "comment" | "message" | "user";

export interface Comment {
  id: string; body: string; createdAt: string; userId: string; name: string; shopHandle: string | null; isSeller: boolean; mine: boolean;
  userHandle?: string | null; avatarUrl?: string | null;
}
export interface Conversation {
  id: string; shopId: string; shopName: string; shopHandle: string; otherName: string; iAmSeller: boolean;
  lastBody: string | null; lastAt: string; unread: number; buyerId: string;
}
export interface Offer { id: string; productIds: string[]; priceCents: Cents; listedCents: Cents; expiresAt: string; status: "open" | "used" | "withdrawn" }
export interface Message {
  id: string; body: string; createdAt: string; mine: boolean; readAt: string | null; productId: string | null;
  imageUrl: string | null; offer: Offer | null;
}
export interface BlockedPerson { userId: string; name: string; shopId: string | null; shopHandle: string | null }
export interface OpenReport { id: string; targetKind: ReportTarget; targetId: string; reason: ReportReason; details: string; createdAt: string; summary: string }

export interface ListingSuggestion {
  title: string;
  label: ListingLabel;
  condition: Condition | null;
  priceCents: Cents;
  description: string;
  /** Demo mode: a made up example, not a real reading of the photo. */
  demo?: boolean;
}

export interface MyProfile {
  id: string;
  displayName: string;
  /** @username. Empty until the account is set up. */
  handle: string | null;
  avatarUrl: string | null;
  /** When the username was last changed (it can change once every 30 days). */
  handleChangedAt: string | null;
  /** Name, username, 18 and over and terms are done. */
  setUp: boolean;
  bio: string;
  email?: string;
  trustScore: number;
  createdAt: string;
  ordersCount: number;
}

export interface ProductPublic {
  id: string;
  title: string;
  description: string;
  priceCents: Cents;
  mode: SaleMode;
  label: ListingLabel;
  condition: Condition | null;
  sizes: string[];
  stock: number;
  leadDays: number | null;
  allergens: string | null;
  status: "draft" | "live" | "sold_out" | "removed";
  /** Held by the seller for one buyer until this time. */
  heldFor?: string | null;
  heldUntil?: string | null;
}

export interface ShopPublic {
  id: string;
  name: string;
  handle: string;
  category: Category;
  bio?: string;
  trustScore: number;
  tier: SellerTier;
  sales?: number;
  followers?: number;
  founding?: boolean;
}

export interface CheckoutInput {
  productId: string;
  size?: string;
  delivery: DeliveryOption;
  deliveryDetails: { locker?: string; name?: string; phone?: string; address?: string };
  foodDate?: string;
  foodSlot?: string;
  foodMessage?: string;
  /** A special price (one item or a bundle) the seller sent in chat. */
  offerId?: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  mode: SaleMode;
  product: { id: string; title: string };
  shop: { id: string; name: string; handle: string };
  buyerId: string;
  size: string | null;
  delivery: DeliveryOption;
  deliveryDetails: Record<string, string>;
  foodDate: string | null;
  foodSlot: string | null;
  totals: Pick<OrderTotals, "itemPrice" | "deliveryFee" | "protectionFee" | "creditUsed" | "total" | "sellerFee" | "sellerPayout" | "creditTopUp">;
  checkoutUrl: string | null;
  trackingRef: string | null;
  paidAt: string | null;
  shipBy: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  releasableAt: string | null;
  createdAt: string;
  ret: { reason: ReturnReason; details: string; status: string; postagePayer: "buyer" | "seller" } | null;
  review: { stars: number } | null;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SellerChecks {
  phone: string | null;
  idStatus: ReviewStatus;
  bankStatus: ReviewStatus;
  bankName: string | null;
  bankLast4: string | null;
  certStatus: ReviewStatus;
  rulesAccepted: boolean;
}

export interface MyShop {
  id: string;
  name: string;
  handle: string;
  category: Category;
  status: "onboarding" | "open" | "paused" | "banned";
  foundingUntil: string | null;
  trustScore: number;
  goodOrders: number;
  checks: SellerChecks;
  products: (ProductPublic & { proofStatus: ReviewStatus; posted: boolean })[];
}

export interface BankInput {
  bankName: string;
  accountNumber: string;
  accountType: "SAVINGS" | "CHEQUE";
  givenName: string;
  familyName: string;
  idNumber?: string;
}

export interface ListingInput {
  title: string;
  description: string;
  priceCents: Cents;
  mode: "buy_now" | "order_now";
  label: ListingLabel;
  condition: Condition | null;
  sizes: string[];
  stock: number;
  leadDays: number | null;
  allergens: string | null;
  caption: string;
}

export interface Payout {
  id: string;
  orderId: string;
  amountCents: Cents;
  payOn: string | null;
  status: "scheduled" | "held" | "released" | "cancelled";
  releasableAt: string;
}

export interface TopUp {
  payoutId: string;
  shopName: string;
  bank: string;
  amountCents: Cents;
  payOn: string | null;
}

export interface PendingReview {
  shopId: string;
  shopName: string;
  what: "id" | "cert";
  files: { label: string; url: string }[];
}

/** Delivery details remembered for the next checkout. Private to the user. */
export interface SavedDelivery { delivery?: string; locker?: string; name?: string; phone?: string; address?: string }
export interface AppError { id: string; message: string; stack?: string | null; path?: string | null; platform?: string | null; version?: string | null; createdAt: string; userId?: string | null }

export interface Api {
  mode: "demo" | "live";
  // Auth
  currentUser(): Promise<User | null>;
  onAuthChange(cb: (u: User | null) => void): () => void;
  sendCode(contact: string): Promise<void>;
  verifyCode(contact: string, code: string): Promise<User>;
  signOut(): Promise<void>;
  // Buying
  feed(offset?: number): Promise<FeedItem[]>;
  shop(handle: string): Promise<{ shop: ShopPublic; items: FeedItem[] } | null>;
  checkout(input: CheckoutInput): Promise<{ orderId: string; checkoutUrl: string; totals: OrderTotals }>;
  mockPay(orderId: string): Promise<void>;
  myOrders(): Promise<Order[]>;
  order(id: string): Promise<Order | null>;
  cancelUnpaid(id: string): Promise<void>;
  confirmReceived(id: string): Promise<void>;
  requestReturn(id: string, reason: ReturnReason, details: string): Promise<void>;
  leaveReview(id: string, stars: number, body: string): Promise<void>;
  notifications(): Promise<Notification[]>;
  markAllRead(): Promise<void>;
  welcomeCreditAvailable(): Promise<boolean>;
  myProfile(): Promise<MyProfile>;
  updateProfile(displayName: string, bio: string): Promise<void>;
  /** Which of these usernames are free (yours counts as free). */
  availableHandles(handles: string[]): Promise<string[]>;
  /** The sign up step: name, username, 18 and over, terms. */
  completeAccount(name: string, handle: string, adult: boolean, terms: boolean): Promise<void>;
  setUsername(handle: string): Promise<void>;
  /** Upload a profile photo (already square), or null to remove it. Returns the new photo's address. */
  setAvatar(photo: Blob | null): Promise<string | null>;
  /** Profile photos of shop owners, by shop id. */
  shopAvatars(shopIds: string[]): Promise<Record<string, string>>;
  /** Posts the signed in user liked or reposted (ids). Empty when signed out. */
  reactions(): Promise<{ liked: string[]; reposted: string[] }>;
  react(postId: string, kind: Reaction, on: boolean): Promise<void>;
  /** Like and repost counts per post id. */
  postCounts(postIds: string[]): Promise<Record<string, { likes: number; reposts: number }>>;
  /** Live posts liked or reposted, newest first. By the signed in user, or by a shop's owner when shopId is given. Public. */
  reactedPosts(kind: Reaction, shopId?: string): Promise<FeedItem[]>;

  // Safety (store rules): report, block, delete account
  report(kind: ReportTarget, targetId: string, reason: ReportReason, details: string): Promise<void>;
  /** Block a person, or the owner of a shop. */
  block(target: { userId?: string; shopId?: string }): Promise<void>;
  unblock(userId: string): Promise<void>;
  blocked(): Promise<BlockedPerson[]>;
  deleteAccount(): Promise<void>;
  /** Phone app: remember this device so we can send push notifications. */
  savePushToken(token: string, platform: string): Promise<void>;
  /** Delivery details from the last order, to fill in checkout. */
  savedDelivery(): Promise<SavedDelivery | null>;
  saveDelivery(d: SavedDelivery | null): Promise<void>;
  /** What the user picked on the welcome screens. Shapes the first For You feed. */
  saveInterests(interests: Category[]): Promise<void>;
  /** Send a crash or error report. Never throws. */
  reportError(e: { message: string; stack?: string; path?: string; platform?: string; version?: string }): Promise<void>;
  /** Team only: the latest error reports. */
  recentErrors(): Promise<AppError[]>;
  /** Email and password sign in (used for the app store reviewers' test account). */
  signInWithPassword(email: string, password: string): Promise<User>;
  openReports(): Promise<OpenReport[]>;
  handleReport(id: string, action: "remove" | "dismiss"): Promise<void>;

  // Comments
  comments(postId: string): Promise<Comment[]>;
  addComment(postId: string, body: string): Promise<void>;
  deleteComment(id: string): Promise<void>;
  commentCounts(postIds: string[]): Promise<Record<string, number>>;

  // Messages between a buyer and a shop
  conversations(): Promise<Conversation[]>;
  /** Gets or starts the chat with a shop and returns its id. */
  openConversation(shopId: string): Promise<string>;
  /** `typing`: the other person is typing right now. */
  thread(conversationId: string): Promise<{ conversation: Conversation; messages: Message[]; typing?: boolean }>;
  /** `productId`: the item the message is about (from "Message seller" on a product). */
  sendMessage(conversationId: string, body: string, productId?: string | null, image?: File | null): Promise<void>;
  /** An item with its shop and video, for chat cards and buying from a chat. */
  productItem(productId: string): Promise<FeedItem | null>;
  /** Seller: a special price for one item or a bundle, sent as a message. */
  makeOffer(conversationId: string, productIds: string[], priceCents: Cents, hours: number): Promise<void>;
  /** Seller: hold an item for this buyer (0 hours releases it). */
  holdProduct(productId: string, buyerId: string, hours: number): Promise<void>;
  /** Median minutes a shop takes to answer a new chat, or null if not enough chats yet. */
  shopReplyMinutes(shopId: string): Promise<number | null>;
  /** Posts reposted by the owners of shops the user follows, for the Following feed. */
  followingReposts(): Promise<FeedItem[]>;
  following(): Promise<ShopPublic[]>;
  follow(shopId: string): Promise<void>;
  unfollow(shopId: string): Promise<void>;
  // Selling
  myShop(): Promise<MyShop | null>;
  startShop(name: string, handle: string, category: Category): Promise<void>;
  submitId(phone: string, idDoc: File, selfie: File): Promise<void>;
  addBank(input: BankInput): Promise<void>;
  submitFoodCert(file: File): Promise<void>;
  acceptRules(): Promise<void>;
  openShop(): Promise<void>;
  /** `video` is the cover (a video or a photo). `photos` are up to 9 extra photos shown in the item sheet. */
  createListing(input: ListingInput, video: File | null, proof: File | null, onProgress?: (pct: number) => void, photos?: File[]): Promise<{ live: boolean; message?: string }>;
  /** Extra photos of a listing, in order. */
  productPhotos(productId: string): Promise<string[]>;
  /** Suggested title, type, condition and price from a photo. Null when suggestions are not available. */
  suggestListing(photo: Blob): Promise<ListingSuggestion | null>;
  sellerOrders(): Promise<Order[]>;
  shipOrder(id: string, trackingRef: string, packingVideo: File | null): Promise<void>;
  acceptReturn(id: string): Promise<void>;
  returnReceived(id: string): Promise<void>;
  disputeReturn(id: string): Promise<void>;
  payouts(): Promise<Payout[]>;
  // Admin
  isAdmin(): Promise<boolean>;
  pendingReviews(): Promise<PendingReview[]>;
  adminReview(shopId: string, what: "id" | "cert", approved: boolean): Promise<void>;
  disputedOrders(): Promise<Order[]>;
  decideReturn(orderId: string, uphold: boolean): Promise<void>;
  topUpsDue(): Promise<TopUp[]>;
  markTopUpPaid(payoutId: string): Promise<void>;
  // Demo helpers (demo mode only)
  demo?: {
    markDelivered(orderId: string): Promise<void>;
    skipDays(days: number): Promise<void>;
    reset(): Promise<void>;
  };
}

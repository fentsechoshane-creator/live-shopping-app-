# How we compare (29 Oct 2026)

✅ have it · 🟡 partly · ❌ not yet. "Us" means the current build.

| Feature | TikTok / TikTok Shop | Instagram | Whatnot | Vinted / Depop | Us |
| --- | --- | --- | --- | --- | --- |
| Full screen video feed (For you, Following) | ✅ | ✅ Reels | 🟡 | ❌ | ✅ |
| Tap to pause, sound, drag to rewind, 2x hold, double tap seek | ✅ | 🟡 | 🟡 | ❌ | ✅ |
| Photo slideshow posts | ✅ | ✅ | ❌ | ✅ (listing photos) | ✅ |
| Likes, reposts, share | ✅ | ✅ | 🟡 | 🟡 favourites | ✅ |
| Comments | ✅ | ✅ | ✅ chat | ❌ | ✅ |
| Direct messages | ✅ | ✅ | ✅ | ✅ | ✅ buyer and shop chats |
| Buy inside the video | ✅ | 🟡 tags | ✅ | ❌ | ✅ |
| Money held until the item is fine (escrow) | 🟡 | ❌ | 🟡 | ✅ buyer protection | ✅ |
| Returns flow with clear rules | ✅ | ❌ | 🟡 | ✅ | ✅ |
| Seller ID checks, trust score, tiers | 🟡 | ❌ | ✅ | 🟡 | ✅ |
| Counterfeit blocking at listing | 🟡 | ❌ | 🟡 | 🟡 | ✅ |
| Live selling | ✅ | ✅ | ✅ | ❌ | ❌ (stock check built) |
| Live auctions | 🟡 | ❌ | ✅ | ❌ | ❌ |
| Make an offer / bundles | ❌ | ❌ | 🟡 | ✅ | ✅ seller special price and bundles in chat |
| Camera with photo, video, limit | ✅ | ✅ | ✅ | ✅ | ✅ |
| Editing, filters, music, text | ✅ | ✅ | ❌ | ❌ | ❌ |
| Step by step listing with AI suggestions and drafts | 🟡 | ❌ | 🟡 | ✅ | ✅ |
| Push notifications | ✅ | ✅ | ✅ | ✅ | ❌ (in app list only) |
| Search and filters | ✅ | ✅ | ✅ | ✅ | 🟡 basic |
| Ranking engine that rewards sales | ✅ | ✅ | 🟡 | 🟡 | 🟡 basic, engine v1 next |
| Courier labels and tracking built in | ✅ | ❌ | ✅ | ✅ | 🟡 manual tracking number |
| Report, block, delete account (store rules) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Seller stats (views, conversion) | ✅ | ✅ | ✅ | 🟡 | ❌ |

**Where we are ahead for South Africa:** escrow on every order, clear returns, trust tiers, counterfeit blocking, founding seller 0% fee, R50 welcome credit, food "order now" with allergens.

**Biggest gaps vs the greats:** live selling, push notifications, editing tools, courier integration.

# Are we a closed loop yet?

The loop: seller signs up and is checked → lists → buyer finds it → pays into escrow → seller ships → buyer receives → return window → seller paid → both rate.

| Step | Demo | Real (live project) | What's missing for real |
| --- | --- | --- | --- |
| Sign up and sign in | ✅ | 🟡 | Supabase email template with the 6 digit code [Ofentse] |
| Seller ID, bank and rules | ✅ | ✅ | Team checks by hand for now |
| Create a listing (photos, video, steps) | ✅ | 🟡 | Apply migration 0010; Mux keys for video [Lehloma] |
| Feed, follow, like, repost | ✅ | 🟡 | Apply migration 0009 |
| Checkout and pay into escrow | ✅ mock | 🟡 mock | TradeSafe sandbox, then live keys and contract |
| Ship, deliver, return window | ✅ | ✅ | Courier integration later (manual tracking for now) |
| Payout and top ups | ✅ | 🟡 | Real payouts through TradeSafe |
| Reviews and trust | ✅ | ✅ | |
| Notifications | ✅ in app | ✅ in app | Push notifications (native app) |
| Store must haves | ✅ | 🟡 | Apply migration 0011, deploy delete-account, final privacy policy details |

**Short answer:** the full loop works end to end in the demo today. For real money, the gap is mostly keys and sign offs (TradeSafe, Mux, the email template, applying two migrations) plus four store must haves. That is roughly 2 to 3 weeks of focused work for Lehloma and you, with TradeSafe's live sign off as the biggest unknown. [CONFIRM with TradeSafe how long live onboarding takes]

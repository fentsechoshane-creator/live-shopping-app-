# Project log

Shared memory for everyone working on this repo: Ofentse, Lehloma and any AI tool (any Claude account, ChatGPT, Gemini, Copilot, Cursor). Newest entries first in the Log section. Keep entries short.

**Ask any AI:** "Read docs/LOG.md and tell me how far we are and what's next." **Or run** `npm run status`.

**Rule for every AI and person:** after each piece of work, add a dated entry to the top of the Log, update Current state and Next up, and commit it with the work.

## How far we are

| Area | Status |
| --- | --- |
| Business rules (fees, credit, returns, payouts, trust) | Done and tested |
| Database, security rules, server functions | Done. Live database up to date (0001 to 0030) and every server function deployed (6 Nov) |
| Seller side (sign up, checks, listings, orders, payouts) | Done in the web app |
| Buyer side (feed, Explore, checkout, orders, returns) | Done in the web app |
| Design (Liquid Glass, iPhone first, TikTok style profile) | Done, keeps improving |
| Real payments (TradeSafe escrow) | Live in TradeSafe sandbox: sign in works, banks mapped. Next: one test payment |
| Real video (Mux) | Built, waiting for keys [Lehloma] |
| Sign in by code on the live project | Waiting for 2 Supabase settings [Ofentse] |
| Mobile app (iPhone and Android) | Built with Capacitor. Android test build on GitHub; iPhone needs a Mac with Xcode |
| Chat, offers, holds, comments | Done |
| Timed auctions | Built (migration 0016), live database needs it; checkout and run-due functions to deploy [Lehloma] |
| Live streams | Not started. Hidden for the first store upload (switch `VITE_LIVE`) |
| Store readiness | Terms of Use, Privacy Policy, Contact us, phone notifications, reviewer notes, screenshots done. Company details [CONFIRM] |
| Error reports, share previews, welcome, saved delivery | Done (previews need the web host) |
| Security (docs/SECURITY.md) | Full review done (migration 0018 plus server and app fixes). Live database needs 0017 and 0018 [Ofentse to approve]. Next: two step sign in for the team, CAPTCHA at sign up |
| Team dashboard (/team) | Built (migrations 0017 and 0021): feature switches per account, accounts, suspensions, checks, reports, returns, orders, listings, money, errors, activity log. Live database needs 0017 [Ofentse to approve] |

## Run the current version

- `npm install` then `npm run dev`: demo mode at http://localhost:5173, sign in with any email and the code 123456 (an email starting with "admin" is the team view).
- `npm run build:phone`: the whole app as one HTML file at `apps/web/dist-artifact/index.html`, to host anywhere (for example Netlify Drop) and open on a phone.
- `npm run dev:live`: the app against the live Supabase project.
- The latest version is always the newest commit on `main`. `npm run status` prints it.

## Who and what

- **Product:** a South African live shopping app. Sellers post short videos (later live streams with auctions), buyers tap Buy now inside the video. Thrift, designer resale, beauty, home bakers.
- **Founders:** Ofentse (UCT property student, product and business) and Lehloma Moloi (developer, chooses the mobile platform).
- **Repo layout:** `packages/core` (business rules, tested), `supabase/` (database, security, server functions), `apps/web` (React web client, demo mode works without keys). See README.md and docs/ARCHITECTURE.md.
- **Live backend:** Supabase project `gingqryoycwtzbfvfbln` (org myHaul, London). All 6 migrations and 7 functions deployed. Escrow runs in mock mode until TradeSafe keys are set.
- **Phone preview:** a claude.ai artifact built with `npm run build:artifact -w apps/web` (one HTML file). It lives in the first Claude account; another account must publish its own copy.

## Rules that are decided (do not change without Ofentse)

- Money in cents. Seller fee 6%. First 50 sellers pay 0% for 90 days.
- Buyer protection fee: R5 under R150, R12 from R150 to R500, 3.5% above R500.
- Rewards (not advertised): R50 surprise after a first delivered purchase, auction win and sale; usable after the return window; one per order of R200 or more. If the reward is bigger than our cut, we top up the seller ourselves from the budget.
- Money is held by a registered escrow provider (TradeSafe). Sellers are never paid before the return window closes: Buy now 7 days, auction 2 days, food 1 day. Ship within 72 hours.
- Payout timing by trust tier after the window: Top next working day, Trusted 2 working days, Standard next Friday, Restricted held.
- Trust score starts at 50 (0 to 100). Tiers at 90, 70, 40.
- **Design rule for every version:** match `docs/design/prototype/` and use the Liquid Glass system in docs/DESIGN.md. Clean, uncluttered, iPhone first.

## Current state

- Buyer: welcome screens with interests on first open, feed (For you ranked by interests, loads more as you scroll; Following), Explore with word search, item sheet, checkout that remembers delivery details, My orders with returns and ratings, Inbox (messages and updates), chats with offers and holds.
- Signing in happens in a sheet over the current screen and then finishes what you tapped (like, follow, buy, message). The code signs in by itself once 6 digits are in.
- Profile: TikTok style page with Posts, Likes and Reposts.
- Seller: onboarding, Create in steps with drafts and photo suggestions, Camera (Live hidden until built), orders to ship (most urgent first, copy address), payouts.
- Team dashboard at `/team` (laptop first, works on a phone): search on every page; Overview with sales, fees and what needs doing; To do (reports, checks, returns, late orders, top ups); Accounts with search, filters and a full page per person (shop, checks, ID files, orders, trust history, reports, what the team did); suspend and lift, pause, close or open shops, add or remove team members; Seller checks; Reports; Returns; Orders; Listings (remove with a reason); Money (top ups); App errors; Activity log of every team action. Suspended people can sign in and see orders but can't buy, sell, bid, comment or message; the database blocks it.
- Phone apps: Capacitor in `apps/web/ios` and `apps/web/android`. Links to items and shops open the app once the domain is set up.
- Ranking: `apps/web/src/lib/rank.ts` is where Lehloma's engine plugs in.
- Tests: `npm test` (core), `npm run test:db` (security rules on local Postgres), `npm run test:e2e` (full journey, iPhone size, screenshots in `apps/web/e2e/shots`).

## Next up

- **Edit your own listing:** price, description, stock, pause, mark sold, delete (sellers can't change a listing after posting yet). [Claude]
- **Basic video editing:** research done first, build when Ofentse says. [Claude]
- **Test payment:** buy something on the live site, pay on TradeSafe's sandbox page, check the order turns Paid. [Ofentse, Claude]
- **Bob Go:** sandbox key and webhook secret in Supabase secrets (docs/SETUP.md section 4), then set `BOBGO_MODE=sandbox`. Everything else is already live. [Ofentse]
- **Mux:** token and webhook secret in Supabase secrets. Until then videos go to Supabase storage. [Ofentse]
- **Make Ofentse a team member (one line, Ofentse):** Supabase > SQL Editor, run `update profiles set role = 'admin' where id = (select id from auth.users where email = 'fentsechoshane@gmail.com');` Claude was not allowed to grant team access itself.
- **Secrets (Ofentse or Lehloma, in Supabase > Edge Functions > Secrets):** `TRADESAFE_MODE=mock` and `APP_URL=https://myhaul-app.netlify.app` while testing. Payments are refused until TRADESAFE_MODE is set. Later: Mux, Anthropic, Telegram, Resend, Firebase and Apple push keys.
- **Supabase settings:** turn on leaked password protection (Authentication > Sign in / Providers > Password). [Ofentse]
- **Store accounts (start now, slowest part):** CIPC name fix, D-U-N-S number, then Apple and Google accounts as myHaul (Pty) Ltd. Order and details in docs/STORE.md. [Ofentse]
- **Before the store upload:** fill in the company details in `terms.html` and `privacy.html`; set up help@myhaul.co.za; make the reviewer account (docs/STORE.md). [Lehloma, Ofentse]
- **Security open items** in docs/SECURITY.md: team two step sign in, CAPTCHA at sign up, backups. [Lehloma, Ofentse]
- **Web host and domain:** connect the repo to Netlify (`netlify.toml` is ready), set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` there, point myhaul.co.za at it. This gives the privacy and help pages, WhatsApp previews and links that open the app. [Ofentse]
- **Links open the app:** put the Apple Team ID in `public/.well-known/apple-app-site-association` and the Play signing SHA256 in `assetlinks.json`; turn on Associated Domains and Push in Xcode. [Lehloma]
- Developer accounts, Google's 12 tester 14 day closed test, reviewer test account. [Ofentse]
- Apple and Firebase keys for push (the sender is built), PUDO and Courier Guy accounts for real lockers and tracking. [Lehloma]
- Then: shop reviews on shop pages, search filters (size, price, area), video cover and trim, seller stats, invite a friend, live selling.

## Known issues and risks

Debug as we go: anyone who finds or fixes a problem updates this list. Highest risk first.

| # | Issue | Risk | Fix / owner |
| --- | --- | --- | --- |
| 1 | Live server functions `delete-account`, `suggest-listing` and the updated `checkout` are not deployed yet (the database is up to date). Delete account, photo suggestions and offer checkout won't work live until then. | High | `npm run check:functions`, then deploy. [Lehloma] |
| 2 | The live (Supabase) side of the app has never been run end to end. Tests run in demo mode; this workspace can't reach supabase.co. | High | After 1, click through every flow on the live project with two accounts. [Lehloma] |
| 3 | Server functions type check needs Deno. | Low | Works here with `npx deno@2.1.4`; all pass as of 2026-11-01. |
| 4 | Only tested in Chrome's engine. Safari (iPhone) not automated. | Medium | Test on Ofentse's iPhone every round; add WebKit to the tests on a machine that has it. |
| 5 | iPhone videos are often HEVC (.mov): fine on iPhone, may not play on Android or Chrome until Mux converts them. | Medium | Add Mux keys; all uploads then play everywhere. [Lehloma] |
| 6 | Chats refresh every 3 seconds instead of live updates; typing indicator only works in the demo. | Low now, cost at scale | Supabase Realtime for messages and typing. |
| 7 | "Liked", "Reposted", "Following reposts" and chat cards only find items in the first 50 of the feed (live). The For You feed itself now loads more as you scroll. | Low now | Server function that returns posts by id. |
| 8 | Bundles: a return refunds the whole bundle (no partial returns yet). | Medium for sellers | Decide the rule, then build partial returns. [CONFIRM] |
| 9 | Rude word filter may block innocent Afrikaans words ("naai" also means sew, "moer" a nut). | Low | Review the list with a native speaker. [CONFIRM] |
| 10 | Saved replies are stored on the phone, not the account. | Low | Move to the database later. |
| 11 | Sound starts after the first tap in a browser (browser rule). | Low | Native app plays with sound straight away. |
| 12 | Push to buyers and sellers is built (`push-notifications`, migration 0020) but needs the Apple and Firebase keys and the schedule. | Medium for launch | Add keys, schedule it. [Lehloma] |
| 13 | Terms and Privacy Policy are written with the company details. Still [CONFIRM]: house number on Tinderwood Crescent, launch date. The Information Officer must be registered with the Information Regulator. | High for store review | Fill in, lawyer confirms. [Ofentse] |
| 14 | Share previews and "open in app" links only work once the site is on myhaul.co.za with the Team ID and SHA256 filled in. Until then links open the web version. | Medium | See Next up. [CONFIRM domain] |
| 15 | Ranking by interests is simple (picked categories first, mixed with others). | Low | Lehloma's engine replaces `rankFeed` in `lib/rank.ts`. |
| 16 | The PUDO locker list is sample data, so lockers are switched off. | Low while off | PUDO API account, then turn on. [Ofentse] |

Fixed in this round: Safari double back on the edge swipe (now only in the installed app), deleting an account now also deletes the person's photos and videos, React Router warnings.

## Log

### 2026-11-07: Design pass, buyer offers, Message button

- Design: birthday at sign up is now three big centred wheels (day, month, year) with a clear "You're 27" or "18 or older" answer. Welcome screens are see-through over the real feed, a few words each with a small animated picture, and end in a small pointing hand that swipes up on a loop. Chat bubbles have a subtle liquid glass rim and sheen. Sheets are solid enough to read (they were see-through), pop up messages are compact pills at the top, and text on bright videos has a stronger shadow and darker bands top and bottom.
- Buyer offers (migration 0031, like Vinted and Depop): Make an offer from the item details or as a suggested chip in chat. Three suggested prices (10, 15, 20% off, rounded) or your own. Rules on the server: at least R50, under the listed price, at least half, one waiting offer per item, 5 a day per chat, Buy now items only. Seller gets Accept, Counter (sends their own special price and declines the offer) or Decline; both sides get a notification. An accepted offer is payable for 24 hours. Seller special prices also start at R50 now.
- Message button: right on every video next to Buy now, and Message seller plus Make an offer side by side in the item details.
- Tests: database tests for every offer rule; the app test now offers, accepts and checks out at the offer price.
- Live: migration 0031 and the server functions need Ofentse's OK to deploy. [Claude]

### 2026-11-06: Mux Robots

- Added to `docs/VIDEO_EDITING.md`: Mux Robots (AI jobs on our videos, 100,000 free units a month). Best fits: moderation on every upload, cover suggestion, listing details from the video, suggested haul tags and flaw marks for the seller to confirm, captions.
- Mux token must include Robots when Ofentse creates it.

### 2026-11-06: Video editing research, round two (TikTok Shop is the competitor)

- Ofentse: trim only isn't enough; the timeline (gallery clips joined into one video) matters, and TikTok Shop is the real competitor, so we must be different.
- `docs/VIDEO_EDITING.md` rewritten: TikTok basics (timeline with camera and gallery clips, trim, reorder, cover, sound, text) plus what TikTok Shop doesn't have: tag several items in one video (haul mode), flaw marks buyers can jump to (ties to not as described protection), live price and stock stickers, a "Filmed in myHaul" badge, and data light editing. No AI avatars or music library.
- Built as an edit list (clips plus marks saved as data, played by the app), not a re-rendered video. One file export later (AVFoundation on iPhone, Mediabunny or a server).
- Still research only; waiting for Ofentse's answers and go ahead.

### 2026-11-06: Video editing research (no build yet)

- Ofentse wants basic editing between Retake and Next. Research and plan in `docs/VIDEO_EDITING.md`: what TikTok, Reels, Whatnot, Depop and Poshmark offer, a first version of 4 tools (trim, cover, sound on or off, one line of text), and how to do each without re-encoding on the phone (Mux clipping for trim; cover, mute and text saved as settings and drawn by the app).
- Waiting for Ofentse to say build, and to answer the 3 questions at the end of that file.

### 2026-11-06: Your own posts look like yours

- Ofentse could tap Message seller and Follow on his own posts. Now, like Depop (Edit on your own listing), Vinted (Bump) and TikTok (no Follow on yourself):
  - Video: "Your post" label instead of Follow, no Repost, and a "Your listing" bar (stock, bids or sold out, taps to your orders) instead of Buy now or Hold to bid.
  - Item details: "This is your listing" note; no Message seller or buyer protection; the sheet's footer is the same Your listing bar.
  - The ... menu on your post or shop: My orders and My shop, no Report or Block.
  - Your shop page: "This is your shop, as buyers see it" with Manage my shop and My orders instead of Follow and Message.
  - Explore: "Your shop" instead of Follow. Messaging your own shop says it's yours instead of opening a chat.
- `apps/web/src/lib/mine.ts` (useMyShopId, useIsMine) is the one place that knows which shop is yours.
- Gap found: sellers can't edit, pause, mark sold or delete a listing yet. Next to build. [Claude, Ofentse]

### 2026-11-06: Special prices start at R50

- The special price sheet in chat accepted R10 and up, which TradeSafe would refuse at checkout. It now needs R50 or more and says why, and says when the price is above the listed price.

### 2026-11-06: Full screen on the iPhone home screen

- Added Apple's home screen app settings (apple-mobile-web-app-capable, black-translucent status bar, title). Added to the home screen, myHaul now opens full screen and draws behind the clock and battery.
- Pages, the profile and the team dashboard now leave room for the notch (safe area at the top). In Safari itself nothing changes.

### 2026-11-06: Instant payment feedback

- Ofentse wants "Paid" to show straight away. Three layers now:
  1. TradeSafe's message (seconds after paying), now matched by transaction id.
  2. When the buyer lands back on My orders or the order page, the app asks the server to check with TradeSafe straight away, then every 4 seconds for 3 minutes, and again whenever the app comes back to the front (`check_payment` in order-action, buyer or team only, at most 300 checks an hour).
  3. The server's own sweep of recent unpaid orders (every 15 minutes, proposed every 5).
- The order page says "Already paid? This updates by itself within a few seconds."
- Waiting for Ofentse's OK to deploy checkout, order-action, escrow-webhook, run-due, and to run run-due every 5 minutes. [Claude]

### 2026-11-06: First real sandbox payment, and matching payments to orders

- First live test payment went through: R60 order paid with Ozow, TradeSafe shows "Funds Received & Cleared".
- But the order stayed unpaid in myHaul: TradeSafe gave the payment its own reference code (TTSWKQPG) instead of our order number, so our server couldn't match its messages to the order and ignored them (safely).
- Fixed: the payment message is matched by TradeSafe's transaction id (saved at checkout), falling back to our order number. We still ask TradeSafe for the real state before marking anything paid.
- Backup: every 15 minutes, unpaid orders from the last day are checked with TradeSafe and marked paid if the money is in.
- Live escrow-webhook, run-due and checkout need redeploying with these (waiting for Ofentse's OK). [Claude]

### 2026-11-06: TradeSafe minimum, R50 lowest price

- First live test checkout (R25 item, collection) failed: TradeSafe refuses payments under about R49 ("value must be at least 42.6086956522", which is R49 with VAT).
- Lowest listing price is now R50 (was R20). Checkout also refuses any order under R50 with a clear message, since special prices and bundles can go lower than a listing.
- If TradeSafe turns an order down, checkout now cancels it straight away instead of leaving it unpaid.
- Live checkout function needs redeploying with this (waiting for Ofentse's OK). [Claude]

### 2026-11-06: Email sign in link brings you back to where you were

- Ofentse signed in on /team with the email code and landed in the app instead. The sign in email can carry a link, and that link always went to the home page. Now it goes back to the page you started from (like /team), only on our own site; Supabase also checks it against the allowed addresses.
- Typing the 6 digit code on /team already kept you on /team.

### 2026-11-06: Moving the web app to Cloudflare Pages

- Found the reason the site looked old: Netlify's free plan gives 300 credits a month and every update costs 15 (about 20 a month). We used them all, so Netlify skipped the last 23 updates and the site was stuck on 4 November (8034e43). If the credits hit zero the whole site goes offline.
- Ofentse chose Cloudflare Pages: free, about 500 updates a month, no traffic charges.
- Ready in the repo: `apps/web/public/_headers` (same security headers as netlify.toml), `functions/i/[key].ts` and `functions/s/[key].ts` (WhatsApp link previews, tested), `.nvmrc` (Node 22). Single page routing needs nothing extra on Cloudflare.
- Fixed while moving: the security headers blocked the phone's location, so "Near me" in the locker search could never work. Now allowed for our own site only.
- Cloudflare settings: root directory blank, build command `npm ci && npm run build:live`, output `apps/web/dist`, variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public).
- Live at https://myhaul.pages.dev (Cloudflare project `myhaul`, builds from main). Checked: serves e8cc2b6, security headers, location allowed, deep links, .well-known as JSON.
- Pointed at the new address (done in Ofentse's browser with his OK): `APP_URL` secret (health check confirms), Supabase Site URL `https://myhaul.pages.dev` with redirect URLs for both the new and old address, TradeSafe sandbox app website, success, failure and OAuth redirect links. TradeSafe's callback to Supabase left as it was.
- Netlify is no longer used. Its free credits are spent; nothing more is charged.

### 2026-11-06: Version line in the menu

- The bottom of the menu now says which update the app is running, like "Version 0.1.0+62b259e, updated 6 Nov, 19:05". The 7 letters match the newest commit on GitHub, so anyone can check the Netlify site is up to date.
- Checked: Netlify's exact build (`npm ci && npm run build:live`) passes on a clean copy of main. The wallet button only shows once someone has a reward, so seeing it with nothing in it means the site is running an old build.
- [CONFIRM] Netlify is still building from main on every push (Ofentse to check Deploys in Netlify).

### 2026-11-06: Everything deployed to live

- Ofentse approved: "Yes, deploy everything to live".
- Live database: 0027 (live check fixes), 0028 (Bob Go delivery), 0029 (delivery perks), 0030 (stamps count INSTANT_EFT as well as OZOW).
- Server functions deployed: run-due, escrow-webhook, checkout, order-action, seller-bank, mux-upload, mux-webhook, and new delivery (locker search) and bobgo-webhook. The two new ones were deployed with only the code they use (same behaviour as the repo).
- TradeSafe sandbox health check: sign in ok, our own account found, all 9 banks mapped, savings and cheque, ID type NATIONAL, payouts IMMEDIATE. Pay methods TradeSafe lists include OZOW and INSTANT_EFT, so both now earn stamps.
- Not set yet: Bob Go key and webhook secret, Mux token and webhook secret. Courier, locker and Mux paths stay off until then and the app says so plainly.
- [CONFIRM] TradeSafe's transaction state names (the health check used the wrong enum name, harmless). Questions for TradeSafe still open: agent accept, buyer texts, refunds after delivery, saved cards, volume rates.
- `scripts/push-live.mjs` knows the new live migration versions.

### 2026-11-06: Delivery perks (Instant EFT stamps, big order delivery)

- Ofentse asked for incentives instead of only a tip, sustainable, with a minimum if it makes sense ("do whatever works out best"). Built:
  - **Stamps:** every Instant EFT (Ozow) order of R200 or more earns a stamp once its return window closes. 5 stamps = half price delivery (up to R45) on a courier or locker order. Cost works out to about R6 per Ozow order; Ozow saves us about R4 against card on a R350 order (more against SnapScan) and clears straight away. The R200 minimum stops tiny orders farming stamps.
  - **Big orders:** half price delivery from R1,000, free locker from R1,500, where our margin covers it.
  - Perks don't stack (the best one wins), only on deliveries we book, never more than the delivery fee, and pause when this month's R10,000 perk budget is used.
- Money: the buyer pays less, the seller gets the same, we fund it inside escrow (like the R50 reward); escrow still balances (tested for every mix).
- Migration 0029: `orders.delivery_discount_cents`, `delivery_perk`, `payment_method` (our server reads it from TradeSafe's `transaction { deposits { method } }`, as their plugin does); `delivery_stamps`; stamps used at order save (or the order is refused), given back on cancel or refund, earned on completed; notifications "Delivery stamp 3 of 5" and "Half price delivery unlocked".
- App: the Instant EFT tip shows the stamps (5 dots) on orders of R200+; the price list shows the perk; a hint from R700 that R1,000 gets half price delivery; the wallet shows stamps; receipts show the perk. Terms section 8 updated.
- [CONFIRM] TradeSafe's exact code for Ozow in `deposits.method` (we match "ozow" in it).
- Not live yet (needs 0028, 0029 and the functions deployed).

### 2026-11-06: Payment costs and the Instant EFT nudge

- Compared fees from Ofentse's screenshots. PaySafe South Africa (paysafe.co.za, an escrow service, not the international Paysafe) has a R100 minimum plus R15 per settlement: R115 on a R350 order, so it's out for us. No public API found either. Staying with TradeSafe.
- TradeSafe rates (before VAT): Instant EFT through Ozow 1.5%, normal EFT 0.75% (slow to clear), card 2.5%, SnapScan 3.5%, PayJustNow 5.25%. We pay these out of our cut (feeAllocation AGENT). On a R350 card order we earn R33 and pay about R10; with a founding seller on 0% fee we earn only R12, so SnapScan can cost us money.
- Checkout now nudges Instant EFT (Ozow): confirmed straight away so the seller can ship today; a normal transfer can take up to 2 days. Card and SnapScan still work. We can't preselect the method (it's chosen on TradeSafe's page).
- [CONFIRM] with TradeSafe: any minimum fee per transaction, and lower rates at volume.

### 2026-11-06: TradeSafe checked against their real API, connections reviewed

- Ofentse asked whether TradeSafe is set up. Honest answer: the code was written but never run against a real account, and its request shapes were guesses marked [CONFIRM]. Checked them against TradeSafe's API spec and their own open source WooCommerce plugin.
- Fixed: the payment callback read the wrong place (TradeSafe sends reference and state at the top level, not inside "data") and needed a transaction id it doesn't send, so real payments would have been ignored. Now it accepts both shapes, matches on our order id and asks TradeSafe for the real state.
- Fixed: bank codes were guesses (like "SBSA"). Now looked up from TradeSafe's own list (UniversalBranchCode, BankAccountType, IdType, PayoutInterval), like their plugin; an unknown bank is refused, not guessed. Sellers' payouts set to Immediate.
- Added: the GraphQL address defaults to live (sandbox is set by TRADESAFE_API_URL), time limits on every call, a reason on refunds, https only payment links, later paid states count as paid, a TradeSafe dispute raises an urgent alert and holds the payout, and a failed payout alerts the team once.
- Mux: ids from the notice are checked before use; uploads only from our own app's addresses.
- Reviewed and fine: post and media rules (only your own uploads), Bob Go, push, alerts, photo suggestions.
- Tests: 4 new TradeSafe tests run our code against a pretend TradeSafe (13 server tests in all).
- [CONFIRM] questions for TradeSafe are in docs/SETUP.md section 2. The big one: may we accept delivery as the agent?

### 2026-11-06: Delivery details at sign up, one tap checkout

- Ofentse's idea: collect what checkout needs once, with Skip for now. Sign up now ends with "Where should we send your orders?": to my door (name, cell, street, suburb, city, province, postal code) or a locker near me, saved to the account.
- Checkout uses saved details: the right delivery option is picked and the details show on one line with Change, so Buy now is one tap. The save switch only shows when something new was typed ("Save for next time, so checkout is one tap" or "Update my saved details"), right under the details, before paying.
- Menu > Settings > Delivery details to change or remove them.
- Payment method can't be saved: TradeSafe's public docs show no saved cards or preselected method; the buyer picks Instant EFT, card or SnapScan on TradeSafe's page each time. [CONFIRM with TradeSafe whether they offer card tokens or a preselected method.]

### 2026-11-06: Delivery through Bob Go

- Decided with Ofentse: **myHaul books** every courier and locker parcel through Bob Go (Ofentse has an account). Delivery is priced by the **parcel size** the seller picks when listing, so big parcels can't sink us: Small (up to 2 kg) R90 door / R60 locker, Medium (up to 5 kg) R120 / R80, Large (up to 15 kg) R180 door only. Bigger is collection only. Bundles take the biggest item, and 3 or more items are at least Medium.
- The delivery fee now stays with us to pay Bob Go (before, it went to the seller). Escrow: our share is our fees plus the courier money. Bakers who deliver themselves still get their fee.
- Wrong size: if the courier weighs a parcel heavier than the size allows and charges extra, the extra comes off that seller's payout (in the Terms). Any booking that costs more than the buyer paid alerts the team.
- Migration 0028: `products.parcel_size`; order booking fields; `shop_pickup` (seller's pickup address, private); `shipment_events` (tracking); payout sum changed to item + delivery - kept - fee.
- Server: `_shared/bobgo.ts` (mock, sandbox, live), checkout prices by size and checks the locker with Bob Go, order-action books on ship (once, a retry reuses it) and gives the label, new `delivery` function (lockers near you or a city), new `bobgo-webhook` (HMAC signed, then confirmed by asking Bob Go), run-due checks tracking every 15 minutes as a backup.
- App: parcel size step when listing; checkout with street, suburb, city, province and postal code, prices by size, a real locker picker; seller pickup address on To ship; "Book courier and mark shipped", then "Print courier label"; tracking steps for buyer and seller; test label page.
- Terms: Bob Go delivery, parcel size rule, and fixed the seller fee wording (6% of the item price only, which is what the app always charged).
- Not live yet: migration 0028 and the new functions need deploying (Claude's live apply was blocked pending Ofentse's yes; the web app is made safe without it: the feed doesn't ask for parcel size and listing falls back), and Bob Go keys in Supabase secrets (docs/SETUP.md, section 4). Start in Bob Go's sandbox.
- [CONFIRM] Bob Go's status names (we read "delivered" and a delivered time); check them in the sandbox.

### 2026-11-05: Hold to bid

- Bidding happens on the video now, like Whatnot but with a hold instead of a swipe. Left: **Custom** (opens the bid sheet with the amount box ready). Right: **Hold to bid R720** (the next minimum step).
- Hold for 3 seconds (changed from 5 on Ofentse's call): a thin amber Liquid Glass ring closes around the button, with a light tick each second and a firm "done" haptic when it closes, then "Bid placed" in green. Let go early and nothing happens. Works with a thumb, a mouse, or holding Space or Enter. The hold time is one setting (`HOLD_MS` in `components/HoldToBid.tsx`).
- The bid sheet (from Custom or the item details) uses the same hold button.
- Messages ("You're the top bidder", "Welcome") now drop in at the top and let taps through. Before, they sat on top of the Pay and Bid buttons at the bottom.
- e2e: holds like a thumb would; letting go early doesn't bid; a full hold bids without leaving the video; Custom starts in the amount box.

### 2026-11-05: App Store and Google Play prep

- docs/STORE.md rewritten with the rules as checked today: Apple builds need Xcode 26 or later (since April 2026) and the new age rating questions; Google targets API 36 (we already do); iPhone screenshots at 6.9 inch (ours are 1320 x 2868).
- Decision proposed: company developer accounts as myHaul (Pty) Ltd, not personal [CONFIRM with Ofentse]. Google organisation accounts skip the 12 testers for 14 days rule, and both stores then show the company as the seller. Needs a D-U-N-S number, which needs the CIPC name fixed first.
- Step by step order with owners and times is at the top of STORE.md. Estimate about 4 to 6 weeks to submission if the accounts start this week [CONFIRM].
- Screenshots: the framed set is good, but the raw screens use drawn placeholders and one shows "demo". Retake with real sellers before submitting. Claims to confirm: bakers "certified", "our Cape Town pickup point".
- "Live shopping" removed from the Apple keywords until live selling ships.

### 2026-11-05: Read only check of live

- The sandbox can't reach the live site or API (network allow list), so the check ran inside the live database as a signed out visitor and as an ordinary signed in user, reading only.
- Passed: every table has access rules; signed out visitors can only write error reports (capped); both views are locked; storage buckets are right (packing proof and ID files private, videos and avatars public); all 23 team functions refuse non team members; reward functions can't be called directly.
- Found and fixed in migration 0027 (tested locally, NOT yet applied to live, waiting for Ofentse's yes):
  1. Signed out visitors could ask whether any two people had blocked each other.
  2. Every media row was public, including packing proof rows, which show the order number and the seller.
  3. Reviews showed which buyer bought from which shop, to anyone.
- Low, left as is [CONFIRM]: a held item shows the user ID of the buyer it's held for; likes and reposts show who liked what (like TikTok's public likes).
- Not checked: website headers and the built app files (the site couldn't be reached from here).

### 2026-11-05: Live Supabase updated

- Database updates 0017 to 0026 applied to live through the Supabase connector (0026 is new: pins the search path on 4 helpers the Supabase security check flagged).
- All 11 server functions deployed live with their sign in settings: checkout, order-action, delete-account, seller-bank, mux-upload, suggest-listing need a signed in person; run-due, escrow-webhook, mux-webhook, team-alerts, push-notifications check their own secret.
- Schedules live: run-due every 15 minutes, team-alerts every 5 minutes, push-notifications every minute.
- `scripts/push-live.mjs` now knows updates 1 to 26 are live, so a laptop push won't run them twice.
- Security check after the push: no tables open without rules. Remaining warnings are expected (public read helpers like the feed and shop pages are meant to be callable signed out; trigger functions can't be called directly), plus pg_net in the public schema (Supabase default) and leaked password protection being off (a dashboard switch).
- Not done: making Ofentse a team member (blocked for Claude, one SQL line in Next up), and the payment secrets.

### 2026-11-05: Pushing to live

- Checked live (read only): database at 0016; 7 of 11 server functions deployed (old versions); run-due scheduled; 1 account, no team member yet.
- New `npm run push:live` (scripts/push-live.mjs): lines up the update history (the first 16 updates were recorded live under other version numbers), shows the updates, asks, pushes 0017 to 0025, then deploys all functions. Then paste scripts/after-push.sql in the SQL Editor (schedules and making yourself a team member).
- Test payments (TRADESAFE_MODE=mock) are now refused only on myhaul.co.za, so the Netlify test site can test checkout.

### 2026-11-05: Attacker style security review, swipe lesson

- Welcome now ends with a TikTok style "Swipe up for more" lesson over the feed. Swiping it away (or scrolling, or the down arrow on a laptop) starts the first video the ranking picked; there's no Get started button.
- Four reviewers attacked local copies as attackers would (database, server functions, app and hosting, fraud). 22 holes found and closed: see docs/SECURITY.md section 10. Biggest: packing proof could be faked with empty rows; trust and rewards could be farmed with cheap fake orders; a stolen seller account could redirect payouts; suspended sellers were still paid; two payers for the last item hurt the seller; rate limits could be dodged by backdating.
- Changes to the rules decided earlier, for safety: rewards are only earned on courier or locker orders with tracking (not collections) [CONFIRM with Ofentse]; trust and the 5 good orders for auctions only count orders of R100 or more, once per buyer.
- TradeSafe: only "funds received" (cleared) counts as paid, per TradeSafe's own docs.
- Packages upgraded and pinned (react-router 7, vite 6, vitest 4): `npm audit` shows 0 vulnerabilities. `.npmrc` sets legacy-peer-deps because of an npm bug with vitest 4's optional add-ons. Server functions pinned by `supabase/functions/deno.lock`.
- Open: apply 0025 live after 0017 to 0024 and redeploy checkout, order-action, run-due, seller-bank, mux-upload, team-alerts, escrow-webhook. [Lehloma]

### 2026-11-04: Surprise rewards replace the welcome credit

- Decided with Ofentse: no credit at sign up (that rewards making accounts, which gets farmed). The first order is full price.
- **R50 surprise** the first time each of these is delivered: a Buy now or made to order purchase, an auction win, a sale (sellers get credit to shop with). It appears as a surprise when the order is delivered, with a push notification and a one time celebration screen.
- Usable once that order's return window closes ("R50 soon", then "R50 off"). If the order is returned or refunded, the reward is removed. One reward per order of R200 or more, taken by itself at checkout. A reward used on a cancelled or refunded order comes back.
- Never advertised: the welcome slide, the signed out wallet button, the store listing text and the Terms promise nothing. Terms section 8 now says rewards are at our discretion, have no cash value and are removed if the order is returned.
- Abuse guards: the earning order must be R100 or more [CONFIRM amount]; R15,000 budget caps rewards given; a shop can take 5 reward orders in 30 days; suspended accounts and the "Surprise rewards" switch off get none. The database picks which reward is used, and one reward can only be on one order.
- Migration 0024 (rewards table, grant on delivery, ready on completion, forfeited on refund; welcome_credit_ok now means "has a ready reward"; budget alert counts rewards given). Team sees rewards on the account page, History tab.
- Open: apply 0024 live after 0017 to 0023. [Lehloma]

### 2026-11-04: Packing proof before shipping

- Decided with Ofentse: every order (courier, locker and collections) needs packing proof before it can be shipped or handed over: one video in the app, 15 seconds to 2 minutes, showing the order's packing code (like MH 4821, written on the parcel), the item from every side with flaws and labels, the item going in and the parcel sealed; plus a photo of the sealed parcel with its label. No approval from us.
- Enforced by the server and the database (migration 0023): the seller's own files, uploaded after payment. The Ship button stays locked until both are in.
- Strikes: the team marks a video "Doesn't follow the rules" with a reason the seller sees. 1st a warning, 2nd loses 5 trust points (new trust event `packing_strike`, migration 0022), 3rd in 90 days pauses listing (the "Listing items" switch). A missing or unclear video loses the seller a dispute (Terms of Use section 7).
- Spot checks: about 1 in 20 shipments from the last 2 weeks show in To do, Packing checks. The proof also opens from Returns and from every order on Orders.
- Kept 6 months after delivery (longer while a return is open), then run-due deletes the files and records. Buyers get it only by emailing us; the team copies links that expire in 7 days. Views and shares are in the activity log.
- Terms, Privacy Policy and the seller rules at shop opening are updated.
- Bug fixed: the private storage bucket only took photos and PDFs up to 10 MB, so packing videos were refused. Now up to 100 MB with video types. [CONFIRM the Supabase plan allows 100 MB files: the free plan stops at 50 MB.]
- Open: apply 0022 and 0023 live after 0017 to 0021; redeploy order-action and run-due. [Lehloma]

### 2026-11-04: Navigation round (app and dashboard)

- App tab bar has labels: Home, Explore, +, Inbox, Me. Activity is now **Inbox** (`/inbox`): Messages first, then Updates. One count on the tab (unread chats plus new updates), and it opens on Updates when only updates are new. Pull down to refresh. Old `/activity` links redirect.
- Orders left the Inbox. Their one home is My orders (profile button and menu). Order updates still arrive in Updates.
- Me tab gets a red dot when a seller has orders to ship. Seller tools (List an item, To ship, Payouts) live only on the profile; the menu has one My shop row. Menu grouped: Shopping, Settings, Privacy and legal, Team.
- Welcome credit button says "R50 off" in words and disappears once the credit is used (no more "R0"). Signed out people still see it.
- Dashboard: search on every page (people by name, @handle, email or shop; orders by item or number). Menu grouped: Overview, To do, then Look up (Accounts, Orders, Listings, Money) and System (App errors, Activity log).
- One **To do** page replaces Alerts, Seller checks, Reports and Returns: filters for reports, checks, returns, late orders and top ups; handling an item clears it everywhere. Alerts we sent are listed at the bottom. Opening To do marks alerts seen. Old addresses redirect.
- Account page has tabs: Overview, Orders, Features, History. Features shows only switches someone changed, with Show all.
- Store screenshots regenerated with the new tab bar.
- Decided with Ofentse: one To do page; seller tools on the profile only; hide the wallet at R0.

### 2026-11-04: Feature switches per account

- Every account page on the dashboard (/team/accounts, open a person) has a Features section. Each feature is Auto (the normal rules and milestones), On or Off: buying, bidding, comments, messages, welcome credit, listing items, auctions, live selling, special prices in chat, shown in the feed, payouts.
- On only skips a milestone: auctions before 5 good orders, Live early access before it's released, the feed under trust 40, payouts for Restricted sellers. Legal and safety checks (ID, bank, food certificate, designer proof, 18+, suspensions) can never be skipped, so the other features can only be turned off.
- The database enforces every switch (migration 0021), so a changed app can't get around it. The app reads them to unlock auctions in Create and show Live mode early. The person gets a notification when something is turned off; the reason is only for the team. Every change is in the activity log.
- Payouts off holds what is already scheduled straight away; back on pays it from today.
- Bug fixed: on the live database, sellers could not create any auction ("permission denied", the end time and reserve were not allowed on a new listing). Fixed in 0021.
- The list lives in `packages/core/src/accountFeatures.ts`. A new feature needs a line there, in the 0021 check lists and in a trigger.
- Open: apply 0021 live after 0017 to 0020. [Lehloma]

### 2026-11-04: Company registered

- myHaul (Pty) Ltd registered with CIPC on 3 November 2026, registration number 2026/885697/07. Private company, financial year end October. Directors: Shupulu Ofentse Choshane and Lehloma Moloi. Registered office in Kempton Park, Gauteng.
- Terms of Use and Privacy Policy now carry the registration number, registered office and directors. Disputes go to the Magistrates' Court for the district of our registered office (was Cape Town).
- Open: the certificate spells Ofentse's name "OFENTSO"; ask CIPC to correct it before opening the bank, TradeSafe and Apple accounts. [Ofentse]

### 2026-11-04: Ready for the first store upload

- Live selling is hidden everywhere (no Live tab, no Live mode in Create) behind `VITE_LIVE`. Locker delivery is hidden behind `VITE_LOCKERS`, and the server refuses lockers unless `PUDO_ENABLED=true`, because the locker list is still sample data.
- Full Terms of Use (`public/terms.html`, in the app at /terms) written on South African law: Consumer Protection Act, ECTA (including the cooling off rules), POPIA, Counterfeit Goods Act, Foodstuffs Act for bakers. Covers escrow, fees, welcome credit abuse, auctions, returns, seller rules, liability and disputes. Privacy page renamed Privacy Policy, 18+ only, linked to the terms. Only company facts are left as [CONFIRM] (registration number, address, directors, start date). A lawyer should confirm before launch.
- Menu has Terms of Use, Privacy Policy and Contact us (help@myhaul.co.za [CONFIRM mailbox]). Help has a "Still need help?" section.
- Phone notifications for everyone: migration 0020 (`pushed_at`) and the `push-notifications` job, every minute, one push per person per run. Uses the same Apple and Firebase keys as team alerts.
- Chat safety: the "pay outside the app" warning now catches account numbers, bank names, cash on delivery, proof of payment and PayPal, with a Report this chat button.
- Reviewer account steps and notes in docs/STORE.md, and a fresh checklist.
- Store screenshots: six framed screens on white, `apps/web/store/screenshots/apple-6.9` (1320 x 2868) and `google-phone` (1080 x 1920). Rebuild with `node apps/web/e2e/store-frames.mjs`.
- Open: migrations 0017 to 0020 live, deploy and schedule the functions, secrets, company details in the terms, domain and support mailbox. [Lehloma, Ofentse]

### 2026-11-04: New logo, app icon and splash

- New myHaul logo drawn from scratch as vectors (our own artwork, not a Canva element): grey, black and two green shopping bags with a small myHaul print on each, light from the top left with soft shadows, and the name in Poppins ExtraBold. Colours are the app's own tokens.
- App icon: bags with the name (option B) until people recognise the bags; Ofentse plans to switch to bags only after about 3 months [CONFIRM]. All iPhone and Android sizes, the Android adaptive icon and a white splash screen are generated from `apps/web/assets/`. Web icon, link preview image (`og.png`) and Google Play icon and feature graphic updated.
- `brand/` holds the logo source, masters and colour codes, with steps to change the logo or switch the icon.

### 2026-11-02: Team alerts on phone, Telegram and email, and a summary three times a day

- Migration 0019 `alerts`: `team_alerts` (each alert once, team only) and `check_alerts()`: new reports, seller checks waiting (including a changed bank account), orders late to ship, returns waiting, welcome credit budget past 80%, credit bursts, shops with many credit orders, top ups due and error spikes. Every team member also gets each alert as an app notification.
- New server function `team-alerts` (every 5 minutes): sends new alerts to the team's phones (one notification per run), Telegram and email, whichever have secrets set. New `_shared/push.ts` sends phone notifications: Android through Firebase (FCM v1), iPhone through Apple (APNs); dead tokens are removed. This also closes the "nothing sends push yet" gap: order notifications can use it next. docs/SETUP.md step 9.
- Dashboard: Alerts page with a count in the menu, urgent banner on Overview. Counts refresh every minute while open.
- Scheduled task "myHaul team check" (Claude, on the founders' plan): reads the live database at 06:42, 12:42 and 20:42 and pushes a short summary. Read only, no personal data.
- An AI reviewer was built and then removed at Ofentse's request (no API costs wanted).
- Tests: database alert tests; push signing tests (Apple and Google); functions type checked; end to end test covers alerts.
- Open: apply 0017, 0018 and 0019 live; deploy and schedule team-alerts; add the phone, Telegram and email secrets.

### 2026-11-01: Security review and hardening

- New `docs/SECURITY.md`: every risk we know of, what stops it, and its status. Rules for every new feature. AGENTS.md points to it.
- Found and fixed (migration 0018 `security`):
  - Welcome credit could be claimed many times by opening several checkouts before paying. Now one credit per account (unique index, can't be raced), finished accounts only, a R15,000 budget and at most 5 credit orders per seller in 30 days, all in the database (`app_limits`, `welcome_credit_ok`, `orders_money_guard`).
  - Buying from your own shop is now blocked in the database too.
  - Newer tables gave signed out visitors full write rights (Supabase default). All removed; truncate, triggers and references removed for everyone; each table grants only what the app uses. New tables and functions are now locked by default.
  - Reserved usernames could be deleted by anyone. Locked.
  - People could edit messages sent to them. Now only "read" can change.
  - Changing a bank account after it is set needs our team again, and the seller is told (account takeover protection).
  - Flood limits on messages, comments, reports, new chats, bids, offers and error reports. AI suggestions limited to 30 a day per seller.
  - Upload size and type limits on every bucket.
  - Team Money page shows warning signs on each top up (new buyer, same phone as seller, collected in person, seller near the limit, order not finished).
- Server: payments refuse to run unless `TRADESAFE_MODE` is set (test mode can't be left on by accident); the payment callback compares its secret safely and asks TradeSafe for the real state before marking anything paid [CONFIRM TradeSafe query fields]; safe secret compare in the scheduler.
- App: redirects after sign in and notification links only go to pages inside myHaul. Security headers and a Content Security Policy in netlify.toml (tested: nothing the app needs is blocked). Supabase client and React Router updated (high severity advisories fixed).
- Tests: database tests try each cheat (double credit, budget, self buy, rights, message edits, floods, usage limits, bank change); all pass. Server functions type checked with Deno for the first time; all pass. End to end test passes.
- Open (see SECURITY.md): two step sign in for the team, CAPTCHA at sign up, backups (Pro plan), alerts for unusual credit use.

### 2026-11-01: Team dashboard

- New `/team` dashboard replaces the old Team screen (`/admin` now goes there). Side menu on a laptop, slide in menu and card tables on a phone. Menu counts show what needs doing.
- Migration 0017 `team_dashboard`: `suspensions` table (private: only the person and the team can read it), triggers that stop a suspended account from ordering, bidding, messaging, commenting, starting chats, making offers, listing or posting; `admin_actions` log, filled by the new functions and by triggers on seller checks, reports, listings, top ups and return decisions; functions `admin_overview`, `admin_people`, `admin_person`, `admin_suspend`, `admin_unsuspend`, `admin_set_shop_status`, `admin_set_role`, `admin_orders`, `admin_listings`, `admin_log`. All check `is_admin()`.
- Rules: a reason is needed to suspend, pause or close (the person sees it). You can't suspend yourself or a team member, or change your own role. Opening a shop needs the ID and bank checks approved.
- Profile shows "Your account is suspended" with the reason.
- Demo: two new sample people (Thabo, a buyer, and Zola, a seller waiting for her ID check) and one open report, so the dashboard has something to show. Team view: sign in with an email starting with "admin".
- Tests: database tests for every new rule; the end to end test now runs the dashboard (overview, top up, reports, approve an ID, suspend, log, suspended person sees why).
- Open: apply 0017 live and make @shups a team member (both need Ofentse's approval in the chat).

### 2026-10-30: Timed auctions
- **Sellers** (after 5 good orders, as the rules already said): Create a listing, Price step, pick **Auction**: starting bid, optional reserve, 1, 3, 5 or 7 days, one size. Locked with the reason shown until unlocked.
- **Buyers:** amber **Bid · R700** button and "Auction · 1d 2h left" chip in the feed. The bid sheet shows the top bid, a countdown, reserve met or not (never the amount), quick amounts and your own amount, and the last 5 bids with names masked (t***a).
- **Rules** (database `place_bid`, migration 0016, same numbers in `packages/core/src/auction.ts`): steps of R10 under R500, R20 under R2,000, then R50. A bid in the last 2 minutes adds 2 minutes (no sniping). No bidding on your own item, from a blocked shop, before finishing your account, while under review, or after two unpaid wins in 90 days. Sellers can't change price, reserve or end time once people have bid.
- **The end** (`settle_auction`, run by `run-due` every 15 minutes and also by the app when the clock hits zero): top bid at or above the reserve wins and gets 2 hours to pay through the normal escrow checkout at the winning bid; otherwise the item goes back to the seller's drafts. An unpaid win is cancelled, costs the winner trust points, and the seller can list it again. Outbid, won and sold notices are sent.
- `/i/<item>` links for auctions open the item directly, so a winner can pay from the notice.
- Demo: a sample auction (90s denim jacket, Luxe Resale, reserve R900). Demo data key is now `lsa-demo-v4` (demo data resets once).
- Server functions changed: `checkout` (only the winner pays, at the winning bid) and `run-due` (closes auctions). Deploy both after `npm run check:functions`. [Lehloma]
- Not yet: auctions inside a live stream, seller relisting button (an ended auction sits in drafts), auction history on the shop page.

### 2026-10-30: Proper accounts (like Instagram and TikTok)
- **Create account** after the email code (`components/AccountSetup.tsx`): 1) birthday as an age check (18 and over; the date isn't saved, only that it was confirmed), 2) name and a unique @username, checked while typing with a green tick or the reason, plus free suggestions from the name, agreeing to the terms on the button, 3) profile photo (optional, cropped square on the phone). Whatever you tapped before signing in (buy, like, follow) carries on after.
- **Usernames:** 3 to 30 lowercase letters, numbers, dots and underscores; no dot at the start or end or two in a row; at least one letter; reserved words blocked (admin, myhaul, support and so on). Usernames and shop handles share one list, so nobody can take another person's name as a shop. Change once every 30 days. Rules in `lib/handle.ts` and the database (`handle_problem`, `set_username`, `complete_account`, migration 0015).
- **Profile photos** in a public `avatars` bucket (your own folder only). Shown on your profile, the menu, comments, the feed and shop pages. Deleting an account removes the photo.
- **Edit profile:** photo (change or remove), name, username with the live check and the 30 day rule, bio.
- Opening a shop suggests your username as the shop handle.
- Existing accounts without a username get the Create account steps the next time they open the app.
- Not yet: public profile pages for buyers (`/u/username`), photos in the chat list, @mentions. [Next]

### 2026-10-30: Live web version on Netlify
- Live app: https://myhaul-app.netlify.app (Netlify project `myhaul-app`, builds from `main` on every push, public Supabase URL and anon key set in Netlify). The site is set to Private in Netlify for now: only Ofentse's Netlify account can open it until "Make public" is clicked.
- Supabase Site URL set to https://myhaul-app.netlify.app.
- Supabase's built in email can't be edited without our own email sender (SMTP), so sign in emails carry a link, not a 6 digit code. The sign in screen now says to tap the link. It also only sends to people on the Supabase team, a few per hour. Before launch: set up an email sender such as Resend on myhaul.co.za and add `{{ .Token }}` to the Magic link email. [Ofentse]
- Fixed: Netlify treated the preview helper's test file as a server function (moved to `apps/web/netlify/lib`). The For You feed shows "No videos yet" instead of a blank screen when there are no posts.

### 2026-10-30: Live database up to date
- Migrations 0009 to 0014 applied to the live Supabase project. It now has comments, messages, reports, blocks, offers, holds, device tokens, saved delivery, interests, error reports and share previews.
- The live project records them under the times they were applied (for example `20261030142734_flow`), not the file names in `supabase/migrations`. Before the next `supabase db push`, Lehloma runs `supabase migration repair` to mark 0009 to 0014 as applied, so they aren't run twice.
- Removed `supabase/update-live-database.sql` (no longer needed).

### 2026-10-30: Live database: 0009 and 0010 applied
- Public likes and reposts (0009) and listing photos (0010) are on the live project. 0011 stopped at a Supabase confirmation that timed out; nothing changed. `supabase/update-live-database.sql` now holds 0011 to 0014.

### 2026-10-30: Faster flow, error reports, share previews, welcome, saved delivery
- **Sign in without losing your place:** Like, Follow, Buy, Comment, Message and Wallet open a sign in sheet over the screen, then finish the action (Buy now goes straight to checkout). The code signs in by itself at 6 digits; "Send again" added. `withUser()` in `session.tsx`.
- **Welcome on first open** (`components/Welcome.tsx`): three short screens (swipe or Next, Skip) and an interest picker (Thrift, Designer, Hair and beauty, Bakes). Interests are saved on the phone and the account (`profiles.interests`) and order For You via `lib/rank.ts`, the seam for Lehloma's engine. Not shown when someone arrives on a shared link.
- **Checkout:** remembers delivery details (private `delivery_details` table) and shows them as one line with Change; "Save for next time"; the Pay button says what's missing ("Pick a size", "Pick a locker", "Add delivery details") instead of failing.
- **Error reports** (`lib/report.ts`, `components/ErrorBoundary.tsx`): crashes show "Something went wrong on this screen" with Try again and Go home, and are logged to `app_errors` (no personal details; kept 30 days). Team > App errors lists them.
- **Share previews:** items share as `/i/<item>`. On the web host, a Netlify edge function (`apps/web/netlify/edge-functions/share.ts`) answers WhatsApp and other apps with the item's picture, title and price (`share_card` function in the database). Default preview image `public/og.png`.
- **Links open the app:** `.well-known` files, Android intent filter, iOS entitlements, `appUrlOpen` handling. Notification taps now open the screen without reloading. Placeholders: Apple Team ID, Play SHA256, domain [CONFIRM].
- **Notifications** are asked for after a first paid order or message, not at sign in (more people say yes; Apple's advice).
- **Smaller fixes:** Explore items open the item (not the shop); search matches every word, descriptions and sizes; the feed search button opens search ready to type; wallet button shows a Wallet sheet; For You loads more as you scroll; order page has "Order placed", Message the seller, and star rating with an optional comment; sellers see orders to ship first with the ship by time, and can copy the address or locker.
- Migration 0014 (`delivery_details`, `profiles.interests`, `app_errors`, `share_card`, account deletion clears them) with tests. `supabase/update-live-database.sql` combines 0009 to 0014 for pasting into the live project.
- Tests: core, database and end to end (now with welcome, sign in sheet to checkout, shared item link, wallet) all pass.

### 2026-10-30: myHaul phone apps (Capacitor) and store readiness
- Decisions (Ofentse): wrap the current app with **Capacitor** for iPhone and Android; app name **myHaul**; **personal** developer accounts for now. Lehloma is focused on the ranking algorithm.
- `apps/web/ios` and `apps/web/android` added (Capacitor 8). App ID `za.co.myhaul.app` [CONFIRM before first upload]. iPhone only, portrait only, Android API 36.
- Phone features (`src/native.ts`): splash, status bar, Android back button (closes sheets first), native share sheet with public links, light haptics on like and repost, push notification registration (tokens saved in `device_tokens`, migration 0013; sending needs Apple and Firebase keys).
- Permission texts for camera, microphone, photos and notifications; export compliance flag set.
- Placeholder **icon and splash** (green shopping bag with a play button) in all sizes; store images in `apps/web/store/` (icons, Google feature graphic, iPhone 6.7" and Android screenshots via `node e2e/store-shots.mjs`).
- **Public pages** for the stores in the web build: `/privacy.html`, `/support.html`, `/delete-account.html`. Support email set to help@myhaul.co.za [CONFIRM].
- **Reviewer sign in:** "Sign in with a password" on the sign in screen, for the test account the stores need.
- Privacy page now says 18 and over [CONFIRM].
- `.github/workflows/android.yml` builds an Android test APK on every push.
- New `docs/STORE.md`: listing text, age rating and privacy answers, permissions, the rules we meet, reviewer notes, build and submit steps, and the to do list.

### 2026-10-30: Live database update still pending
- Checked the live project: it has migrations up to 0008 (likes and reposts). 0009 to 0012 are not applied.
- Applying from Claude was cancelled twice by the approval step. Fallback: run the combined file (migrations 0009 to 0012 in one transaction, in order) in Supabase SQL Editor, or `supabase db push` from Lehloma's machine.

### 2026-10-30: Debug pass
- Ran every journey while collecting browser errors: no app errors; only expected test noise (blocked fonts, the test browser can't play iPhone video).
- Fixed: edge swipe back could go back two screens in Safari, so it now only works in the installed app (Safari has its own); deleting an account now also deletes the person's photos, videos and ID files; React Router future warnings.
- Added a "Known issues and risks" table above, to keep debugging as we go.
- The tests now report browser console errors, warnings and failed requests at the end of every run.

### 2026-10-30: Swipes, and selling inside chats
- **Swipes** (`components/gestures.ts`): drag any sheet down to close it; swipe in from the left edge to go back on inner screens; swipe left or right to change tabs on the profile, shop pages and Activity; swipe the menu to the right to close it; swipe between Camera, Create and Live; swipe left on a video to open the shop (like TikTok). Photo slideshows keep their own sideways swipe.
- **Chat message box** is a glass bubble with a + button.
- **Buy now on the item card** in a chat (buyers), straight into checkout.
- **Order updates in the chat:** orders between that buyer and shop show in the conversation with their current status, and open the order.
- **Special price (offer):** seller taps + > Send a special price, picks one item or several (a bundle), sets a price (never above the listed total) and how long it lasts (6, 24 or 48 hours). The buyer sees the card and taps "Buy for R…"; checkout charges that price and stays in escrow. Server checks it in `checkout` (offer belongs to the buyer, still open, not expired).
- **Bundles:** an offer with several items becomes one order, one delivery fee; all items' stock goes down when paid (`orders.bundle_product_ids`).
- **Hold an item:** seller holds an item for that buyer for 2, 6 or 24 hours; others see "On hold" and checkout refuses them. Paying releases the hold.
- **Photos in chat:** + > Send a photo (stored privately; only the two people in the chat can open it).
- **Saved replies** for sellers: one tap to send, edit the list (saved on the phone for now).
- **"Usually replies within …"** on shop pages and in the chat header (median first answer time, last 60 days).
- **Typing indicator** in the chat (demo shows it before a sample shop replies; live needs Supabase Realtime presence, next).
- **Push notifications** need the native app (Lehloma) or web push keys; not built yet. In app notifications already cover new messages and offers.
- Database: migration 0012 (offers, make_offer, message photos and offers, holds, bundles, reply time). Tested locally. Not yet applied to the live project, with 0009 to 0011. [Open]
- Demo: sign in as **lebo@shop.demo** to try the seller side of chats.

### 2026-10-30: Item in chats, sizing pass
- "Message seller about this" (item sheet) and Message in a post's menu now attach the item: the chat opens with "Asking about [item]" above the box and quick questions (Is this still available? What sizes do you have? Can I see more photos? When can you ship?). The first message carries the item as a card (picture, title, price, Sold out if gone) that opens the item in the shop. Database: `messages.product_id` (must be from the chat's shop), in migration 0011.
- Sizing pass: the menu was squashing rows (Returns and help, Privacy, Data saver cut in half); scrolling columns no longer shrink their rows. Feed product strip is slimmer (title 13px, price 14px, smaller picture). Checkout size buttons smaller.
- Ideas for chat suggested to Ofentse: Buy now on the chat card, seller custom price or offer, order updates inside the chat, photos in chat, saved replies, "usually replies in" badge, hold an item, bundles.

### 2026-10-30: Back buttons everywhere
- Added Back to Returns and help, My orders, the test payment page, Team and Page not found.
- One back rule for the whole app (`useGoBack` and `BackButton` in `components/ui.tsx`): go to the previous screen; if the screen was opened directly (a link or a refresh), go to a sensible screen instead. Shop pages, chats, the post screen's X, shop sign up and seller screens all use it. Added to docs/UX.md.

### 2026-10-30: Smooth progress bar
- The bar now moves every frame straight from the video (requestAnimationFrame and a GPU transform) instead of on the browser's time updates, which only come about 4 times a second. It glides now, in the demo and the real app.

### 2026-10-30: Sound always on, cleaner feed, glass progress bar
- Sound is always on, like TikTok; the phone's volume buttons control it. The sound button is gone. Browsers only allow sound after the first tap, so a video can start silent until then, and that first tap turns sound on instead of pausing. A native app can play with sound straight away.
- Comments moved beside the item, next to like and repost (three small glass buttons). The row under it is just Buy now and Share.
- The progress bar is Liquid Glass: a 3px frosted track with a soft glowing fill; while dragging, a small glass bubble shows where you are.

### 2026-10-30: Report, block, delete account, privacy; comments and messages
- **Report:** "…" on every post and shop page, and on comments and chats. Reasons: fake or counterfeit, not as shown, scam or pay outside the app, offensive, spam, other. Reports are private. The Team screen has a "Reports to check" queue with Remove (or Close shop) and Dismiss; aim to answer within 24 hours.
- **Block:** from a post, shop page or chat. Blocked shops vanish from your feed, and neither side can message or comment. Menu > Blocked accounts lists them with Unblock.
- **Delete my account:** Menu > Delete my account, type DELETE. Open orders must finish first. Removes name, bio, posts, comments, likes, follows and chats and the sign in; keeps order and payment records (5 years, by law). Server function `delete-account`.
- **Privacy and terms** page (Menu, and `/privacy`) with contact details, POPIA rights, community rules and buying rules. Draft: company details, support email and Information Officer still [CONFIRM], and a lawyer should review.
- **Filter:** rude words are blocked in comments and messages (same list in the app and the database). Chat warns when someone shares a cell number or asks to pay by EFT or outside the app.
- **Comments:** comment button with a count next to Buy now; a sheet to read and add; delete your own (sellers can delete on their posts); report others. Seller comments get a "Seller" tag. The seller is notified.
- **Messages:** "Message seller" in the item sheet, the post menu and shop pages. Activity > Messages lists chats with unread counts; each chat has the "keep payments in the app" tip, report and block. New messages notify the other side. Demo shops reply once so you can see it work.
- Video: removed the time readouts (it only shows while you drag the bar).
- Database: migration 0011 (blocks, reports, comments, conversations, messages, rude word filter, admin_handle_report, forget_user). Tested locally with `npm run test:db`. **Not yet applied to the live project**, with 0009 and 0010. Functions `delete-account` and `suggest-listing` not yet deployed. [Open]

### 2026-10-29: Sleeker player, gestures, demo videos, benchmark
- Progress bar is a thin 2px line; the dot only appears while you drag (then it grows a little so you can see where you are). No big dot while playing.
- Gestures: hold anywhere for 2x speed (a "2x" chip shows), double tap the left side to go back 10 seconds, the right side to go forward 10 seconds.
- Three made up demo videos with music and captions (`apps/web/src/assets/demo/`: tee, cake, runner), made from our drawn scenes, so the player can be tested in the demo. About 250 KB each.
- New `docs/BENCHMARK.md`: feature comparison with TikTok, Instagram, Whatnot, Vinted and Depop, and how close we are to a full closed loop.

### 2026-10-29: Video player, slideshow, store readiness
- Fix: the "Open a shop?" question now closes when you tap Yes (it stayed on screen over the shop set up).
- Video player like TikTok (`apps/web/src/components/Video.tsx`): plays when on screen, tap to pause or play (big play button with time), sound button (top right, remembered on the phone; phones only allow sound after a tap), a bar at the bottom you can drag to rewind or skip, and the time left. Video tiles on profiles and shops show the length ("0:45").
- Photo posts with several photos are a slideshow: swipe, dots and "1/3", moving on by itself every 4 seconds until you swipe.
- The product strip on the feed shows the real photo or video frame for uploaded posts.
- Demo uploads are saved in IndexedDB so they still play after a reload.
- Ofentse's two sample clips (TikTok downloads of another creator) were used for local testing only and are not in git or the preview, because they are someone else's content. Note: iPhone clips are often HEVC (.mov); Safari plays them, other browsers may not. In the real app Mux converts every upload, so all phones can play them.
- New `docs/LAUNCH.md`: App Store and Google Play rules, timelines and a December plan. Must build before submitting: Report, Block, Delete account, privacy policy, native shell.

### 2026-10-29: Several photos, suggestions from the photo, drafts
- **Several photos:** Create's first page takes up to 10 items: a cover (video or photo) plus photos. Tap a photo to make it the cover, X to remove, Add or Camera for more. Only the cover can be a video. Extra photos show in the item sheet on the feed. Migration 0010 adds `listing_photos` (public for live items, sellers add only to their own items and folder, max 10). Tested locally.
- **Suggestions from the photo:** on "What are you selling?" the app reads the cover and suggests a title, type, condition, price and description. "Use these" fills them in; everything stays editable. Server function `suggest-listing` calls Claude (`claude-haiku-5-5`, change with `SUGGEST_MODEL`). It needs the `ANTHROPIC_API_KEY` secret in Supabase; without it the app quietly skips suggestions. No brand names in suggested titles. Demo mode shows a labelled example, not a real reading.
- **Drafts:** Create saves as you go on this phone (text in localStorage, photos and video in IndexedDB). Opening Create again offers "Continue your draft?" with Continue or Start over. Posting clears it.
- **Not yet on the live project** (Ofentse cancelled the approval this time): migration 0009 (public likes and reposts), migration 0010 (listing photos) and the `suggest-listing` function. [Open]

### 2026-10-29: Sellers only, and Create in steps
- Only sellers can post. Tapping + without an open shop asks "Open a shop?" with "Yes, open my shop" and "No, not now". No closes the question and changes nothing. Opening `/post` directly asks the same.
- Create is now one step at a time (`apps/web/src/screens/seller/Create.tsx`): first page is the photo or video (camera or gallery), then 1 What are you selling (title, type, condition or proof), 2 Price and stock (price with "You get R…", stock stepper, size chips; food: allergens), 3 Tell buyers more (caption and description, optional, can skip), 4 Check and post (edit any row).
- After the first page the Camera, Create, Live switch and the X hide. Back (top left) goes one step back and keeps what you typed; on the first page the switch comes back. A photo from Camera starts Create at step 1.
- Replica and brand checks now run on the title step.
- New `docs/UX.md`: rules for how screens should feel, from research on multi step forms and selling apps. AGENTS.md points to it.

### 2026-10-29: Posting: Camera, Create and Live
- The + tab opens a new post screen (`/post`, `apps/web/src/screens/seller/Post.tsx`) with Camera, Create and Live at the bottom, like TikTok. The app's tab bar hides there; X closes it.
- **Camera** opens the phone camera: gallery on the left, shutter in the middle, flip on the right. Tap for a photo, press and hold for a video until you let go. Length limit picker: 15 seconds, 1 minute or 3 minutes (recording stops at the limit, with a red ring). Then Retake or Next, which carries the photo or video into Create.
- **Create** is the listing form (title "Create a listing"), now taking a photo or a video. Photos are stored as image media (no Mux) and show as photo posts in the feed.
- **Live** has a Go live button. It checks stock first: at least 5 items in stock, or 5 of one item (live Buy now listings only; made to order food does not count). Without it: "You can't go live without stock" and a Create a listing button. It also still applies the existing rule of 5 good orders before going live. Live streaming itself is coming next.
- New core rule: `MIN_LIVE_STOCK`, `liveStock()`, `goLiveBlockers()` in packages/core with tests.
- Camera note: the phone preview inside Claude may not be allowed to open the camera; it then offers the gallery. In the real app or a hosted link, Safari asks for camera access.
- Open: keep the 5 good orders rule for going live, or go live on stock alone? [CONFIRM]

### 2026-10-29: Lower tab bar
- The floating tab bar sits much lower with only a little float (5px from the bottom, or just above the iPhone home bar) and is a bit slimmer, so more of the video shows. Feed buttons, toasts and screen padding follow it through `--tab-bottom` and `--tab-space` in styles.css. Asked for in a comment on the phone preview.

### 2026-10-29: Glass price bubbles
- Prices on the 3 across grids (profile, shop pages) now sit in a small clear glass bubble instead of a dark fade. Asked for in a comment on the phone preview.

### 2026-10-29: Posts, Likes and Reposts tabs; reposts in Following
- Profile tabs are now Posts, Likes and Reposts (Seller renamed Posts; the Buyer tab is gone, Orders has its own page).
- Empty Posts tab prompts: "Open your shop to post" (no shop), "Finish opening your shop" (half done), or "Post your first item" (shop open, nothing listed).
- Likes and reposts are public. Shop pages now use the same layout with Posts, Likes and Reposts. Tapping any tile opens the full screen player at that video.
- Following feed now includes what the shops you follow reposted, marked "Reposted by @shop".
- Migration 0009 makes likes and reposts readable by everyone (people can still only add or remove their own). Tested locally. **Not yet applied to the live project**: the Supabase connector asked for approval and timed out. Apply `supabase/migrations/20261029000009_public_reactions.sql` next session. [Open]
- Demo data key bumped to `lsa-demo-v3` (fresh sample data, including a sample repost by Lebo's Thrift).

### 2026-10-29: Likes and reposts
- Feed: a heart (like) and a repost button now sit beside the product card, with counts (1.2K style). Buy now and Share stay on the row below.
- Profile, Buyer tab: three small switches, Bought, Liked and Reposted, each with its own grid.
- Database: migration 0008 adds `post_reactions` (each person sees and changes only their own) and `post_counts()` (counts only, never who). Applied to the live project and covered by `npm run test:db`.
- For the engine: likes and reposts are new ranking signals. Suggested weight order: Buy now, then Browse and Share, then likes and reposts, then views. [CONFIRM]
- Demo posts start with sample like and repost counts so the feed looks real.

### 2026-10-29: Profile numbers, bio, rating, lighter screens
- Profile numbers sit beside the photo and no longer change between tabs: Posts, Sales, Following (in that order). Orders and Credit removed from the profile (Orders has its own page, the wallet shows credit).
- Added a bio (up to 150 characters, edit with the pencil). Migration 0007 adds `profiles.bio`, applied to the live project.
- Added a seller rating bubble out of 5 with one decimal: green when good, red at the bottom, colours in between, black "0.0" when there are no ratings yet. Shown for sellers only.
- Standing is now a small green pill next to the handle.
- The Seller | Buyer tabs now sit right under the bio and only change the buttons and the grid.
- Orders pages show a tiny total order count under the page picker.
- Explore category buttons no longer squash. The feed's dark fade at the bottom is lighter, and small product pictures crop to the product instead of the dark floor.
- Reposts and likes: Ofentse asked for both (built in the next entry).

### 2026-10-29: Handover for any AI and for Lehloma
- Added "How far we are" and "Run the current version" to this log, and `npm run status`, which prints where we are, what's next, the latest work and the current version.
- Added instruction files for Copilot, Cursor and Windsurf next to CLAUDE.md, AGENTS.md and GEMINI.md. All point to this log and tell the tool to log its own work.
- Added `npm run build:phone` for a one file version of the app.

### 2026-10-29: Profile like TikTok, smaller everything
- Profile rebuilt in the TikTok layout Ofentse showed: pencil, wallet, share and menu at the top; small avatar, name, handle; three numbers; one line; small capsule buttons; then a Seller | Buyer tab strip and a 3 column grid.
- Decision: the header stays the same on both tabs. Only the numbers, the line under them, the buttons and the grid change. Seller: Sales, Live items, Trust, items grid. Buyer: Following, Orders, Credit, bought items grid.
- Trust details and the Following list moved into sheets, opened by tapping the number. Shop checklist is a single collapsible card.
- Made oversized parts smaller across the app: icon buttons, wallet chip, Explore shop cards and tiles.

### 2026-10-28: iPhone first and demo media
- Built for iPhone first: removed the demo bar, dropped the separate Browse button (tap the product to see details), one line captions, smaller top controls, no arrow rail on touch screens, 16px inputs so iOS does not zoom.
- Added drawn product shots with slow camera movement behind feed videos, and the same pictures on Explore, shop, checkout and order rows.
- e2e now runs at iPhone size (393 x 720, touch, 3x).
- Added this log and CLAUDE.md so any Claude account can continue without priming.

### Earlier (summary)
- Liquid Glass redesign to match the prototype, with the design rule in docs/DESIGN.md.
- Full R50 welcome credit with seller top ups (migration 0005). Scheduler secret in Vault (0006).
- Shared rules, database with row level security, escrow, payouts and returns, web app with demo mode, end to end test.
- AYEF report (separate, in claude.ai): 16 pages including payouts and refunds.

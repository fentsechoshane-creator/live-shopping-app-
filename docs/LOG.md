# Project log

Shared memory for everyone working on this repo: Ofentse, Lehloma and any AI tool (any Claude account, ChatGPT, Gemini, Copilot, Cursor). Newest entries first in the Log section. Keep entries short.

**Ask any AI:** "Read docs/LOG.md and tell me how far we are and what's next." **Or run** `npm run status`.

**Rule for every AI and person:** after each piece of work, add a dated entry to the top of the Log, update Current state and Next up, and commit it with the work.

## How far we are

| Area | Status |
| --- | --- |
| Business rules (fees, credit, returns, payouts, trust) | Done and tested |
| Database, security rules, server functions | Done. Live database fully up to date (0001 to 0014). Server functions still to deploy [Lehloma] |
| Seller side (sign up, checks, listings, orders, payouts) | Done in the web app |
| Buyer side (feed, Explore, checkout, orders, returns) | Done in the web app |
| Design (Liquid Glass, iPhone first, TikTok style profile) | Done, keeps improving |
| Real payments (TradeSafe escrow) | Built, waiting for sandbox keys [Lehloma] |
| Real video (Mux) | Built, waiting for keys [Lehloma] |
| Sign in by code on the live project | Waiting for 2 Supabase settings [Ofentse] |
| Mobile app (iPhone and Android) | Built with Capacitor. Android test build on GitHub; iPhone needs a Mac with Xcode |
| Chat, offers, holds, comments | Done |
| Timed auctions | Built (migration 0016), live database needs it; checkout and run-due functions to deploy [Lehloma] |
| Live streams | Not started (shown as "coming next") |
| Error reports, share previews, welcome, saved delivery | Done (previews need the web host) |

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
- Welcome credit: full R50 on a first order of R200 or more. If the credit is bigger than our cut, we top up the seller ourselves from the credit budget.
- Money is held by a registered escrow provider (TradeSafe). Sellers are never paid before the return window closes: Buy now 7 days, auction 2 days, food 1 day. Ship within 72 hours.
- Payout timing by trust tier after the window: Top next working day, Trusted 2 working days, Standard next Friday, Restricted held.
- Trust score starts at 50 (0 to 100). Tiers at 90, 70, 40.
- **Design rule for every version:** match `docs/design/prototype/` and use the Liquid Glass system in docs/DESIGN.md. Clean, uncluttered, iPhone first.

## Current state

- Buyer: welcome screens with interests on first open, feed (For you ranked by interests, loads more as you scroll; Following; Live), Explore with word search, item sheet, checkout that remembers delivery details, orders with returns and ratings, activity, chats with offers and holds.
- Signing in happens in a sheet over the current screen and then finishes what you tapped (like, follow, buy, message). The code signs in by itself once 6 digits are in.
- Profile: TikTok style page with Posts, Likes and Reposts.
- Seller: onboarding, Create in steps with drafts and photo suggestions, Camera, Live (locked until ready), orders to ship (most urgent first, copy address), payouts.
- Team (admin): reports, checks, returns, top ups, app errors.
- Phone apps: Capacitor in `apps/web/ios` and `apps/web/android`. Links to items and shops open the app once the domain is set up.
- Ranking: `apps/web/src/lib/rank.ts` is where Lehloma's engine plugs in.
- Tests: `npm test` (core), `npm run test:db` (security rules on local Postgres), `npm run test:e2e` (full journey, iPhone size, screenshots in `apps/web/e2e/shots`).

## Next up

- **Server functions:** deploy `delete-account`, `suggest-listing` and `checkout` after `npm run check:functions`. The live database is up to date. [Lehloma]
- **Web host and domain:** connect the repo to Netlify (`netlify.toml` is ready), set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` there, point myhaul.co.za at it. This gives the privacy and help pages, WhatsApp previews and links that open the app. [Ofentse]
- **Links open the app:** put the Apple Team ID in `public/.well-known/apple-app-site-association` and the Play signing SHA256 in `assetlinks.json`; turn on Associated Domains and Push in Xcode. [Lehloma]
- Developer accounts, Google's 12 tester 14 day closed test, reviewer test account. [Ofentse]
- Push sending function (Apple and Firebase keys), PUDO and Courier Guy accounts for real lockers and tracking. [Lehloma]
- Then: shop reviews on shop pages, search filters (size, price, area), video cover and trim, seller stats, invite a friend, live selling.

## Known issues and risks

Debug as we go: anyone who finds or fixes a problem updates this list. Highest risk first.

| # | Issue | Risk | Fix / owner |
| --- | --- | --- | --- |
| 1 | Live server functions `delete-account`, `suggest-listing` and the updated `checkout` are not deployed yet (the database is up to date). Delete account, photo suggestions and offer checkout won't work live until then. | High | `npm run check:functions`, then deploy. [Lehloma] |
| 2 | The live (Supabase) side of the app has never been run end to end. Tests run in demo mode; this workspace can't reach supabase.co. | High | After 1, click through every flow on the live project with two accounts. [Lehloma] |
| 3 | Server functions can't be type checked here (no Deno). | Medium | `npm run check:functions` on Lehloma's machine before deploying. [Lehloma] |
| 4 | Only tested in Chrome's engine. Safari (iPhone) not automated. | Medium | Test on Ofentse's iPhone every round; add WebKit to the tests on a machine that has it. |
| 5 | iPhone videos are often HEVC (.mov): fine on iPhone, may not play on Android or Chrome until Mux converts them. | Medium | Add Mux keys; all uploads then play everywhere. [Lehloma] |
| 6 | Chats refresh every 3 seconds instead of live updates; typing indicator only works in the demo. | Low now, cost at scale | Supabase Realtime for messages and typing. |
| 7 | "Liked", "Reposted", "Following reposts" and chat cards only find items in the first 50 of the feed (live). The For You feed itself now loads more as you scroll. | Low now | Server function that returns posts by id. |
| 8 | Bundles: a return refunds the whole bundle (no partial returns yet). | Medium for sellers | Decide the rule, then build partial returns. [CONFIRM] |
| 9 | Rude word filter may block innocent Afrikaans words ("naai" also means sew, "moer" a nut). | Low | Review the list with a native speaker. [CONFIRM] |
| 10 | Saved replies are stored on the phone, not the account. | Low | Move to the database later. |
| 11 | Sound starts after the first tap in a browser (browser rule). | Low | Native app plays with sound straight away. |
| 12 | Push: phones register and we ask after a first order or message, but nothing sends yet. | Medium for launch | Sending function with Apple and Firebase keys. [Lehloma] |
| 13 | Privacy page has placeholders (company, support email, Information Officer). | High for store review | Fill in, lawyer review. [Ofentse] |
| 14 | Share previews and "open in app" links only work once the site is on myhaul.co.za with the Team ID and SHA256 filled in. Until then links open the web version. | Medium | See Next up. [CONFIRM domain] |
| 15 | Ranking by interests is simple (picked categories first, mixed with others). | Low | Lehloma's engine replaces `rankFeed` in `lib/rank.ts`. |
| 16 | The PUDO locker list is sample data. | High for launch | PUDO API account. [Ofentse] |

Fixed in this round: Safari double back on the edge swipe (now only in the installed app), deleting an account now also deletes the person's photos and videos, React Router warnings.

## Log

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

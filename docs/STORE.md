# myHaul in the App Store and Google Play

Everything needed to submit, in one place. Items marked [CONFIRM] need a decision or a real detail first.
Rules checked against Apple's and Google's current requirements on 5 November 2026.

## Step by step, in order

The slow parts are the accounts and the business number, not the app. Start those first; the rest can run alongside.

| # | Step | Who | How long |
| --- | --- | --- | --- |
| 1 | Fix the company name at CIPC if it's still wrong. The D-U-N-S number and both store accounts must match the registered name exactly. | Ofentse | Depends on CIPC [CONFIRM] |
| 2 | Get a free D-U-N-S number for myHaul (Pty) Ltd (use Apple's look up tool first, it may already exist). | Ofentse | Up to about 2 weeks |
| 3 | Domain myhaul.co.za on Netlify, mailbox help@myhaul.co.za. Both stores check the website and the support email, and Apple uses the domain to confirm the company. | Ofentse | 1 to 3 days |
| 4 | Apple Developer Program as an organisation (USD 99 a year). Needs the D-U-N-S number, the website, and someone who can sign for the company. | Ofentse | A few days after step 2 |
| 5 | Google Play Console as an organisation (USD 25 once). Needs the D-U-N-S number and company documents. | Ofentse | A few days to 2 weeks for checks |
| 6 | Live click through with two real accounts, then fix what breaks. | Ofentse, Lehloma | 1 week |
| 7 | Keys: TradeSafe sandbox (for review), Mux, Apple push key, Firebase, Resend for sign in emails. | Lehloma | 1 week |
| 8 | Founding sellers post real items with real videos. Reviewers must see a full feed, and the screenshots should be retaken from it. | Ofentse | 1 to 2 weeks |
| 9 | Reviewer account and Review Shop (see below). | Lehloma | 1 hour |
| 10 | Lawyer checks the Terms; Information Officer registered with the Information Regulator. | Ofentse | 1 to 3 weeks |
| 11 | Build and upload: TestFlight on iPhone, internal test on Android. Fix what testers find. | Lehloma | 1 week |
| 12 | Submit to both stores. | Lehloma | Apple usually 1 to 3 days; Google up to a week for a new account |

Realistic total if steps 1 to 5 start this week: about 4 to 6 weeks to submission [CONFIRM, depends mostly on CIPC, D-U-N-S and Google's checks].

## Why company accounts, not personal

- **Google:** personal accounts made after November 2023 must run a closed test with at least 12 testers for 14 days before they can publish. Organisation accounts don't have this rule.
- **Both stores** show the account name as the seller. A company account shows "myHaul (Pty) Ltd", not Ofentse's own name and details.
- **Trust:** a marketplace that holds buyers' money looks and is safer under a company. Apple asks for apps that handle money to come from a company.
- Moving an app from a personal account to a company later is possible but slow, so start as the company.
- If the D-U-N-S number takes too long, the fallback is a personal Google account plus the 12 testers for 14 days, then transfer later. [CONFIRM which route]

## The app

| | |
| --- | --- |
| Name | myHaul |
| App ID (both stores, permanent) | `za.co.myhaul.app` [CONFIRM before the first upload; it can never change] |
| Category | Shopping (secondary: Lifestyle) |
| Devices | iPhone only (no iPad), Android phones. Portrait only. |
| Price | Free |
| Accounts | Company accounts in the name of myHaul (Pty) Ltd (see above). |
| Icon and splash | `apps/web/assets/` (all sizes generated into `ios/` and `android/`) |
| Store images | `apps/web/store/`: icon 1024 and 512, Google feature graphic 1024 x 500, screenshots for iPhone 6.9 inch (1320 x 2868) in `store/screenshots/apple-6.9/` and Android (1080 x 1920) in `store/screenshots/google-phone/`. |
| Version | 1.0 (build 1) |
| Build rules met | iPhone: must be built with Xcode 26 or later (Apple rule since April 2026); the app supports iOS 15 and up. Android: targets API 36 (Android 16), the current Google Play rule. |

## Screenshots

Six screens on white with a short headline: shop on video, money held safely, auctions, chat with the seller, cakes from home bakers, sell from your phone. Made by `apps/web/e2e/store-frames.mjs` from the raw app screens in `store/screenshots/raw/` (made by `e2e/report-shots.mjs` with `SHOTS_OUT=store/screenshots/raw/ SHOTS_SIZE=440x956x3`).

Before submitting:
- **Retake the raw screens with real sellers' items and videos.** The current ones use the demo's drawn placeholders (a hanger, a tee). Real photos sell the app much better, and Apple wants screenshots to show the app as it really is.
- Screen 6 shows the label "Example suggestion (demo)". Retake it with a real photo suggestion so the word "demo" isn't visible.
- Screen 5 says bakers are "checked and certified". Keep "certified" only if we really check a food safety certificate. [CONFIRM]
- Screen 2 and checkout say "our Cape Town pickup point". Keep only if the pickup point exists at launch. [CONFIRM]

## Public web pages (both stores ask for these)

The web build (`apps/web/dist`) includes them, hosted on Netlify (`netlify.toml`), at myhaul.co.za once the domain points there [CONFIRM domain]:

- Privacy policy: `/privacy.html`
- Terms of use: `/terms.html`
- Support: `/support.html`
- Account deletion (Google requires a web link): `/delete-account.html`
- Support email: `help@myhaul.co.za` [CONFIRM: create the mailbox]

Netlify needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in its environment variables (public values only). This also gives:

- **WhatsApp and social previews** for shared items (`/i/<item>`) and shops (`/s/<shop>`), with picture, title and price.
- **Links that open the app** when it's installed. Fill in two placeholders first:
  - `apps/web/public/.well-known/apple-app-site-association`: replace `TEAMID` with the Apple Team ID (Apple Developer > Membership). [Lehloma]
  - `apps/web/public/.well-known/assetlinks.json`: the SHA256 from Google Play Console > App integrity > App signing. [Lehloma]
  - In Xcode, turn on **Associated Domains** and **Push Notifications** (the entitlements file is already there).

## Listing text

**Subtitle (Apple, 30 characters):** Shop sellers from short videos

**Short description (Google, 80 characters):** Shop South African sellers from short videos. Your money is held safely.

**Description:**

myHaul is a video marketplace for South African sellers.

Watch short videos from local shops: thrift, designer resale, beauty and home bakers. See something you like? Tap Buy now without leaving the video.

Your money is held safely by an escrow partner and only paid to the seller after your return window closes. Change your mind on a Buy now item? Send it back within 7 days of delivery.

• Buy straight from the video, or ask the seller a question in chat
• Bid on one of a kind finds in timed auctions
• Like, repost and follow the shops you love
• Sellers can offer special prices, bundles and holds in chat
• Every seller is ID checked, with a trust score you can see
• Fakes and replicas are not allowed
• Sell from your phone: take a photo or video, list it in a few steps, and get paid once the return window closes

Every order is filmed when it's packed, so you know what was sent.

**Keywords (Apple, 100 characters):** thrift,resale,secondhand,video shopping,auction,south africa,cape town,cakes,beauty,preloved,deals

"Live shopping" is left out on purpose: live selling isn't in this version, and Apple rejects keywords for features the app doesn't have. Add it back when live selling ships. Rewards aren't mentioned anywhere: they're a surprise.

## Age rating

Users post photos, videos and comments, and chat with each other. Purchases are of physical goods. Our terms say 18 and over.

- **Apple:** Apple moved every app to a new age rating system in 2026; answer the new questions in App Store Connect > App Information. Say yes to user generated content and messaging between users. Expect **18+**. [CONFIRM]
- **Google (IARC questionnaire):** users can interact and share content; no gambling, no violence; purchases are of physical goods. Target audience: 18 and over.

Auctions are buying real goods with a fixed price step, not gambling; answer "no" to gambling and simulated gambling on both.

## Privacy answers

**Apple privacy labels (Data Linked to You):** contact info (email, phone, name, delivery address); user content (photos, videos, messages, comments); identifiers (user ID, device ID for notifications); purchases (purchase history); financial info (sellers' bank details, held by the escrow partner); usage data (product interaction). **Tracking: No.** We don't track people across other companies' apps. Packing proof videos are kept 6 months, then deleted.

**Google data safety:** collects personal info (name, email, phone, address), photos and videos, messages, purchase history, app activity, device IDs. Data is encrypted in transit. Users can ask for deletion (in app and on the web). No data sold or shared for ads. Payment card info is handled by the payment provider (TradeSafe), never by us.

## Permissions and why

| Permission | Why (shown to the user) |
| --- | --- |
| Camera | Take photos and videos of items you sell, packing proof, and photos in chats |
| Microphone | Record sound with item videos |
| Photos | Choose photos and videos of your items |
| Notifications | Orders, messages and offers |

## Rules we meet

| Rule | How |
| --- | --- |
| Physical goods paid outside Apple and Google billing (Apple 3.1.3(e)) | Escrow checkout (TradeSafe). No in app purchases. Rewards are credit off physical goods, not a digital purchase. |
| User generated content (Apple 1.2, Google UGC policy) | Report on posts, shops, comments and chats; block; rude word filter; team review queue within 24 hours; contact details on the privacy and help pages |
| Delete account in the app (Apple 5.1.1(v), Google) | Menu > Delete my account, plus the web page for Google |
| Not just a website (Apple 4.2) | Native camera, notifications, share sheet, haptics, Android back button |
| No unfinished features (Apple 2.1, 2.3) | Live selling is hidden until it's built; sample PUDO lockers are hidden |
| Sign in with Apple | Not required: we only use email or phone codes, no Google or Facebook sign in |
| Export compliance | Only standard HTTPS: `ITSAppUsesNonExemptEncryption = false` is set |
| Apple build rule | Xcode 26 or later; app supports iOS 15 and up |
| Google target API level | Android API 36 |

## Test account for the reviewers

Apple and Google need a way to sign in. Our normal sign in sends a code, which reviewers can't receive, so the sign in screen also has "Sign in with a password".

1. Supabase > Authentication > Users > Add user > Create new user: email `review@myhaul.co.za`, a strong password, tick "Auto confirm user". [Ofentse or Lehloma]
2. Sign in with it once on the app and finish Create account: name "App Review", username `app.review`, birthday over 18. Don't make it a team account.
3. Open a shop on it called "Review Shop" (approve its ID check in the team dashboard) and post two or three items with videos, so reviewers can see the seller side.
4. Make sure real founding sellers have live listings: reviewers must see a full feed, never sample data.
5. In App Store Connect (App Review Information > Sign in required) and Google Play Console (App content > App access), give the email and password and paste these notes:

> myHaul is a marketplace for physical goods from independent South African sellers, so purchases use our escrow partner TradeSafe rather than in app purchase. Sign in: on the sign in screen tap "Sign in with a password" and use the account above. During review payments run in TradeSafe's sandbox, so no real money moves: any test card TradeSafe shows will work. Buyer side: tap Buy now on any video. Seller side: open Profile, then Selling, for the account's "Review Shop". User safety: Report and Block are in the more menu (three dots) on every video, comment, shop and chat; reports reach our team within 24 hours. Terms of Use and Privacy Policy are in the menu and accepted at sign up. Delete account: Menu > Delete my account. The app is for people aged 18 and over.

Payments during review: TradeSafe's sandbox must be switched on for the review build, then switched to live after approval. [CONFIRM with TradeSafe that sandbox and live can run side by side, or plan the switch]

## Build and submit

**Android** (any computer, or automatically on GitHub):
1. Every push to main builds a test APK on GitHub (Actions > Android test build > Artifacts). Install it on an Android phone to test.
2. For Google Play: create an upload key and keep it safe (losing it means asking Google to reset it), set it in `android/app/build.gradle`, run `./gradlew bundleRelease`, upload the `.aab` to an internal test first. [Lehloma]
3. With a company account, go from internal test to production when ready. With a personal account, run the closed test with 12 testers for 14 days first.

**iPhone** (needs a Mac with Xcode 26 or later, about an hour the first time):
1. `cd apps/web && npm install && npm run build:native && npm run open:ios`
2. In Xcode: sign in with the Apple developer account, pick the myHaul team, turn on **Push Notifications** and **Associated Domains**, then Product > Archive > Distribute to App Store Connect.
3. Test it with TestFlight first (Ofentse's iPhone and a few founding sellers), then submit for review.

**Every new version:** raise the version (`versionCode`/`versionName` in `android/app/build.gradle`, and the version and build in Xcode), then build again.

## Checklist before submitting

**Done:** company registered (2026/885697/07) and in the Terms and Privacy Policy; live database and all server functions up to date (5 Nov 2026); live selling and sample lockers hidden; Terms linked at sign up and in the menu; iPhone only; push notifications built; warning in chats about paying outside the app; Contact us in the menu; icon, splash, feature graphic, framed screenshots; delete account in the app and on the web; build settings meet both stores' current rules.

- [ ] CIPC name correction, then D-U-N-S number [Ofentse]
- [ ] Domain myhaul.co.za on Netlify, mailbox help@myhaul.co.za [Ofentse]
- [ ] Apple Developer and Google Play accounts as myHaul (Pty) Ltd [Ofentse]
- [ ] Make Ofentse a team member on live; apply the live check fixes (migration 0027) [Ofentse, Claude]
- [ ] Live click through with two real accounts [Ofentse, Lehloma]
- [ ] House number of the registered office in `terms.html` (search for CONFIRM); lawyer confirms the Terms [Ofentse]. Information Officer registered: done (Shupulu Choshane, 12 Nov)
- [ ] TradeSafe sandbox keys for review, live keys for launch [Lehloma]
- [ ] Mux keys, Resend for sign in emails [Lehloma]
- [ ] Push keys: Apple APNs key and Firebase service account; `aps-environment` set to production in the release build [Lehloma]
- [ ] Team ID and SHA256 in the `.well-known` files [Lehloma]
- [ ] Founding sellers with real listings; screenshots retaken from them [Ofentse]
- [ ] Reviewer account with "Review Shop" [Lehloma]
- [ ] Apple: new age rating questions, privacy labels. Google: data safety form, IARC questionnaire (18+), app access notes
- [ ] Decide the permanent App ID `za.co.myhaul.app` [Ofentse]

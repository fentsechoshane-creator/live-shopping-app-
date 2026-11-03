# myHaul in the App Store and Google Play

Everything needed to submit, in one place. Items marked [CONFIRM] need a decision or a real detail first.

## The app

| | |
| --- | --- |
| Name | myHaul |
| App ID (both stores, permanent) | `za.co.myhaul.app` [CONFIRM before the first upload; it can never change] |
| Category | Shopping (secondary: Lifestyle) |
| Devices | iPhone only (no iPad), Android phones. Portrait only. |
| Price | Free |
| Accounts | Personal developer accounts for now (Ofentse). Move to a company later. |
| Icon and splash | `apps/web/assets/` (placeholder design; all sizes generated into `ios/` and `android/`) |
| Store images | `apps/web/store/`: icon 1024 and 512, Google feature graphic 1024 x 500, screenshots for iPhone 6.7" (1290 x 2796) and Android (1080 x 1920). Regenerate with `node e2e/store-shots.mjs`. |

## Public web pages (both stores ask for these)

The web build (`apps/web/dist`) includes them. Host it on a domain, for example `myhaul.co.za` [CONFIRM domain]:

- Privacy policy: `/privacy.html`
- Support: `/support.html`
- Account deletion (Google requires a web link): `/delete-account.html`
- Support email: `help@myhaul.co.za` [CONFIRM: create the mailbox]

Hosting: Netlify, using `netlify.toml` in the repo (connect the GitHub repo in Netlify; it builds by itself). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify's environment variables (public values only). This also gives:

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
• Like, repost and follow the shops you love
• Sellers get special prices, bundles and holds for buyers in chat
• Every seller is ID checked, with a trust score you can see
• Fakes and replicas are not allowed
• Sell from your phone: take a photo or video, list it in a few steps, and get paid once the return window closes

First order of R200 or more? Get R50 off with welcome credit.

**Keywords (Apple, 100 characters):** thrift,resale,secondhand,video shopping,live shopping,south africa,cape town,cakes,beauty,deals

## Age rating

Users post photos, videos and comments, and chat with each other. Purchases are of physical goods.

- Apple: answer "yes" to user generated content and messaging. Expect **16+** or **18+**. Our terms say 18 and over. [CONFIRM]
- Google (IARC questionnaire): users can interact and share content; no gambling, no violence; purchases are of physical goods. Target audience: 18 and over.

## Privacy answers

**Apple privacy labels (Data Linked to You):** contact info (email, phone, name); user content (photos, videos, messages, comments); identifiers (user ID, device ID for notifications); purchases (purchase history); financial info (sellers' bank details, held by the escrow partner); usage data (product interaction). **Tracking: No.** We don't track people across other companies' apps.

**Google data safety:** collects personal info (name, email, phone), photos and videos, messages, purchase history, app activity, device IDs. Data is encrypted in transit. Users can ask for deletion (in app and on the web). No data sold or shared for ads. Payment card info is handled by the payment provider.

## Permissions and why

| Permission | Why (shown to the user) |
| --- | --- |
| Camera | Take photos and videos of items you sell, and photos in chats |
| Microphone | Record sound with item videos |
| Photos | Choose photos and videos of your items |
| Notifications | Orders, messages and offers |

## Rules we meet

| Rule | How |
| --- | --- |
| Physical goods paid outside Apple and Google billing (Apple 3.1.3(e)) | Escrow checkout (TradeSafe). No in app purchases. |
| User generated content (Apple 1.2, Google UGC policy) | Report on posts, shops, comments and chats; block; rude word filter; team review queue within 24 hours; contact details on the privacy and help pages |
| Delete account in the app (Apple 5.1.1(v), Google) | Menu > Delete my account, plus the web page for Google |
| Not just a website (Apple 4.2) | Native camera, notifications, share sheet, haptics, Android back button |
| Sign in with Apple | Not required: we only use email or phone codes, no Google or Facebook sign in |
| Export compliance | Only standard HTTPS: `ITSAppUsesNonExemptEncryption = false` is set |
| Google target API level | Android API 36 |

## Test account for the reviewers

Apple and Google need a way to sign in. Our normal sign in sends a code, which reviewers can't receive, so the sign in screen also has "Sign in with a password".

1. Supabase > Authentication > Users > Add user > Create new user: email `review@myhaul.co.za`, a strong password, tick "Auto confirm user". [Ofentse or Lehloma]
2. Sign in with it once on the app and finish Create account: name "App Review", username `app.review`, birthday over 18. Don't make it a team account.
3. Open a shop on it called "Review Shop" (approve its ID check in the team dashboard) and post two or three items with videos, so reviewers can see the seller side.
4. Make sure real founding sellers have live listings: reviewers must see a full feed, never sample data.
5. In App Store Connect (App Review Information > Sign in required) and Google Play Console (App content > App access), give the email and password and paste these notes:

> myHaul is a marketplace for physical goods from independent South African sellers, so purchases use our escrow partner TradeSafe rather than in app purchase. Sign in: on the sign in screen tap "Sign in with a password" and use the account above. During review payments run in TradeSafe's sandbox, so no real money moves: any test card TradeSafe shows will work. Buyer side: tap Buy now on any video. Seller side: open Profile, then Selling, for the account's "Review Shop". User safety: Report and Block are in the more menu (three dots) on every video, comment, shop and chat; reports reach our team within 24 hours. Terms of Use and Privacy Policy are in the menu and accepted at sign up. Delete account: Menu > Delete my account. The app is for people aged 18 and over.

## Build and submit

**Android** (any computer, or automatically on GitHub):
1. Every push to main builds a test APK on GitHub (Actions > Android test build > Artifacts). Install it on an Android phone to test.
2. For Google Play: create an upload key, set it in `android/app/build.gradle`, run `./gradlew bundleRelease`, upload the `.aab`. [Lehloma]
3. Personal account: run a **closed test with at least 12 testers for 14 days** before production access.

**iPhone** (needs a Mac with Xcode, about an hour the first time):
1. `cd apps/web && npm install && npm run build:native && npm run open:ios`
2. In Xcode: sign in with the Apple developer account, pick the team, turn on **Push Notifications**, then Product > Archive > Distribute to App Store Connect.
3. Test it with TestFlight first, then submit for review.

**Every new version:** raise the version (`versionCode`/`versionName` in `android/app/build.gradle`, and the version and build in Xcode), then build again.

## Still to do before submitting

**Built (2026-11-04):** Live selling hidden until it's built (Apple rejects "coming soon" features); Terms of Use page, linked at sign up and in the menu; iPhone only (no iPad review); push notifications for orders and messages; sample PUDO lockers hidden (collection and courier with tracking only); warning in chats about paying outside the app; Contact us in the menu; new icon, splash, feature graphic and screenshots.

- [ ] Live database: apply migrations 0017 to 0020 [Lehloma]
- [ ] Deploy all server functions, including `team-alerts` and `push-notifications`, and schedule them (docs/SETUP.md) [Lehloma]
- [ ] Company registered; registration number, address and directors in `terms.html` and `privacy.html` (search for CONFIRM); lawyer confirms the terms [Ofentse]
- [ ] Domain myhaul.co.za on Netlify, support mailbox help@myhaul.co.za, Netlify site public [Ofentse]
- [ ] Apple Developer account and Google Play account [Ofentse]
- [ ] Resend set up for sign in emails [Lehloma]
- [ ] TradeSafe sandbox keys for review, live keys for launch [Lehloma]
- [ ] Mux keys [Ofentse]
- [ ] Push keys: Apple APNs key and Firebase service account [Lehloma]
- [ ] Reviewer account with "Review Shop", and founding sellers with real listings
- [ ] Team ID and SHA256 in the `.well-known` files [Lehloma]
- [ ] Google: 14 day closed test with 12 testers; data safety form; age rating questionnaire (18+)

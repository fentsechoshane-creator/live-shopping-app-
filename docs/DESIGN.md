# Design rules

## The rule for every new version

1. **Apple's look, with myHaul's own kick.** The app should feel like it shipped with the iPhone: system font, system colours, grouped lists, sheets, large titles. On top of that sit three things that are ours (see "What makes it myHaul"). Nothing else is decorated.
2. **Tokens only.** Do not add new colours, fonts, shadows or one off styles. Use the tokens and classes in `apps/web/src/styles.css`.
3. **Real features only.** Where something is not built yet, the app says so plainly in the same place. Never fake data.
4. **Every screen is finished.** Every list has an empty state (`<Blank>`), every action says what happened, every screen has a way back.
5. **Check before shipping.** Run `npm run test:e2e` (screenshots land in `apps/web/e2e/shots/`) and `node apps/web/e2e/audit.mjs` for the screens the test does not reach. Look at every picture at phone size (393 x 720) in light and dark.

## What makes it myHaul

| Signature | Rule |
| --- | --- |
| One green tint | Apple's system green (`--green`) is the only action colour: Buy, Pay, links, Back, switches, focus rings, selected choices. Green words on a light page use `--tint`. |
| Dark ink on green | Text on a green button is near black green (`--green-ink`), never white. This is the one place we break from Apple on purpose. |
| Rounded numbers | Prices, big numbers, monogram avatars and the wordmark use the rounded system font (`--font-round`). Everything else is the normal system font. |
| The wordmark | `<Wordmark>`: "my" in ink, "Haul" in green, rounded. Sign in, welcome, the menu footer. No logo tile, no gradient. |

## Design system

| Part | Rule |
| --- | --- |
| Type | The phone's system font. Body 17px. Large title (`h1`) 34px bold on main screens, 28px (`h1.item`) for an item or order name. Section title (`h2`) 22px bold. Small print 13px. Form labels 13px grey capitals above the field. |
| Colour | System colours only: green (tint and success), orange (`--amber`: attention, auctions, made to order), red (`--red`: errors, destructive actions, unread badges). Page `--bg` is the iOS grouped grey, cards are `--surface` white. Light and dark follow the phone. |
| Buttons | Slim capsules: main action 48px (`.btn.big`), normal 44px, two in a row 40px (`.btn.grow`, 15px). Filled buttons (green, amber) have an ever so subtle glass shine: a faint light top edge and the lightest fall of light, no glow. Plain buttons are flat. One green button per screen for the main action. Disabled buttons go flat grey. |
| Hold to bid | One slim amber capsule with the glass shine. It switches between the price and "Hold to bid", counts down while held inside an amber glass ring, turns green when the bid is in, and opens the bid sheet on a quick tap. Each change slides: old words up and out, new words up from below. No blur. |
| Live | Full screen video with a dark shade at the top and bottom. Red LIVE pill with the time, a glass viewer count. Chat sits low on the left over the video, newest at the bottom. One card at the bottom: the pinned item (Buy now) or the auction (a ring that counts down, amber when 10 seconds are left). Seller tools are two glass buttons under it; End is red. |
| Lists | Grouped lists (`.group` with `.cell`) for settings, menus, orders and details, as in iOS Settings. Chevron on the right when a row opens something. |
| Sheets | Solid (not see through), 30px top corners, a grab handle, a title and a close button. Main action pinned in the sheet foot. |
| Glass | Only for bars that float over content: the tab bar, the top bar on the feed, controls over video (`.vglass`, always dark with white text). |
| Avatars | The person's photo, or a grey monogram circle with their first letter, like Contacts. Shop avatars carry a thin green ring. |
| Chat | Messages style: my bubbles green with dark ink, theirs white. Product and offer cards inside a bubble are plain white cards. |
| Empty states | One pattern, `<Blank>`: a thin grey icon, a 22px title, one grey line, at most one button. |
| Notices | Short capsule that drops in from the top and leaves by itself. Never covers a Pay button or the message box. Errors that need action stay on the page as a red note. |
| Shape | Cards 20px radius (`--r`), small parts 12px, sheets 30px. |
| Motion | Short and soft: sheets rise, the menu slides in, buttons press in slightly. Off when the phone asks for reduced motion. |
| Touch | Nothing you tap is smaller than 40px. |
| Words | Plain South African English. No hyphens or em dashes in app text. Say what happens: "Pay R311", "Ask for a return". Helper text is one short line or it goes. |

## Layout rules (from TikTok and Instagram, 14 Nov 2026)

Light mode pages are white like Instagram (not iOS grey); fills like search and chips are soft grey #efeff1; cards keep a thin edge.

These keep the screens from breaking on any phone. Every new screen follows them.

1. **Two kinds of screens.**
   - Video screens (feed, video viewer, live, camera, editor) run full screen, under the clock. A soft dark fade sits behind the clock so it stays readable. Buttons at the top start below the clock area.
   - List screens (Explore, Inbox, Me, shop and person pages, orders, settings) never let content scroll under the clock. Their top bar is frozen and solid, and it covers the clock area.
2. **What is frozen at the top.** Explore: search, filters and category chips (`.screen-head`). Inbox: the title and the Messages/Updates switch. Profiles and shops: the icon bar (`.pbar`), and the Posts/Likes/Reposts tabs stick under it. When the name scrolls away, it appears small in the middle of the top bar, like Instagram.
3. **Frozen bars are solid.** Nothing shows through them (`--bar-bg` is the page colour). A thin line appears under them.
4. **Bottom bar.** Always in the same place. Solid enough on list screens that text underneath never shows through; dark glass over video. It hides while the keyboard is open.
5. **Safe areas.** Use `var(--sat)` (top, the clock) and `var(--sab)` (bottom, the home bar), never `env()` directly. Tests switch a notch on by setting these two.
6. **Video overlays.** The caption, product and buttons sit above the bottom bar with a gap, inside the bottom dark fade. Text never runs under the right side buttons. Captions show one line until tapped.
7. **Grids.** Profiles and shops: 3 across, 3:4, 2 px gaps, edge to edge. Explore: 2 across, 3:4, rounded, details in pills on the picture. Price top left, views bottom right.
8. **Sheets** open from the bottom and stop below the clock area, with the home bar space added at the bottom.
9. **Tap targets** are at least 44 x 44 px.

## Screen map (prototype to real app)

| Prototype screen | Real app | Status |
| --- | --- | --- |
| Feed with For you, Following, Live | `/` (Feed.tsx) | Built. Live shows a coming next state. |
| Wallet chip and search | Feed top bar, Explore, Me | Built (shows welcome credit). |
| Browse and checkout sheets | Feed.tsx, Checkout.tsx | Built. |
| Explore | `/explore` | Built. Lives and auctions section is coming next. |
| Activity: Notifications, Messages, Orders | `/activity` | Built. Messages is coming next. |
| Profile | `/me` (Profile.tsx) | Built, TikTok style: photo with Posts, Sales, Following beside it; name, rating bubble (out of 5, red to green, black when none), standing pill, bio. This header never changes. Posts, Likes and Reposts tabs below; Posts shows seller buttons and prompts to open a shop or post when empty. Shop pages use the same layout. Trust and Following open as sheets. |
| Side menu and settings | Menu button on Me | Built. |
| Seller sign up (5 steps) | `/sell/start` | Built. |
| Post (+ tab): Camera, Create, Live | `/post` (Post.tsx) | Built. Camera: gallery left, shutter middle (tap photo, hold video), flip right, length limit. Create: a step by step listing (media, what it is, price and stock, more, review); the switch hides after the first page. Buyers without a shop get an "Open a shop?" question instead. Live: stock check (5 minimum), streaming coming next. |
| Shop checklist | Me, Selling | Built. |
| Auctions, live selling, chat | | Not built yet. |

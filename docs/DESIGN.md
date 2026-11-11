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
| Buttons | Slim, flat capsules: main action 48px (`.btn.big`), normal 44px, two in a row 40px (`.btn.grow`, 15px). No gradient, no glow. One green button per screen for the main action. Disabled buttons go grey. |
| Hold to bid | One slim capsule that switches between the price and "Hold to bid", counts down while held inside an amber glass ring, and opens the bid sheet on a quick tap. Dark glass on videos, amber in the bid sheet. |
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

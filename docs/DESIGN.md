# Design rules

## The rule for every new version

1. **The prototype is the design reference.** Every screen in the real app must look and work like its screen in the clickable prototype. Reference screenshots live in `docs/design/prototype/`. If a new version changes a screen, compare it side by side with the reference before shipping.
2. **Liquid Glass, kept very clean.** Use the design system below. Do not add new colours, fonts, shadows or one off styles; use the tokens and classes in `apps/web/src/styles.css`.
3. **Real features only.** Where the prototype shows something not built yet (lives, auctions, chat), the real app shows a clear "coming next" state in the same place, never fake data.
4. **Check before shipping.** Run `npm run test:e2e`. It saves screenshots of every main screen to `apps/web/e2e/shots/`. Look at them next to the references.

## Design system

| Part | Rule |
| --- | --- |
| Type | The phone's system font (SF Pro on iPhone), Inter as fallback. Large bold titles (32px) on main tabs, 15px body. No other fonts. |
| Colour | Tokens only (`--ink`, `--surface`, `--green` and so on). Light and dark follow the phone's setting. Green is for Buy now, Order now and success. Amber for attention and made to order. Red only for errors and the Live dot. |
| Glass | `.glass` for bars, sheets and menus on light screens: frosted, see through, a thin bright edge. `.vglass` for anything floating over video: always dark glass with white text. |
| Shape | Capsule buttons and pills. Cards 18px radius. Sheets 30px top corners. The tab bar floats as a glass capsule above the bottom edge. |
| Layout | One phone column. Content scrolls under the floating bars. Grouped lists (`.group` with `.cell`) for settings, orders and menus, like iOS. |
| Motion | Short and soft: sheets rise, the menu slides in, buttons press in slightly. Off when the phone asks for reduced motion. |
| Words | Plain South African English. No hyphens or em dashes in app text. Say what happens: "Pay R311", "Ask for a return". |

## Screen map (prototype to real app)

| Prototype screen | Real app | Status |
| --- | --- | --- |
| Feed with For you, Following, Live | `/` (Feed.tsx) | Built. Live shows a coming next state. |
| Wallet chip and search | Feed top bar, Explore, Me | Built (shows welcome credit). |
| Browse and checkout sheets | Feed.tsx, Checkout.tsx | Built. |
| Explore | `/explore` | Built. Lives and auctions section is coming next. |
| Activity: Notifications, Messages, Orders | `/activity` | Built. Messages is coming next. |
| Profile with Buying and Selling | `/me` | Built. |
| Side menu and settings | Menu button on Me | Built. |
| Seller sign up (5 steps) | `/sell/start` | Built. |
| List an item | `/sell/new` | Built. |
| Shop checklist | Me, Selling | Built. |
| Auctions, live selling, chat | | Not built yet. |

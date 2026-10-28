# [Venture name]: live shopping for small South African sellers

The first real build of the app. It covers the **seller side** (sign up, ID and bank checks, rules, shop, listings with video, shipping, returns, payouts) and a **basic buyer side** (video feed, Browse, Buy now and Order now checkout with money held in escrow, order tracking, returns, ratings).

Auctions, lives, chat and the wallet are in the clickable prototype but not built yet.

## Try it in 1 minute (no accounts needed)

```bash
npm install
npm run dev
```

Open http://localhost:5173. With no keys set, the app runs in **demo mode**: test data lives in your browser.
- Sign in with any email and the code `123456`. An email that starts with `admin` signs in as our team.
- On an order, use **Demo tools** to ship, deliver and skip days so you can see payouts and the return window.

## Run it for real

See [docs/SETUP.md](docs/SETUP.md): Supabase (database, sign in, storage), Mux (video) and TradeSafe (escrow).

## What is where

| Folder | What it is |
| --- | --- |
| `packages/core` | The business rules in one place: fees, buyer protection, return windows, payout dates, trust score, unlocks, listing checks. Pure TypeScript with tests. |
| `supabase/migrations` | Database tables and the rules the database enforces: who can see what, order status changes, counterfeit checks, trust points. |
| `supabase/functions` | Server functions: checkout and escrow, order actions, bank details, Mux video, and the scheduled job that refunds, releases and pays out. |
| `apps/web` | The web app (React). Works in demo mode or against Supabase. |
| `docs` | Setup, architecture and the open questions. |

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing how money moves, and [docs/DESIGN.md](docs/DESIGN.md) before changing any screen. Every new version must keep the prototype design.

## Checks

```bash
npm test              # business rules (packages/core) and the server copy check
npm run test:db       # database rules on a throwaway local Postgres (needs Postgres 15+ installed)
npm run check:functions  # type check and test server functions (needs Deno 2)
npm run build && npm run test:e2e   # end to end journeys in demo mode (needs Playwright with Chromium)
```

After changing anything in `packages/core`, run `npm run sync-core` so the server functions use the same rules.

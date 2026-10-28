# Notes for AI coding agents (Antigravity, Gemini, Claude and others)

Read README.md, then docs/ARCHITECTURE.md. Then follow these rules.

- Money is in **cents** (integers) everywhere. Use `formatRand` to show it.
- Business rules live in `packages/core`. Change them there, add a test in `packages/core/test`, then run `npm run sync-core`. Never edit `supabase/functions/_shared/core` by hand.
- If a number also exists in SQL (trust points in `trust_rules`, return windows in `return_window()`, counterfeit words in `looks_counterfeit()`), change both and run `npm run test:db`.
- New tables need row level security and explicit grants in a new migration. Never edit an old migration that has been pushed.
- Anything that moves money goes through a server function with the service role, never from the app.
- Keep the demo adapter (`apps/web/src/api/demoApi.ts`) working: it must implement every method in `Api` (`apps/web/src/api/types.ts`).
- Copy in the app is plain English for South African users. No hyphens or em dashes in user facing text.
- Before saying a change is done: `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e` if screens changed.

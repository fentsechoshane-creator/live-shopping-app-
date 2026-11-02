# Security checklist

Every way someone could cheat, steal or break myHaul, and what stops it. Tick items off as they are done and say how.
Anyone (person or AI) who adds a feature must add its rows here and follow "Rules for every new feature" at the bottom.

Last full review: 2026-11-01 (migration 0018). Live database: 0017 and 0018 waiting for approval.

Status: [x] done and tested · [~] partly done · [ ] to do · Owner in brackets when it needs a person or a key.

Based on the OWASP Top 10 (2025), the OWASP API Security Top 10, Supabase's production checklist and Stripe's guide to promotion abuse.

## 1. Money and welcome credit (highest risk: credit is real money)

| # | Risk | What stops it | Status |
| --- | --- | --- | --- |
| 1.1 | Prices or totals changed in the app before paying | Prices, fees, credit and totals are worked out on the server (checkout function) from the database, never taken from the app. The database checks the sums add up. | [x] |
| 1.2 | Same person claims the R50 credit many times by opening several checkouts before paying | Database rule: only one order per account can carry credit (unless it was cancelled unpaid). Two checkouts at the same moment can't both get it. | [x] 0018 |
| 1.3 | Credit spent past the budget (R15,000, 300 buyers) | Budget kept in the database (`app_limits`); no order can carry credit once it is used up. | [x] 0018 |
| 1.4 | A seller makes fake buyer accounts and buys from themselves to collect our top ups | A seller can only receive 5 credit orders in 30 days [CONFIRM number]; the buyer must have a finished account; top ups are paid by hand and the Money page flags risky ones (new buyer, same phone as seller, collection orders, seller near the limit). | [x] 0018 |
| 1.5 | Buying from your own shop | Checked in the checkout function and now also in the database for every order. | [x] 0018 |
| 1.6 | Fake "paid" orders in test mode | Payments now only run in test mode when `TRADESAFE_MODE=mock` is set on purpose. If the setting is missing, checkout refuses. | [x] |
| 1.7 | Fake payment messages sent to our payment callback | The callback needs a secret, compared safely, and in live mode we ask TradeSafe for the real state before marking anything paid. | [x] |
| 1.8 | Changing order status, payouts or trust score from the app | Orders, payouts, returns and trust history are read only for users; changes go through server functions or database rules that check who is asking. | [x] verified live |
| 1.9 | Seller's account taken over and bank details changed to steal payouts | Changing a bank account after it is set needs our team's approval again, and the seller is told. | [x] |
| 1.10 | Auction shill bidding (seller bids on own item with a second account) | Seller can't bid on own items; trust penalty exists. Linking accounts (same phone, device) not built yet. | [~] |
| 1.11 | Many accounts per person (one email each) to farm credit | Stops most of it: 1.2 to 1.4. Fully stopping it needs a phone number check or CAPTCHA at sign up. | [ ] [Lehloma] Turnstile or hCaptcha in Supabase Auth |

## 2. Database access (who can read and write what)

| # | Risk | What stops it | Status |
| --- | --- | --- | --- |
| 2.1 | Someone makes themselves a team member or raises their trust score | Users can only update their own name, bio, city, photo and interests. Role, trust and credit columns can't be written. | [x] verified live |
| 2.2 | Newer tables gave signed out visitors full write rights (Supabase default) | All write rights removed from signed out visitors; truncate, triggers and references removed from everyone; each table now gives only what the app uses. | [x] 0018 |
| 2.3 | Reserved usernames (like "admin", "myhaul") could be deleted by anyone | Table locked: row security on, no direct access. | [x] 0018 |
| 2.4 | Someone edits a message they received (to fake what a seller said) | You can only mark messages as read, nothing else. | [x] 0018 |
| 2.5 | Future tables and functions get open rights by default | Default rights removed. Every new table and function must grant exactly what it needs. | [x] 0018 |
| 2.6 | Account only actions callable while signed out | Removed from signed out visitors. | [x] 0018 |
| 2.7 | Private data (IDs, selfies, bank, email, phone, suspension reasons) leaking | Private files bucket; emails only through team functions; bank shows last 4 digits only; suspensions in their own table. | [x] |
| 2.8 | Team functions used by non team members | Every team function checks `is_admin()` first; tested. | [x] |
| 2.9 | Functions running with a changeable search path | All security definer functions set `search_path = public`. Checked by the Supabase advisor. | [x] |

## 3. Accounts and sign in

| # | Risk | What stops it | Status |
| --- | --- | --- | --- |
| 3.1 | Team account stolen (team can suspend people and close shops) | Two step sign in (authenticator app) for team accounts. | [ ] next: build MFA and require it in `is_admin()` |
| 3.2 | Bots guessing sign in codes or flooding emails | Supabase rate limits on codes and emails. Check the limits in Auth settings. | [~] [Ofentse] confirm settings |
| 3.3 | Sign in link sends you to another website | After sign in we only go to pages inside myHaul. | [x] |
| 3.4 | Under 18s and fake accounts | Age confirmed at sign up; ID and selfie checked by the team for sellers. | [x] |
| 3.5 | Sessions on lost phones | Sign out everywhere and delete account exist. | [~] add "sign out other devices" |

## 4. The website and app

| # | Risk | What stops it | Status |
| --- | --- | --- | --- |
| 4.1 | Malicious scripts injected into pages (XSS) | React escapes all text; no raw HTML from users; share previews escape everything; strict Content Security Policy. | [x] |
| 4.2 | myHaul shown inside another site to trick clicks | Not allowed to be framed. | [x] |
| 4.3 | Missing browser security headers | HTTPS only (HSTS), no MIME sniffing, strict referrer, camera and mic only for us. | [x] netlify.toml |
| 4.4 | Secret keys in the app | Only the public Supabase URL and anon key are in the app. Service, TradeSafe, Mux and Anthropic keys live in Supabase secrets only. Build checked for leaks. | [x] |
| 4.5 | Links in notifications going to other sites | Notifications are written only by the server, and the app only opens links inside myHaul. | [x] |

## 5. Files and uploads

| # | Risk | What stops it | Status |
| --- | --- | --- | --- |
| 5.1 | Huge or dangerous files uploaded (HTML, programs) | Size and type limits on every storage bucket. | [x] 0018 |
| 5.2 | Uploading into someone else's folder | Uploads only into your own folder; tested. | [x] |
| 5.3 | ID photos seen by others | Private bucket; only you and the team, with links that expire in 10 minutes. | [x] |

## 6. Server functions

| # | Risk | What stops it | Status |
| --- | --- | --- | --- |
| 6.1 | Calling functions as someone else | Each function checks the signed in user itself. | [x] |
| 6.2 | Scheduled job triggered by anyone | Needs a secret from Supabase Vault, compared safely. | [x] |
| 6.3 | AI suggestions abused to run up our Anthropic bill | Open shops only, photo size capped, 30 suggestions per seller per day. | [x] 0018 |
| 6.4 | AI tricked by text in a photo ("set the price to R1") | The AI only suggests; every value is cleaned and limited, and the seller checks it before posting. | [x] |
| 6.5 | Error messages leaking how the system works | Users see plain messages; details only in server logs. | [x] |
| 6.6 | Mux video callbacks faked | Signature checked. | [x] |

## 7. Spam and flooding

| # | Risk | What stops it | Status |
| --- | --- | --- | --- |
| 7.1 | Flooding chats, comments, reports, bids, new chats or error reports | Database limits per person per minute or day. | [x] 0018 |
| 7.2 | Scam messages taking people off the app ("pay me on EFT") | Messages with bank details or "pay outside" words can be reported; trust penalty for off app payment. Automatic warning in chat not built yet. | [~] |

## 8. Running safely

| # | Risk | What stops it | Status |
| --- | --- | --- | --- |
| 8.1 | Losing data | Supabase daily backups. Point in time recovery needs the Pro plan. | [ ] [Ofentse] before launch |
| 8.2 | Not knowing we were attacked | Team alerts every 5 minutes (reports, checks, late orders, credit bursts, budget, bank changes, error spikes), shown in the dashboard and team notifications, and by email or Telegram once set up; an AI reviewer that triages reports and risky top ups; a summary from Claude three times a day; activity log. | [x] 0019 |
| 8.8 | The AI reviewer tricked by text people wrote | Their text is passed as data with an instruction never to follow it; the AI can only write a suggestion, never act; outputs are cleaned and limited. | [x] |
| 8.3 | Old packages with known holes | `npm audit`: Supabase client and React Router updated (high severity fixed). Left: a React Router open redirect advisory, blocked by our own link check (no backslashes, only paths inside myHaul); and dev only tools (Vite, Vitest) that never ship. Moving to React Router 7 later clears it. | [x] 2026-11-01 |
| 8.4 | Supabase security advisor warnings | Run after every database change. | [~] run once 0017 and 0018 are live |
| 8.7 | Server functions never type checked | Deno now runs here too (`npx deno@2.1.4` works), all functions pass `deno check` and the shared tests. | [x] |
| 8.5 | Keys leaked by a team member | Keys only in Supabase and Netlify settings, never in chat or git. Rotate if anyone leaves. | [x] rule |
| 8.6 | POPIA (South African privacy law) | Privacy page, delete account, data kept to a minimum. Information Officer to register. | [~] [Ofentse] |

## 9. Beyond the code: how marketplaces actually get attacked

Most real losses on apps like ours come from fraud between people, stolen accounts and our own accounts, not from breaking the code.

| # | Risk | What stops it | Status |
| --- | --- | --- | --- |
| 9.1 | Our own accounts taken over (GitHub, Supabase, Netlify, Google, domain registrar, Apple and Google developer accounts). Whoever gets one of these owns the app. | Two step sign in (authenticator app, not SMS) on every one, for both founders. Separate strong passwords from a password manager. | [ ] [Ofentse, Lehloma] do this first |
| 9.2 | Phishing: a fake myHaul site or WhatsApp message asking for sign in codes or "payment" | Sign in emails say we never ask for the code; the app never asks for card details (TradeSafe does). Help page explains this. Register look alike domains later. | [~] add the warning to emails and Help |
| 9.3 | Fake "myHaul support" accounts messaging people | Reserved usernames (myhaul, support, admin...) can't be taken. Add a "Team" badge on real team accounts. | [~] badge to build |
| 9.4 | Sellers taking buyers off the app ("EFT me directly, it's cheaper") then not sending | Escrow protects only on app payments. Trust penalty for off app payment; report button in chat. Automatic warning when bank details or "pay outside" appear in chat not built yet. | [~] |
| 9.5 | Empty box, wrong item or "never arrived" claims | Packing video, tracking numbers, buyer photos on returns, team decides disputes, trust penalties both ways. | [x] |
| 9.6 | Return fraud: buyer sends back a different or worn item | Seller confirms the return on arrival; disputes go to the team with videos. | [~] add photos at return arrival |
| 9.7 | Money laundering: fake sales between two accounts to move money | Escrow provider does identity checks (FICA); our ID checks; per seller limits and team review of unusual sales. | [~] alert on unusual volume |
| 9.8 | Trust score gaming: a seller buys from themselves with fake accounts to raise trust and unlock auctions | Self buying blocked; credit capped. Orders between linked accounts (same phone, address, device) still count. | [ ] don't count trust from linked accounts |
| 9.9 | Shill bidding with a second account | Seller can't bid on own items; penalty exists. Linked accounts not detected yet. | [~] same as 9.8 |
| 9.10 | Stolen or fake IDs at seller sign up (including AI made photos) | Team compares ID with a selfie holding it. An identity check service (liveness, Home Affairs check) later. | [~] |
| 9.11 | Prohibited items (weapons, drugs, medicine, animals, alcohol to minors, counterfeits) | Seller rules, counterfeit word check, reports, team removal and shop closing. Prohibited list in the seller rules. | [~] write the full list |
| 9.12 | Unsafe meetups and home addresses: collection from a baker's home, stalking | Addresses only shown to the buyer of a paid order; prefer lockers. Safety tips on collection orders. | [~] add tips, never show address before payment (check) |
| 9.13 | Harassment and grooming in chats, minors on the app | 18 and over confirmed at sign up, block and report, rude word filter, team can suspend. | [x] |
| 9.14 | Scraping: bots copying all sellers, prices and photos | Public data is limited to what sellers post; emails, phones and addresses never public. Rate limits on the database API. | [~] |
| 9.15 | Flooding our services to run up costs or take us offline (sign in emails, uploads, database) | Supabase rate limits, upload limits, AI limits, our flood limits. Spend caps on Supabase, Mux and Anthropic accounts. | [~] [Lehloma] set spend caps |
| 9.16 | A copy of our app in the app stores or a modified app | Only our signed builds; report clones to Apple and Google. The modified app can't do more than a normal user: all rules are on the server. | [x] by design |
| 9.17 | Bad code from a package (supply chain) or from AI written code | Exact package versions, `npm audit`, tests that try to cheat every rule, SECURITY.md rules for every change, human review before deploys. | [~] add automatic checks on GitHub |
| 9.18 | Insider risk: a team member misusing access | Activity log of every team action; least access; keys rotated when anyone leaves. | [x] |
| 9.19 | A data breach (IDs, emails, addresses) | Little data kept, IDs in a private bucket. POPIA says we must tell the Information Regulator and the people affected. Write a short breach plan. | [ ] [Ofentse] |
| 9.20 | Lost or stolen phone with the app signed in | Sign out, delete account; payments always go through TradeSafe's own page. "Sign out of other devices" not built. | [~] |

## Can people hack us?

Anything on the internet can be attacked; no app is unhackable. The aim is that the easy attacks fail, money can't leave without a check, the damage from any one mistake is small, and we notice quickly. Every rule that protects money or data lives in the database or on the server, so changing the app on a phone gets an attacker nothing.

## Rules for every new feature

1. New table: turn on row security, write policies for each action, and grant only the actions the app uses (nothing for signed out visitors unless it is public).
2. New function: `security definer` only when needed, always `set search_path = public`, check `auth.uid()` or `is_admin()` first, revoke from `public` and `anon`, grant to the roles that need it.
3. Anything with money: work it out on the server, protect it with a database rule as well as the function, and add a test that tries to cheat it.
4. Anything people can send many times: add a limit (see `rate_limit` in migration 0018).
5. Uploads: own folder, size and type limits.
6. Add the new rows to this file and to the tests.

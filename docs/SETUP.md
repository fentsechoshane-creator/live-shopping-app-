# Setup

## Already done (28 October 2026)

A Supabase project called `live-shopping-app` exists in the myHaul organisation (London region, free plan). Project ref: `gingqryoycwtzbfvfbln`.
- All migrations in `supabase/migrations` are applied.
- All 7 server functions are deployed (from bundled copies of `supabase/functions`; redeploying with the CLI from source is fine).
- The scheduled job runs every 15 minutes. Its secret is in Supabase Vault, so nothing to copy.
- Escrow is in mock mode and video uses Supabase Storage until TradeSafe and Mux keys are added.
- `apps/web/.env.live` points the app at it: run `npm run dev:live`.

Still to do by hand in the Supabase dashboard (Authentication):
1. URL configuration: set Site URL to `http://localhost:5173` (and later your real web address).
2. Email templates, "Magic link": add the line `Your code: {{ .Token }}` so people can sign in with the 6 digit code.
3. After you sign up in the app, make yourself an admin in the SQL editor (step 7 below).

The rest of this page is the full setup, for a new project.

Order: Supabase first, then TradeSafe, then Mux. The app works at each stage (escrow and video fall back to test mode until their keys are set).

Never put secret keys in the web app, in chat, or in git. Only `VITE_` values go in `apps/web/.env.local`, and those are safe to be public.

## 1. Supabase

1. Create a project at supabase.com (region: closest to Cape Town is fine). Install the Supabase CLI.
2. In this folder: `supabase link --project-ref <your-ref>` then `supabase db push`. This creates all tables and rules.
3. Auth, under Authentication > Providers:
   - Email: on. For a 6 digit code instead of a link, edit the "Magic link" email template to show `{{ .Token }}`.
   - Phone (optional, later): needs an SMS provider such as Twilio, which costs per SMS. Then set `VITE_AUTH_METHOD=phone`.
   - Under URL configuration, add your app URL (for local: `http://localhost:5173`).
4. Web app keys: Project Settings > API. Create `apps/web/.env.local`:
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   VITE_AUTH_METHOD=email
   ```
5. Server secrets. Create `supabase/.env` (it is git ignored) from `.env.example`, keep `TRADESAFE_MODE=mock` for now, and add:
   ```
   CRON_SECRET=<a long random string>
   APP_URL=http://localhost:5173
   ```
   Then: `supabase secrets set --env-file supabase/.env`
6. Deploy the functions: `supabase functions deploy` (the webhooks and the scheduled job are set to skip the user token check in `supabase/config.toml`).
7. Make yourself an admin. Sign up in the app first, then in the SQL editor:
   ```sql
   update profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
   ```
8. Schedule the job that refunds unshipped orders, closes return windows and pays sellers. In the SQL editor (enable the `pg_cron` and `pg_net` extensions first under Database > Extensions):
   ```sql
   select cron.schedule('run-due', '*/15 * * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/run-due',
       headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'content-type', 'application/json'),
       body := '{}'::jsonb
     );
   $$);
   ```

At this point everything works with fake escrow: Pay opens a test payment page.

## 2. TradeSafe (escrow)

1. In the TradeSafe developer portal, create an application. Copy the Client ID and Secret (the secret is shown once).
2. Set the API callback to: `https://<ref>.supabase.co/functions/v1/escrow-webhook?secret=<TRADESAFE_CALLBACK_SECRET>`
3. Set the success and failure URLs to your app's `/orders` page.
4. Create the platform's own token (role AGENT, with our business bank account). This is where our fees go. Put its id in `TRADESAFE_AGENT_TOKEN`.
5. In `supabase/.env` set `TRADESAFE_MODE=live`, the client id and secret, `TRADESAFE_API_URL` (the sandbox GraphQL URL from your account), and `TRADESAFE_CALLBACK_SECRET`. Run `supabase secrets set --env-file supabase/.env`.
6. Before switching on, check every item marked [CONFIRM] in `supabase/functions/_shared/escrow.ts` against the schema playground. See docs/ARCHITECTURE.md, "Open questions".

## 3. Mux (video)

1. In the Mux dashboard create an access token with Mux Video read and write. Put the id and secret in `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET`.
2. Add a webhook to `https://<ref>.supabase.co/functions/v1/mux-webhook` and copy its signing secret to `MUX_WEBHOOK_SECRET`.
3. `supabase secrets set --env-file supabase/.env`.

Without Mux, seller videos upload to Supabase Storage and play as plain files. That is fine for testing, but Mux is needed for smooth playback on slow connections.

## Hosting the web app

`npm run build` makes `apps/web/dist`, a static site. Any static host works (Vercel, Netlify, Cloudflare Pages). Set the three `VITE_` variables there and send all routes to `index.html`.

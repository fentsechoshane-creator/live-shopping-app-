# Getting into the App Store and Google Play

Researched 29 Oct 2026. Check the official rules again before submitting. Unconfirmed points are marked [CONFIRM].

## Will the stores allow what we do?

| What we do | Apple | Google | What we must have |
| --- | --- | --- | --- |
| Selling physical items (clothes, cakes) | Allowed. Physical goods must be paid **outside** Apple's in app purchase (guideline 3.1.3(e)), so no 30% Apple cut. | Same: physical goods are outside Google Play billing. | Our checkout with TradeSafe and PayFast style payments is fine. |
| Videos, photos, likes, reposts, lives by users | Allowed with user generated content rules (1.2). | Same, under the user generated content policy. | **Report** a post or user, **block** a user, a filter for bad content, quick responses, and published contact details. **Not built yet.** |
| Accounts | Must offer **delete my account inside the app** (5.1.1(v)). | Also requires account deletion in the app and on the web. | **Not built yet.** |
| Camera and microphone | Allowed with a clear reason in the permission prompt. | Same. | Permission text in the native app. |
| Being a "wrapped website" | Rejected if it is just a repackaged website (4.2). | Similar quality bar. | A real native shell (Capacitor or React Native) with camera, notifications and share. Lehloma's call. |
| Privacy | Privacy policy link and privacy labels. | Data safety form and privacy policy. | Write a POPIA compliant privacy policy. |

## How long it takes

- **Apple developer account:** as a company you need a free D-U-N-S number (about 5 to 7 working days), then Apple checks the company (days to a few weeks; not published). An individual account is faster.
- **Apple review:** Apple says 90% of submissions are reviewed in under 24 hours. A first app from a new account is usually the slowest, and a rejection means fixing and resubmitting.
- **Google account (personal, new):** before going public you must run a **closed test with at least 12 testers for 14 days in a row**. Start this as early as possible.
- **Google review:** usually days; Google says up to 7 days or more in exceptional cases.
- **Holidays:** Apple usually slows reviews over Christmas. [CONFIRM the 2026 holiday dates]

## December plan (realistic)

1. **Now:** create the Apple and Google developer accounts (get the D-U-N-S number first if registering the company). Write the privacy policy.
2. **Next 2 weeks:** build Report, Block and Delete account. Lehloma wraps the app as a native app.
3. **Mid November:** start Google's closed test with 12 or more founding sellers and friends; TestFlight for iPhone testers.
4. **Early December:** submit to Apple; Google production access after the 14 day test.
5. **Mid December:** public launch, if reviews pass first time. TradeSafe live payments must be signed off by then.

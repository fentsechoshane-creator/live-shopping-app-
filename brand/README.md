# myHaul brand

The logo is drawn in code (`build.cjs`), not exported from Canva, so it is our own artwork and stays sharp at any size.
`masters/` has the SVG masters, the PNG logos and `COLOURS.txt` (the exact colour codes, the same as the app).

| File | Use |
| --- | --- |
| `logo.svg`, `logo.png`, `logo-white.png` | Full logo: bags and name. Documents, slides, website. |
| `mark.svg` | Bags only. |
| `wordmark.svg`, `wordmark-dark.svg` | Name only, for light or dark backgrounds. |
| `store-b.svg` | App icon now: bags with the name (until people recognise the bags). |
| `store-a.svg` | App icon later: bags only, bigger. |
| `adaptive-fg.svg` | Android adaptive icon (art inside the safe zone). |
| `splash.svg`, `feature-graphic.svg`, `og.svg` | Splash screen, Google Play feature graphic, link preview. |

## Change the logo or switch the app icon

1. `cd brand && npm install`, then edit `build.cjs` (colours at the top, bag sizes and prints in `bags()`).
2. `npm run build` writes the SVG masters. `npm run export` renders the PNGs (needs Playwright, which the app already has).
3. Copy into the app: `icon-only.png`, `icon-foreground.png`, `splash.png` (also as `splash-dark.png`) into `apps/web/assets/`;
   `icon-512.png` to `apps/web/public/icon.png`; `og.png` to `apps/web/public/og.png`; store images to `apps/web/store/`.
4. In `apps/web`: `npx @capacitor/assets generate --iconBackgroundColor '#ffffff' --iconBackgroundColorDark '#ffffff' --splashBackgroundColor '#ffffff' --splashBackgroundColorDark '#ffffff'`
   makes every iPhone and Android size. Delete the `apps/web/icons` folder it also makes and keep the manifest's single icon.

To switch to the bags only icon (planned about 3 months after launch, [CONFIRM] date), use `store-a` instead of `store-b` in step 2.

# Video editing: research and plan

Status: research only (updated 6 Nov 2026, second round). Build when Ofentse says.
Where it goes: an **Edit** button between **Retake** and **Next** on the screen after recording (`Review` in `apps/web/src/screens/seller/Post.tsx`), plus **add clips from your gallery**.
Decided by Ofentse: our competitor is **TikTok Shop**, not Whatnot. So we need a real timeline (several clips, from the camera and the gallery), and we need to be different, not a copy.

## 1. What TikTok Shop sellers have

| Tool | What it does | Source |
| --- | --- | --- |
| TikTok's own editor | Adjust clips (trim, split, reorder, delete), sounds, text with timing, effects, filters, stickers, transitions, speed 0.3x to 3x, auto captions; cover picked on the last screen. | [SocialRails](https://socialrails.com/blog/how-to-edit-tiktok-videos-guide) |
| CapCut and Pippit (CapCut Commerce Pro, by TikTok's owner) | Separate apps. Templates and product videos made from a product link, then a product link added on TikTok. | [CapCut](https://www.capcut.com/resource/add-links-to-tiktok-videos), [Vmake](https://vmake.ai/blog/shoppable-video-generator-for-tiktoker) |
| TikTok Symphony (AI) | Turns product photos into short clips, makes 5 second clips from text, and shows a digital avatar holding or trying on a product. Free with a TikTok for Business account. | [TikTok for Business](https://ads.tiktok.com/business/en-US/blog/tiktok-symphony-ai-tools) |

**So we can't beat TikTok on effects, music or AI avatars.** They have years of work and the CapCut team. Trying to match them feature for feature is a losing game.

## 2. Where TikTok Shop is weak (our opening)

- **Content is hard work for small sellers.** Sellers have to be entertainers, hook viewers in seconds, keep posting and still ship in 24 to 48 hours. ([Topdown Trading](https://www.topdowntrading.co.uk/blog/the-reality-of-tiktok-shop-why-live-selling-is-harder-than-it-looks-in-2026.html))
- **Viewers trust real, not polished.** What works reads as "a demonstration, a routine, or a discovery", native content over polished production. ([NeoReach](https://neoreach.com/tiktok-shop-fatigue)) AI avatars wearing a product say nothing about the actual item you'll get.
- **Text is baked into the video.** If the price drops or it sells out, the video still shows the old price.
- **One video, one product link.** A "haul" of 6 items is awkward to buy from.
- **Secondhand and local sellers are an afterthought.** Flaws, sizes and measurements aren't part of the tools.

## 3. Our angle: the honest, shoppable editor

Same basics as TikTok, plus tools no one else has, built around trust and buying. Names are working names.

### Basics (match TikTok)
1. **Timeline:** record clips and **add videos and photos from your gallery**, trim each clip, reorder by dragging, delete, split.
2. **Cover:** pick the frame shown in Explore, your shop and WhatsApp previews.
3. **Sound:** on or off per clip, and volume.
4. **Text:** short lines with a start and end time, placed anywhere.

### Ours (different)
5. **Tag items in the video ("haul" mode, fits the name myHaul).** While editing, tap "Tag item" at a moment in the video and pick a listing. Buyers see the item that's on screen right now and can buy each one. One video, many sales. Shoppable video tags are proven: ASOS saw 27% more time on product pages from tagged video, and Gap 34% more tag clicks after longer close ups. ([Rewarx](https://www.rewarx.com/blogs/in-video-product-tags-fashion-ecommerce))
6. **Flaw marks.** Tap "Show a flaw" at the moment you film a mark or scuff. Buyers can jump straight to every flaw. This ties into our existing rule: flaws shown on video protect the seller in a "not as described" dispute (the `flaw_not_shown` trust event). Nobody else does this, and it fits buyer protection.
7. **Live price and stock stickers.** Price, size, "Only 1 left" and "Sold" are drawn by the app from the listing, not baked in, so they're always right.
8. **"Filmed in myHaul" badge.** Clips recorded in the app get a small badge; gallery clips are allowed but unmarked. Signals the video shows the real item, now. (Our packing proof already works this way.)
9. **Data light.** Edits are saved as instructions, not a new video file, so a seller uploads each clip once. Matters for South African data costs.

### Not doing
- AI avatars and AI generated product video (they work against trust).
- A music library (licensing through SAMRO and the record labels, cost and takedowns). Sellers can keep the sound they recorded.
- Heavy effects and transitions (later, if sellers ask).

## 4. How to build it (technical)

**Key idea: an "edit list" instead of rendering a new video.** We save the edit as data: which clips, in what order, each clip's start and end, sound on or off, text, tags, flaw marks and the cover. The app plays the clips one after another and draws text, tags and stickers on top. Nothing is re-encoded on the phone. Text and tags stay editable after posting.

| Part | Plan | Notes |
| --- | --- | --- |
| Clips | Each clip uploads on its own (Mux direct upload, or Supabase storage until the Mux keys are in). | Gallery picking: a normal file input with `accept="video/*,image/*" multiple` on the web; the Capacitor camera or file picker plugin in the phone apps. |
| Playback | Two video players on top of each other: one plays, the next one loads in the background, then they swap. | Needs a prototype to check there's no visible gap between clips on iPhone [CONFIRM]. |
| Trim of each clip | Played as a range (start to end) by the app. With Mux, an exact trimmed copy can also be made with `inputs: [{ url: "mux://assets/<id>", start_time, end_time }]` (at least 0.5 seconds). | ([Mux clips](https://www.mux.com/docs/guides/create-clips-from-your-videos.md)). Mux instant clips cut at segment level, a few seconds off, so not for this. ([Mux instant clips](https://www.mux.com/docs/guides/create-instant-clips)) |
| One single video file (for sharing outside the app, WhatsApp Status, or download) | Later. Options: (a) on iPhone, Apple's own AVFoundation joins and trims clips natively through a small Capacitor plugin we'd write ([Apple](https://developer.apple.com/library/ios/documentation/audiovideo/conceptual/avfoundationpg/articles/03_editing.html), [IMG.LY](https://img.ly/blog/combine-video-clips-into-a-new-file-in-ios-with-swift.md)); (b) in the browser, Mediabunny (WebCodecs, hardware accelerated, small) ([Mediabunny](https://mediabunny.dev/guide/introduction)); (c) on a server with ffmpeg. | Mux does not join clips; its own guide uses ffmpeg for that ([Mux](https://mux.com/articles/stitch-multiple-videos-together-with-ffmpeg)). Avoid ffmpeg.wasm on phones: its multi-threaded build can use about 2 GB of memory ([discussion](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/415)). |
| Data | New tables: `post_clips` (post, order, media, start, end, muted, in_app) and `post_marks` (post, time, kind: text, tag, flaw, with the text, product and position). Server checks lengths, order, that tagged products belong to the seller, and the usual rude word and off app checks on text. | Old single video posts keep working (one clip, no marks). |
| Feed | `Video` plays the clip list; the product chip follows the tag that's on screen; a "Flaws" button jumps between flaw marks. | |

## 5. Suggested order

1. **Timeline basics:** gallery and camera clips, trim, reorder, delete, cover, sound. (The must have, matches TikTok.)
2. **Tags and flaw marks.** (The difference. Worth more than any effect.)
3. **Text and live stickers.**
4. **One file export** for sharing outside the app.

Rough size: step 1 is the biggest piece of work in the app since checkout. Steps 2 and 3 are smaller because they reuse step 1's player.

## 6. Questions for Ofentse

1. Do you like the angle: TikTok basics plus haul tags, flaw marks and live stickers, and no AI avatars or music library?
2. Should gallery clips be allowed for every seller, or only in-app recordings for some categories (for example designer items, where we already ask for proof)?
3. Mux first? The timeline works without it, but trimming, covers and playback are much better with Mux. [CONFIRM]

## 7. Not confirmed yet

- [CONFIRM] Smooth back to back playback of separate clips on iPhone Safari (prototype first).
- [CONFIRM] Safari on iPhone support for WebCodecs encoding, which in-browser one file export would need.
- [CONFIRM] Mux cost for clip assets on basic quality.

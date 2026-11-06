# Basic video editing: research and plan

Status: research only (6 Nov 2026). Build when Ofentse says. Where it goes: a new **Edit** button between **Retake** and **Next** on the screen after recording (`Review` in `apps/web/src/screens/seller/Post.tsx`).

## What the big apps give sellers and creators

| App | What you can do to a video | Notes |
| --- | --- | --- |
| TikTok | Adjust clips (trim start and end, split, reorder, delete), sound, text with timing, effects, filters, stickers, transitions, speed (0.3x to 3x), auto captions. Cover is picked on the last screen ("Select cover"). | The full creator toolkit. Far more than a seller needs. ([SocialRails](https://socialrails.com/blog/how-to-edit-tiktok-videos-guide)) |
| Instagram Reels | One editing screen with clips, audio, stickers and text as layers you can time. | ([Planoly](https://www.planoly.com/blog/instagram-new-reels-editor.md)) |
| Whatnot video listings | Record or upload up to 30 seconds. No trim: you replace the video. The thumbnail is the first photo. | Selling app, so very little editing. ([Whatnot help](https://help.whatnot.com/hc/en-us/articles/25115728767373-Create-a-video-listing-Beta)) |
| Depop | Advises 5 to 15 second clips. Mutes all sound on upload. | ([Depop blog](https://blog.depop.com/articles/how-to-make-a-depop-listing-video)) |
| Poshmark | Up to 15 seconds, one video per listing, a cover image. | ([Retail Dive](https://www.retaildive.com/news/poshmark-debuts-listing-videos-feature-to-showcase-sellers-items/596772)) |

**Lesson:** selling apps keep editing small. The things that matter for a seller are cutting the dead bits at the start and end, picking a good cover frame, and sometimes muting background noise. TikTok style effects, music and transitions don't sell more thrift jackets, and music brings licensing problems (SAMRO in South Africa).

## Recommended first version (4 tools)

1. **Trim:** drag a start and an end handle on a strip of frames. The preview loops only the kept part. Minimum 3 seconds.
2. **Cover:** slide to pick the frame shown in Explore, the shop grid and WhatsApp previews.
3. **Sound on or off:** mute the whole video (Depop mutes everything; we let the seller choose).
4. **Text:** one short line on the video (like "Size M, small mark on cuff"), placed top, middle or bottom.

Later, if sellers ask: speed, a brightness slider, joining several clips, auto captions.

## How each tool works without slowing phones down

The rule: **don't re-encode video on the phone if we can avoid it.** Re-encoding is slow, drains battery and is unreliable in Safari.

| Tool | With Mux (once the keys are in) | Without Mux (videos in Supabase storage, today) |
| --- | --- | --- |
| Trim | Upload the full video, then ask Mux to make a clipped copy with `inputs: [{ url: "mux://assets/<id>", start_time, end_time }]`, and delete the original. Frame accurate. Clips must be at least 0.5 seconds. ([Mux clips](https://www.mux.com/docs/guides/create-clips-from-your-videos.md)) | Cut on the phone with a keyframe copy (no re-encode), so the start can land up to a second or two early. Library to evaluate: Mediabunny (WebCodecs based, small). ffmpeg.wasm works (keyframe copy is near instant, frame accurate is slow: [DEV article](https://dev.to/alphashark/trimming-video-in-the-browser-without-uploading-to-a-server-27kg)), but its multi-threaded build can use about 2 GB of memory ([ffmpeg.wasm discussion](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/415)), which iPhones won't allow. |
| Cover | Save the chosen second; the picture is `image.mux.com/<playback>/thumbnail.jpg?time=<seconds>`, free. | Draw the chosen frame onto a canvas on the phone and upload it as the cover image. |
| Sound off | Save a "muted" flag and play muted. Optional: a clipped copy without audio. | Save a "muted" flag and play muted. |
| Text | Save the text and position with the post and draw it over the video in the app and on share previews. Nothing to re-encode. | Same. |

Not suitable: Mux **instant clips** (`?asset_start_time=`) are free and need no new asset, but they cut at segment level, so clips "may start or end a few seconds" off ([Mux instant clips](https://www.mux.com/docs/guides/create-instant-clips)). Fine for highlights, too rough for trimming a 15 second listing.

Phone apps (Capacitor, later): iOS and Android can trim natively and fast (AVFoundation on iOS). Plugins exist for Flutter ([native_video_trimmer](https://pub.dev/packages/native_video_trimmer)); for Capacitor we'd likely write a small plugin. Do this only if the web trim feels slow.

## What changes where

- **Database:** on `posts` (or `media`): `trim_start`, `trim_end` (seconds), `cover_time`, `muted`, `overlay_text`, `overlay_pos`. Server checks: start < end, length 3 seconds to the recording limit, text 60 characters, passes the same rude word and off app checks as captions.
- **mux-webhook:** when an upload is ready and has a trim, create the clip asset, then swap the playback id and delete the original.
- **App:** an `EditVideo` screen with the frame strip, two handles, a cover slider, a sound switch and a text box; the feed `Video` component plays muted when the flag says so and draws the text.
- **Share previews:** use the cover frame.

## Questions for Ofentse before building

1. Are these 4 tools the right first set? Anything to add or drop?
2. Should sound default to on or off? (Depop mutes everything.)
3. Mux first? Trimming is far better with Mux, so it makes sense to add the Mux keys before building this. [CONFIRM]

## Things not confirmed

- [CONFIRM] Safari on iPhone support for WebCodecs video and audio encoding, which a no-Mux trim would need. Check before building the storage fallback.
- [CONFIRM] Mux's cost for clip assets on basic quality (each clip is a new asset; storage and delivery are charged, encoding on basic may be free).

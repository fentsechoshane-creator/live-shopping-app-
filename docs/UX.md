# How screens should feel (UX rules)

Use these with docs/DESIGN.md on every new screen. They come from common practice in multi step forms and from how Vinted, Depop, TikTok and Whatnot handle selling.

## The rules

1. **One job per screen.** A screen asks for one decision or 3 to 5 related fields at most. Long forms become steps.
2. **Start with the easy, visual thing.** Selling starts with a photo or video, like Vinted and Depop. Typing comes after.
3. **Always show where you are.** Steps have a thin progress bar and "2 of 4" at the top.
4. **Every screen that isn't a main tab has Back, top left.** It goes to the previous screen (or a sensible screen if opened from a link), using `BackButton` or `useGoBack` in `components/ui.tsx`. **Back never loses work.** Back goes one step back with everything still filled in. Only the first page shows Close (X) and the mode switch (Camera, Create, Live).
5. **The main button lives at the bottom, in thumb reach.** One green button per screen, full width, at least 44 points tall. Its words say what happens: "Next", "Post listing", "Pay R311".
6. **Catch problems where they happen.** Check each step when you tap Next (for example, replicas are stopped on the title step), not only at the end.
7. **Tap, don't type, where you can.** Pick buttons for type and condition, size chips, a plus and minus stepper for stock, a number keypad for price.
8. **Show the money effect straight away.** As the seller types a price, show "You get R…" under it.
9. **Optional means skippable.** Optional steps say so and the button reads "Skip" until something is filled in.
10. **End with a review you can edit.** The last step shows everything with an Edit link on each row that jumps back to that step.
11. **Ask before a dead end.** If someone can't do something (a buyer tapping +), explain why in one sentence and offer Yes or No. No changes nothing.
12. **Give the real reason and the next step.** "You can't go live without stock. You have 1 of 5." plus a button that fixes it.
13. **Hide what you don't need right now.** Bars and switches disappear on later steps so the task fills the screen.
14. **Swipe where it's natural, tap still works.** Sheets drag down to close, the left edge swipes back, tabs swipe sideways, videos swipe left to the shop. Every swipe also has a button.
15. **Plain words.** Short sentences, no jargon, no hyphens or em dashes in app text.

## Ideas for later

- Done: drafts save automatically; suggestions from the photo; several photos with a cover.
- Haptic feedback on key taps on iPhone.

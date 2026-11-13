// Device emojis (Ofentse, 13 Nov): the phone's own emoji, not drawn icons, for categories, quick reactions in chat
// and celebration moments. Kept in one place so the set stays small and consistent.
import type { Category } from "../api";

export const CATEGORY_EMOJI: Record<Category, string> = { clothes: "👗", designer: "👜", beauty: "💄", food: "🧁" };

/** One tap reactions in live chat and messages. */
export const QUICK_EMOJI = ["❤️", "🔥", "😍", "😂", "👏", "🙌"];

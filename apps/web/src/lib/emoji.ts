// Device emojis (Ofentse, 13 Nov): the phone's own emoji, not drawn icons, for categories, quick reactions in chat
// and celebration moments. Kept in one place so the set stays small and consistent.
// Categories widened the same day: Fashion (new and thrift), Perfume, Home and furniture joined.
import type { Category } from "../api";

/** Every category, in the order buyers see them. `short` is for chips, `title` and `sub` for the seller's choice. */
export const CATEGORY_INFO: { id: Category; short: string; title: string; sub: string; buyerSub: string }[] = [
  { id: "clothes", short: "Fashion", title: "Fashion", sub: "New, local brands and thrift", buyerSub: "New and pre loved" },
  { id: "designer", short: "Designer", title: "Designer resale", sub: "Checked for authenticity", buyerSub: "Checked resale" },
  { id: "beauty", short: "Beauty", title: "Makeup and beauty", sub: "Makeup, skincare, hair and nails. Sealed products only", buyerSub: "Makeup, skin, hair" },
  { id: "fragrance", short: "Perfume", title: "Perfume and fragrance", sub: "Original bottles. Designer perfume is checked", buyerSub: "Original bottles" },
  { id: "home", short: "Home", title: "Home and furniture", sub: "Furniture, decor and new appliances", buyerSub: "Furniture and decor" },
  { id: "food", short: "Bakes", title: "Food and bakes", sub: "Made to order in Cape Town", buyerSub: "Cakes made to order" },
];
export const categoryTitle = (c: Category) => CATEGORY_INFO.find((x) => x.id === c)?.title ?? c;

export const CATEGORY_EMOJI: Record<Category, string> = { clothes: "👗", designer: "👜", beauty: "💄", fragrance: "🌸", home: "🛋️", food: "🧁" };

/** One tap reactions in live chat and messages. */
export const QUICK_EMOJI = ["❤️", "🔥", "😍", "😂", "👏", "🙌"];

// How the For You feed is ordered. This is the one place Lehloma's ranking engine plugs in.
// For now: posts from the categories picked on the welcome screens come first, mixed with others so
// the feed doesn't feel one note, and shops you follow get a small lift. Swap `rankFeed` for the engine.
import type { Category, FeedItem } from "../api";

export interface RankContext {
  interests: Category[];
  following: Set<string>;
}

export function rankFeed(items: FeedItem[], ctx: RankContext): FeedItem[] {
  if (!ctx.interests.length && !ctx.following.size) return items;
  const score = (it: FeedItem) => (ctx.interests.includes(it.shop.category) ? 2 : 0) + (ctx.following.has(it.shop.id) ? 1 : 0);
  const liked = items.filter((it) => score(it) > 0).sort((a, b) => score(b) - score(a));
  const rest = items.filter((it) => score(it) === 0);
  // Two picked posts, then one other, so people still discover new things.
  const out: FeedItem[] = [];
  while (liked.length || rest.length) {
    out.push(...liked.splice(0, 2));
    out.push(...rest.splice(0, 1));
  }
  return out;
}

const KEY = "lsa-interests";
export function savedInterests(): Category[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
export function keepInterests(list: Category[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

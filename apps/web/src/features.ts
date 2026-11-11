// Switches for features that aren't ready for real people yet. Off in the app stores until they are.
// Turn one on for a build with its VITE_ setting, for example VITE_LIVE=1 when live selling is finished.
export const FEATURES = {
  /** Live selling (LiveKit video, chat, pinned items, live auctions). On unless a build sets VITE_LIVE=0. */
  live: import.meta.env.VITE_LIVE !== "0",
  /** Lockers and pickup points through Bob Go. On unless a build sets VITE_LOCKERS=0. */
  lockers: import.meta.env.VITE_LOCKERS !== "0",
};

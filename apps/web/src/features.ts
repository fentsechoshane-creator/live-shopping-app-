// Switches for features that aren't ready for real people yet. Off in the app stores until they are.
// Turn one on for a build with its VITE_ setting, for example VITE_LIVE=1 when live selling is finished.
export const FEATURES = {
  /** Live selling (streams with Buy now cards). Apple rejects "coming soon" features, so it stays hidden until it works. */
  live: import.meta.env.VITE_LIVE === "1",
  /** PUDO lockers. The locker list is sample data until we have a PUDO account. */
  lockers: import.meta.env.VITE_LOCKERS === "1",
};

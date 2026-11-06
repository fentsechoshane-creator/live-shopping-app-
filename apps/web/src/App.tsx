import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { MockLabel } from "./screens/MockLabel";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSwipe } from "./components/gestures";
import { isNative, registerPush, setNavigator, startNative, statusBarFor } from "./native";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Welcome, hasSeenWelcome } from "./components/Welcome";
import { AccountSetup } from "./components/AccountSetup";
import { Avatar } from "./components/Avatar";
import { Viewer } from "./components/PostGrid";
import { api } from "./api";
import { useLoad, useSession } from "./session";
import { Icon } from "./components/Icon";
import { BackButton, Loading } from "./components/ui";
import { Feed } from "./screens/buyer/Feed";
import { Explore } from "./screens/buyer/Explore";
import { MockPay, OrderDetail, Orders } from "./screens/buyer/Orders";
import { Inbox, ShopPage, SignIn, SignInSheet } from "./screens/buyer/Account";
import { FindFriends, FriendThread, PersonPage } from "./screens/buyer/Friends";
import { RewardSurprise } from "./components/Rewards";
import { Profile } from "./screens/buyer/Profile";
import { Onboarding } from "./screens/seller/Onboarding";
import { Payouts, SellerOrderDetail, SellerOrders } from "./screens/seller/Selling";
import { Post, SellerGate } from "./screens/seller/Post";
import { TeamApp } from "./screens/team/Team";
import { Thread } from "./screens/buyer/Messages";
import { BlockedAccounts, DeliverySettings, DeleteAccountSheet, Privacy, Terms, CONTACT } from "./screens/Settings";
import { APP_VERSION, BUILT_AT } from "./lib/report";

function RequireUser({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** A shared item link (/i/<item>): open that item on its shop page. */
function ItemLink() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [item, error] = useLoad(() => api.productItem(id), [id]);
  // Auctions open on their own (a won auction is no longer listed in the shop, but the winner needs to pay).
  const single = item && item.product.mode === "auction";
  useEffect(() => { if (item && !single) nav(`/s/${item.shop.handle}?item=${id}`, { replace: true }); }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error || item === null) return <div className="screen"><BackButton /><div className="empty">This item isn't available any more.</div></div>;
  if (single) return <Viewer items={[item]} start={0} onClose={() => (window.history.length > 1 ? nav(-1) : nav("/"))} />;
  return <div className="screen"><Loading /></div>;
}

/** Floating glass tab bar. It turns dark over the video feed. */
function Tabs() {
  const { user } = useSession();
  const loc = useLocation();
  const [inbox, setInbox] = useState(0);
  const [toShip, setToShip] = useState(0);
  const [shop] = useLoad(() => (user ? api.myShop() : Promise.resolve(null)), [user?.id, loc.pathname]);
  // Inbox count: unread chats plus new updates. Me gets a dot when a seller has orders to ship.
  const [bump, setBump] = useState(0);
  useEffect(() => { const on = () => setBump((n) => n + 1); window.addEventListener("inbox-read", on); return () => window.removeEventListener("inbox-read", on); }, []);
  useEffect(() => {
    if (!user) { setInbox(0); return setToShip(0); }
    Promise.all([api.notifications(), api.conversations(), api.friendChats().catch(() => [])]).then(([n, c, f]) =>
      setInbox(n.filter((x) => !x.readAt && !/^\/(messages|chats)\//.test(x.link ?? "")).length + c.reduce((a, x) => a + x.unread, 0) + f.reduce((a, x) => a + x.unread, 0))).catch(() => {});
  }, [user, loc.pathname, bump]);
  useEffect(() => {
    if (!shop || shop.status === "onboarding") return setToShip(0);
    api.sellerOrders().then((o) => setToShip(o.filter((x) => x.status === "paid").length)).catch(() => {});
  }, [shop?.id, shop?.status, loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const onVideo = loc.pathname === "/";
  const nav = useNavigate();
  const [ask, setAsk] = useState(false);
  // Only sellers can post: without an open shop, + asks first instead of opening the post screen.
  const plus = (e: React.MouseEvent) => {
    if (!user) { e.preventDefault(); return nav("/signin?next=%2Fpost"); }
    if (!shop || shop.status !== "open") { e.preventDefault(); setAsk(true); }
  };
  return (
    <>
    <nav className={`tabs glass ${onVideo ? "on-video" : ""}`} aria-label="Main">
      <NavLink to="/" end><Icon name="home" /><span>Home</span></NavLink>
      <NavLink to="/explore"><Icon name="explore" /><span>Explore</span></NavLink>
      <NavLink to="/post" className="create" onClick={plus} aria-label="Post: camera, create a listing or go live"><Icon name="plus" strokeWidth={2.5} /></NavLink>
      <NavLink to="/inbox" aria-label={`Inbox${inbox ? `, ${inbox} new` : ""}`}>
        <Icon name="chat" /><span>Inbox</span>{inbox > 0 && <span className="badge">{inbox > 99 ? "99+" : inbox}</span>}
      </NavLink>
      <NavLink to="/me" aria-label={`Me${toShip ? `, ${toShip} to ship` : ""}`}><Icon name="user" /><span>Me</span>{toShip > 0 && <span className="dot" />}</NavLink>
    </nav>
    <SellerGate open={ask} onClose={() => setAsk(false)} onYes={() => setAsk(false)} unfinished={!!shop} />
    </>
  );
}

/** Side menu with account settings, opened from the menu button on the profile. */
function SideMenu() {
  const { user, menuOpen, setMenuOpen, dataSaver, setDataSaver, profile } = useSession();
  const nav = useNavigate();
  const [shop] = useLoad(() => (user && menuOpen ? api.myShop() : Promise.resolve(null)), [user?.id, menuOpen]);
  const [admin] = useLoad(() => (user && menuOpen ? api.isAdmin() : Promise.resolve(false)), [user?.id, menuOpen]);
  const [deleting, setDeleting] = useState(false);
  const swipeClose = useSwipe({ onRight: () => setMenuOpen(false) }); // swipe the menu away
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false); // Escape and Android back close the menu
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, setMenuOpen]);
  if (!menuOpen || !user) return null;
  // Deleting: show only the confirm sheet, not the menu behind it.
  if (deleting) return <DeleteAccountSheet onClose={() => { setDeleting(false); setMenuOpen(false); }} />;
  const go = (to: string) => { setMenuOpen(false); nav(to); };
  const name = profile?.displayName || profile?.handle || user.email?.split("@")[0] || "You";
  return (
    <div className="drawer-backdrop" onClick={(e) => e.target === e.currentTarget && setMenuOpen(false)}>
      <aside className="drawer glass" role="dialog" aria-modal="true" aria-label="Menu and settings" {...swipeClose}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div className="row">
            <Avatar url={profile?.avatarUrl} name={name} size={44} />
            <div><b>{name}</b><div className="small muted">{profile?.handle ? `@${profile.handle}` : user.email ?? user.phone}</div></div>
          </div>
          <button className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu"><Icon name="close" /></button>
        </div>
        <button className="cell" style={{ background: "var(--green-soft)", borderRadius: "var(--r)", marginBottom: 4 }}
          onClick={() => go(shop && shop.status !== "onboarding" ? "/me" : "/sell/start")}>
          <span className="icon-btn" style={{ background: "var(--green)", color: "#052e16", width: 36, height: 36, borderRadius: 10 }}><Icon name="store" size={18} /></span>
          <span className="grow"><span className="t" style={{ display: "block" }}>{shop && shop.status !== "onboarding" ? shop.name : "Start selling"}</span>
            <span className="s" style={{ display: "block" }}>{shop && shop.status !== "onboarding" ? "My shop: list items, orders to ship, payouts" : "Open your shop in a few minutes"}</span></span>
        </button>
        <div className="menu-h">Shopping</div>
        <div className="group">
          <MenuRow icon="bag" t="My orders" s="Track, return or rate an order" onClick={() => go("/orders")} />
          <MenuRow icon="help" t="Returns and help" s="7 day returns on Buy now, buyer protection" onClick={() => go("/help")} />
          <MenuRow icon="chat" t="Contact us" s={`${CONTACT}, we reply within 2 working days`} onClick={() => { window.location.href = `mailto:${CONTACT}?subject=${encodeURIComponent("myHaul help")}`; }} />
        </div>
        <div className="menu-h">Settings</div>
        <div className="group">
          <div className="cell">
            <span className="grow"><span className="t" style={{ display: "block" }}>Data saver</span><span className="s" style={{ display: "block" }}>Lower video quality on mobile data</span></span>
            <button className="switch" role="switch" aria-checked={dataSaver} aria-label="Data saver" onClick={() => setDataSaver(!dataSaver)} />
          </div>
          <MenuRow icon="pin" t="Delivery details" s="Where we send your orders" onClick={() => go("/settings/delivery")} />
          <MenuRow icon="block" t="Blocked accounts" s="People you blocked" onClick={() => go("/settings/blocked")} />
        </div>
        <div className="menu-h">Privacy and legal</div>
        <div className="group">
          <MenuRow icon="lock" t="Terms of Use" s="The rules for buying, selling and returns" onClick={() => go("/terms")} />
          <MenuRow icon="shield" t="Privacy Policy" s="How we use and protect your data" onClick={() => go("/privacy")} />
        </div>
        {admin && <>
          <div className="menu-h">Team</div>
          <div className="group"><MenuRow icon="team" t="Team dashboard" s="To do, accounts, orders and money" onClick={() => go("/team")} /></div>
        </>}
        <div style={{ flex: 1 }} />
        <button className="btn danger block" style={{ marginTop: 18 }} onClick={() => { setMenuOpen(false); api.signOut().then(() => nav("/")); }}>
          <Icon name="logout" size={18} />Log out
        </button>
        <button className="link" style={{ marginTop: 14, color: "var(--red-text)", alignSelf: "center" }} onClick={() => setDeleting(true)}>Delete my account</button>
        {api.demo && <button className="btn line block" style={{ marginTop: 8 }} onClick={() => { setMenuOpen(false); api.demo!.reset().then(() => nav("/")); }}>Reset demo data</button>}
        <p className="small muted" style={{ textAlign: "center", marginTop: 14, marginBottom: 0 }}>Version {APP_VERSION}{BUILT_AT ? `, updated ${BUILT_AT}` : ""}</p>
      </aside>
    </div>
  );
}

function MenuRow({ icon, t, s, onClick }: { icon: string; t: string; s: string; onClick: () => void }) {
  return (
    <button type="button" className="cell" onClick={onClick}>
      <span className="icon-btn" style={{ width: 34, height: 34, borderRadius: 10 }}><Icon name={icon} size={18} /></span>
      <span className="grow"><span className="t" style={{ display: "block" }}>{t}</span><span className="s" style={{ display: "block" }}>{s}</span></span>
      <span className="chev"><Icon name="chevron" size={18} /></span>
    </button>
  );
}

function Help() {
  return (
    <div className="screen">
      <BackButton />
      <h1>Returns and help</h1>
      <div className="group">
        <div className="cell"><span className="grow"><span className="t" style={{ display: "block" }}>Change your mind</span><span className="s" style={{ display: "block" }}>Buy now items can be returned within 7 days of delivery. You pay the return postage.</span></span></div>
        <div className="cell"><span className="grow"><span className="t" style={{ display: "block" }}>Wrong, faulty or not as described</span><span className="s" style={{ display: "block" }}>Ask for a return from the order. The seller pays the postage. Faulty items: up to 6 months.</span></span></div>
        <div className="cell"><span className="grow"><span className="t" style={{ display: "block" }}>Your money is held safely</span><span className="s" style={{ display: "block" }}>An escrow provider holds every payment until the return window closes.</span></span></div>
        <div className="cell"><span className="grow"><span className="t" style={{ display: "block" }}>Auctions and made to order food</span><span className="s" style={{ display: "block" }}>No change of mind returns, but you are covered if something is wrong.</span></span></div>
      </div>
      <h2>Still need help?</h2>
      <div className="group">
        <a className="cell" href={`mailto:${CONTACT}?subject=${encodeURIComponent("myHaul help")}`}><span className="grow"><span className="t" style={{ display: "block" }}>Email us at {CONTACT}</span><span className="s" style={{ display: "block" }}>We reply within 2 working days. Add your order number if it's about an order.</span></span></a>
        <Link className="cell" to="/terms"><span className="grow"><span className="t" style={{ display: "block" }}>Terms of Use</span><span className="s" style={{ display: "block" }}>The full rules for buying, selling, returns and refunds.</span></span></Link>
      </div>
    </div>
  );
}

const guard = (el: ReactNode) => <RequireUser>{el}</RequireUser>;

/** Old links and notifications to /activity still land in the right place. */
function OldActivity() {
  const tab = new URLSearchParams(useLocation().search).get("tab");
  return <Navigate to={tab === "orders" ? "/orders" : tab === "messages" ? "/inbox?tab=messages" : "/inbox?tab=updates"} replace />;
}

export function App() {
  const loc = useLocation();
  const nav = useNavigate();
  // Swipe in from the left edge to go back, like iPhone apps. Not on the main tabs.
  const edgeStart = useRef<{ x: number; y: number } | null>(null);
  const isTabRoot = ["/", "/explore", "/inbox", "/me", "/post"].includes(loc.pathname);
  // Only in the installed app: Safari and Chrome already swipe back from the edge, and doing it too would go back two screens.
  const standalone = isNative || (typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true));
  const { user, needsSetup } = useSession();
  // First open: the welcome screens, but not when someone arrives on a shared link (show it later, on the feed).
  const [welcome, setWelcome] = useState(() => !hasSeenWelcome() && loc.pathname === "/");
  useEffect(() => { if (loc.pathname === "/" && !hasSeenWelcome()) setWelcome(true); }, [loc.pathname]);
  useEffect(() => { setNavigator((path) => nav(path)); startNative(() => (window.history.length > 1 ? nav(-1) : nav("/"))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { statusBarFor(welcome || loc.pathname === "/" || loc.pathname.startsWith("/post")); }, [loc.pathname, welcome]);
  // Only re-registers if notifications were already allowed. The question itself comes after an order or a first message.
  useEffect(() => { if (user) registerPush((token, platform) => api.savePushToken(token, platform)); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const edgeBack = {
    onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]; edgeStart.current = standalone && t.clientX < 24 && !isTabRoot ? { x: t.clientX, y: t.clientY } : null; },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = edgeStart.current; edgeStart.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      if (t.clientX - s.x > 70 && Math.abs(t.clientY - s.y) < 60) (loc.key !== "default" ? nav(-1) : nav("/"));
    },
  };
  // The team dashboard is a full width page for laptops, outside the phone layout.
  if (loc.pathname === "/team" || loc.pathname.startsWith("/team/")) return <TeamApp />;
  return (
    <div className="phone">
      <div className="content" {...edgeBack}>
        <ErrorBoundary resetKey={loc.pathname} onHome={() => nav("/")}>
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/s/:handle" element={<ShopPage />} />
          <Route path="/i/:id" element={<ItemLink />} />
          <Route path="/help" element={<Help />} />
          <Route path="/orders" element={guard(<Orders />)} />
          <Route path="/orders/:id" element={guard(<OrderDetail />)} />
          <Route path="/mock-pay/:id" element={guard(<MockPay />)} />
          <Route path="/mock-label/:ref" element={<MockLabel />} />
          <Route path="/inbox" element={guard(<Inbox />)} />
          <Route path="/activity" element={<OldActivity />} />
          <Route path="/me" element={guard(<Profile />)} />
          <Route path="/sell" element={<Navigate to="/me?tab=selling" replace />} />
          <Route path="/sell/start" element={guard(<Onboarding />)} />
          <Route path="/post" element={guard(<Post />)} />
          <Route path="/sell/new" element={<Navigate to="/post?mode=create" replace />} />
          <Route path="/sell/orders" element={guard(<SellerOrders />)} />
          <Route path="/sell/orders/:id" element={guard(<SellerOrderDetail />)} />
          <Route path="/sell/payouts" element={guard(<Payouts />)} />
          <Route path="/admin" element={<Navigate to="/team" replace />} />
          <Route path="/messages/:id" element={guard(<Thread />)} />
          <Route path="/chats/:id" element={guard(<FriendThread />)} />
          <Route path="/friends" element={guard(<FindFriends />)} />
          <Route path="/u/:handle" element={guard(<PersonPage />)} />
          <Route path="/settings/blocked" element={guard(<BlockedAccounts />)} />
          <Route path="/settings/delivery" element={guard(<DeliverySettings />)} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="*" element={<div className="screen"><BackButton /><div className="empty">Page not found.</div></div>} />
        </Routes>
        </ErrorBoundary>
        {!loc.pathname.startsWith("/post") && <Tabs />}
        <SideMenu />
        {user && !welcome && !loc.pathname.startsWith("/post") && !loc.pathname.startsWith("/mock-pay") && <RewardSurprise />}
        <SignInSheet />
        {welcome && <Welcome onDone={() => setWelcome(false)} />}
        {needsSetup && <AccountSetup />}
      </div>
    </div>
  );
}

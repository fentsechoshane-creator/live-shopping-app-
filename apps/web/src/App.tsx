import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
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
import { Activity, ShopPage, SignIn, SignInSheet } from "./screens/buyer/Account";
import { Profile } from "./screens/buyer/Profile";
import { Onboarding } from "./screens/seller/Onboarding";
import { Payouts, SellerOrderDetail, SellerOrders } from "./screens/seller/Selling";
import { Post, SellerGate } from "./screens/seller/Post";
import { Admin } from "./screens/admin/Admin";
import { Thread } from "./screens/buyer/Messages";
import { BlockedAccounts, DeleteAccountSheet, Privacy } from "./screens/Settings";

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
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!user) return setUnread(0);
    api.notifications().then((n) => setUnread(n.filter((x) => !x.readAt).length)).catch(() => {});
  }, [user, loc.pathname]);
  const onVideo = loc.pathname === "/";
  const nav = useNavigate();
  const [shop] = useLoad(() => (user ? api.myShop() : Promise.resolve(null)), [user?.id, loc.pathname]);
  const [ask, setAsk] = useState(false);
  // Only sellers can post: without an open shop, + asks first instead of opening the post screen.
  const plus = (e: React.MouseEvent) => {
    if (!user) { e.preventDefault(); return nav("/signin?next=%2Fpost"); }
    if (!shop || shop.status !== "open") { e.preventDefault(); setAsk(true); }
  };
  return (
    <>
    <nav className={`tabs glass ${onVideo ? "on-video" : ""}`} aria-label="Main">
      <NavLink to="/" end aria-label="Home"><Icon name="home" /></NavLink>
      <NavLink to="/explore" aria-label="Explore"><Icon name="explore" /></NavLink>
      <NavLink to="/post" className="create" onClick={plus} aria-label="Post: camera, create a listing or go live"><Icon name="plus" strokeWidth={2.5} /></NavLink>
      <NavLink to="/activity" aria-label={`Activity${unread ? `, ${unread} new` : ""}`}>
        <Icon name="bell" />{unread > 0 && <span className="badge">{unread}</span>}
      </NavLink>
      <NavLink to="/me" aria-label="My profile"><Icon name="user" /></NavLink>
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
        <button className="cell" style={{ background: "var(--green-soft)", borderRadius: "var(--r)", marginBottom: 14 }}
          onClick={() => go(shop && shop.status !== "onboarding" ? "/me?tab=selling" : "/sell/start")}>
          <span className="icon-btn" style={{ background: "var(--green)", color: "#052e16", width: 36, height: 36, borderRadius: 10 }}><Icon name="store" size={18} /></span>
          <span className="grow"><span className="t" style={{ display: "block" }}>{shop && shop.status !== "onboarding" ? shop.name : "Start selling"}</span>
            <span className="s" style={{ display: "block" }}>{shop && shop.status !== "onboarding" ? "Your shop, orders and payouts" : "Open your shop in a few minutes"}</span></span>
        </button>
        <div className="group">
          <MenuRow icon="bag" t="Orders" s="Track, return or rate an order" onClick={() => go("/orders")} />
          {shop && shop.status !== "onboarding" && <MenuRow icon="truck" t="Orders to ship" s="Ship within 2 days" onClick={() => go("/sell/orders")} />}
          {shop && shop.status !== "onboarding" && <MenuRow icon="payout" t="Payouts" s="Paid once the return window closes" onClick={() => go("/sell/payouts")} />}
          <MenuRow icon="bell" t="Notifications" s="Orders, returns and shop updates" onClick={() => go("/activity")} />
          <MenuRow icon="help" t="Returns and help" s="7 day returns on Buy now, buyer protection" onClick={() => go("/help")} />
          {admin && <MenuRow icon="team" t="Team" s="Reports, checks, returns and top ups" onClick={() => go("/admin")} />}
        </div>
        <div className="group" style={{ marginTop: 14 }}>
          <MenuRow icon="chat" t="Messages" s="Chats with buyers and sellers" onClick={() => go("/activity?tab=messages")} />
          <MenuRow icon="block" t="Blocked accounts" s="People you blocked" onClick={() => go("/settings/blocked")} />
          <MenuRow icon="lock" t="Privacy and terms" s="How we use your data, community rules" onClick={() => go("/privacy")} />
        </div>
        <div className="group" style={{ marginTop: 14 }}>
          <div className="cell">
            <span className="grow"><span className="t" style={{ display: "block" }}>Data saver</span><span className="s" style={{ display: "block" }}>Lower video quality on mobile data</span></span>
            <button className="switch" role="switch" aria-checked={dataSaver} aria-label="Data saver" onClick={() => setDataSaver(!dataSaver)} />
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn danger block" style={{ marginTop: 18 }} onClick={() => { setMenuOpen(false); api.signOut().then(() => nav("/")); }}>
          <Icon name="logout" size={18} />Log out
        </button>
        <button className="link" style={{ marginTop: 14, color: "var(--red-text)", alignSelf: "center" }} onClick={() => setDeleting(true)}>Delete my account</button>
        {api.demo && <button className="btn line block" style={{ marginTop: 8 }} onClick={() => { setMenuOpen(false); api.demo!.reset().then(() => nav("/")); }}>Reset demo data</button>}
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
    </div>
  );
}

const guard = (el: ReactNode) => <RequireUser>{el}</RequireUser>;

export function App() {
  const loc = useLocation();
  const nav = useNavigate();
  // Swipe in from the left edge to go back, like iPhone apps. Not on the main tabs.
  const edgeStart = useRef<{ x: number; y: number } | null>(null);
  const isTabRoot = ["/", "/explore", "/activity", "/me", "/post"].includes(loc.pathname);
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
          <Route path="/activity" element={guard(<Activity />)} />
          <Route path="/me" element={guard(<Profile />)} />
          <Route path="/sell" element={<Navigate to="/me?tab=selling" replace />} />
          <Route path="/sell/start" element={guard(<Onboarding />)} />
          <Route path="/post" element={guard(<Post />)} />
          <Route path="/sell/new" element={<Navigate to="/post?mode=create" replace />} />
          <Route path="/sell/orders" element={guard(<SellerOrders />)} />
          <Route path="/sell/orders/:id" element={guard(<SellerOrderDetail />)} />
          <Route path="/sell/payouts" element={guard(<Payouts />)} />
          <Route path="/admin" element={guard(<Admin />)} />
          <Route path="/messages/:id" element={guard(<Thread />)} />
          <Route path="/settings/blocked" element={guard(<BlockedAccounts />)} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<div className="screen"><BackButton /><div className="empty">Page not found.</div></div>} />
        </Routes>
        </ErrorBoundary>
        {!loc.pathname.startsWith("/post") && <Tabs />}
        <SideMenu />
        <SignInSheet />
        {welcome && <Welcome onDone={() => setWelcome(false)} />}
        {needsSetup && <AccountSetup />}
      </div>
    </div>
  );
}

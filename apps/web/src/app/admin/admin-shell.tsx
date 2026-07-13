"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  UserRound,
  X
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import {
  activeNavigationGroup,
  breadcrumbLabels,
  getAdminNavigation,
  hasAdminAccess,
  hasAdminPermission,
  type AdminPermission
} from "./admin-navigation";
import { isAdminDemoMode, isAdminDemoPath } from "./admin-demo-mode";
import { ToastProvider } from "./admin-ui";

type SessionUser = { id: string; email: string | null; fullName: string; roles: string[] };
type AuthSession = { accessToken: string; expiresInSeconds: number; user: SessionUser };
type AdminSessionContextValue = {
  apiUrl: string;
  accessToken: string;
  user: SessionUser;
  can: (permission: AdminPermission) => boolean;
  apiRequest: <T>(path: string, options?: RequestInit) => Promise<T>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);
const collapseStorageKey = "doctobook_admin_sidebar_collapsed";

export function AdminShell({ apiUrl, appName, children }: { apiUrl: string; appName: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigation = useMemo(() => getAdminNavigation(), []);
  const demoMode = isAdminDemoMode();
  const activeGroup = activeNavigationGroup(pathname) ?? "Dashboard";
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set([activeGroup]));
  const profileRef = useRef<HTMLDivElement>(null);

  const authRequest = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) }
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
      throw new Error(typeof payload?.message === "string" ? payload.message : "Authentication failed");
    }
    return (await response.json()) as T;
  }, [apiUrl]);

  const restoreSession = useCallback(async () => {
    setIsLoading(true);
    const restored = await authRequest<AuthSession>("/v1/auth/refresh", { method: "POST", body: "{}" }).catch(() => null);
    if (restored && !hasAdminAccess(restored.user.roles)) {
      await authRequest("/v1/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
      setSession(null);
      setError("This account does not have administration access.");
    } else setSession(restored);
    setIsLoading(false);
  }, [authRequest]);

  useEffect(() => { void restoreSession(); }, [restoreSession]);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(collapseStorageKey) === "true");
  }, []);
  useEffect(() => {
    if (!session) return;
    const delay = Math.max(30_000, (session.expiresInSeconds - 60) * 1000);
    const timer = window.setTimeout(() => void restoreSession(), delay);
    return () => window.clearTimeout(timer);
  }, [restoreSession, session]);
  useEffect(() => {
    setExpandedGroups((current) => new Set(current).add(activeGroup));
    setMobileOpen(false);
  }, [activeGroup, pathname]);
  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIsLoading(true); setError("");
    try {
      const next = await authRequest<AuthSession>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password, deviceName: "DoctoBook admin web" }) });
      if (!hasAdminAccess(next.user.roles)) {
        await authRequest("/v1/auth/logout", { method: "POST", body: "{}" });
        throw new Error("This account does not have administration access.");
      }
      setSession(next); setPassword("");
    } catch (loginError) { setError(loginError instanceof Error ? loginError.message : "Unable to sign in"); }
    finally { setIsLoading(false); }
  }

  async function handleLogout() {
    setSession(null); setProfileOpen(false);
    await authRequest("/v1/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
  }

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(collapseStorageKey, String(next));
      return next;
    });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const term = search.trim().toLowerCase();
    if (!term || !session) return;
    const item = navigation.flatMap((group) => group.items).find((candidate) => hasAdminPermission(session.user.roles, candidate.permission) && candidate.label.toLowerCase().includes(term));
    if (item) { router.push(item.href); setSearch(""); }
  }

  const contextValue = useMemo<AdminSessionContextValue | null>(() => {
    if (!session) return null;
    return {
      apiUrl,
      accessToken: session.accessToken,
      user: session.user,
      can: (permission) => hasAdminPermission(session.user.roles, permission),
      apiRequest: async <T,>(path: string, options: RequestInit = {}) => {
        const response = await fetch(`${apiUrl}${path}`, {
          ...options,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}`, ...(options.headers ?? {}) }
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: unknown; error?: unknown; issues?: Array<{ message?: string }> } | null;
          const message = typeof payload?.message === "string" ? payload.message : typeof payload?.error === "string" ? payload.error : payload?.issues?.[0]?.message ?? `Request failed with ${response.status}`;
          throw new Error(message);
        }
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }
    };
  }, [apiUrl, session]);

  if (isLoading && !session) return <main className="admin-v2-auth"><div className="admin-v2-auth-loading"><span className="admin-v2-brand-mark"><ShieldCheck size={24} /></span><p>Restoring your secure session…</p></div></main>;
  if (!session || !contextValue) return (
    <main className="admin-v2-auth">
      <form className="admin-v2-login" onSubmit={handleLogin}>
        <div className="admin-v2-login-brand"><span className="admin-v2-brand-mark"><ShieldCheck size={24} /></span><div><strong>{appName}</strong><span>Super Admin Console</span></div></div>
        <div><p className="admin-v2-eyebrow">Secure administration</p><h1>Welcome back</h1><p>Use your approved administrator account to continue.</p></div>
        <label>Email address<input autoComplete="username" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
        <label>Password<input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
        {error && <div className="admin-v2-alert error" role="alert">{error}</div>}
        <button className="primary-button" disabled={isLoading} type="submit">{isLoading ? "Signing in…" : "Sign in securely"}</button>
        <Link href="/">Return to marketplace</Link>
      </form>
    </main>
  );

  const sidebar = (
    <>
      <div className="admin-v2-sidebar-brand">
        <span className="admin-v2-brand-mark"><ShieldCheck size={21} /></span>
        {!collapsed && <div><strong>{appName}</strong><span>Super Admin</span></div>}
        <button aria-label="Close navigation" className="admin-v2-mobile-close" onClick={() => setMobileOpen(false)} type="button"><X size={20} /></button>
      </div>
      <nav aria-label="Super Admin navigation" className="admin-v2-nav">
        {navigation.map((group) => {
          const visible = group.items.filter((item) => hasAdminPermission(session.user.roles, item.permission));
          if (!visible.length) return null;
          const open = expandedGroups.has(group.label);
          const GroupIcon = group.icon;
          return <div className="admin-v2-nav-group" key={group.label}>
            <button aria-expanded={open} className={activeGroup === group.label ? "active" : ""} onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (next.has(group.label)) next.delete(group.label); else next.add(group.label); return next; })} title={collapsed ? group.label : undefined} type="button">
              <GroupIcon size={18} /><span>{group.label}</span>{!collapsed && (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
            </button>
            {open && <div className="admin-v2-subnav">
              {visible.map((item) => { const Icon = item.icon; const active = item.href === "/admin" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`); return <Link aria-current={active ? "page" : undefined} className={active ? "active" : ""} href={item.href} key={item.href} title={collapsed ? item.label : undefined}><Icon size={16} /><span>{item.label}</span></Link>; })}
            </div>}
          </div>;
        })}
      </nav>
      <div className="admin-v2-sidebar-footer">
        <button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleCollapsed} title={collapsed ? "Expand sidebar" : undefined} type="button">{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span>{collapsed ? "" : "Collapse sidebar"}</span></button>
      </div>
    </>
  );

  const crumbs = breadcrumbLabels(pathname);
  return (
    <AdminSessionContext.Provider value={contextValue}>
      <ToastProvider>
        <div className={`admin-v2-shell${collapsed ? " collapsed" : ""}`}>
          <aside className="admin-v2-sidebar">{sidebar}</aside>
          {mobileOpen && <div className="admin-v2-mobile-overlay" onMouseDown={(event) => event.target === event.currentTarget && setMobileOpen(false)}><aside className="admin-v2-mobile-sidebar">{sidebar}</aside></div>}
          <div className="admin-v2-workspace">
            <header className="admin-v2-header">
              <button aria-label="Open navigation" className="admin-v2-menu-button" onClick={() => setMobileOpen(true)} type="button"><Menu size={20} /></button>
              <div className="admin-v2-header-context">
                <nav aria-label="Breadcrumb"><Link href="/admin">Admin</Link>{crumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><ChevronRight size={13} />{crumb}</span>)}</nav>
              </div>
              <form className="admin-v2-global-search" onSubmit={submitSearch}><Search size={17} /><input aria-label="Global search" onChange={(event) => setSearch(event.target.value)} placeholder="Search admin sections…" value={search} /></form>
              <div className="admin-v2-header-actions">
                {!demoMode && <div className="admin-v2-popover-wrap">
                  <button aria-expanded={notificationsOpen} aria-label="Notifications" className="admin-v2-icon-button" onClick={() => setNotificationsOpen((current) => !current)} type="button"><Bell size={19} /><span className="admin-v2-notification-dot" /></button>
                  {notificationsOpen && <div className="admin-v2-popover admin-v2-notification-popover"><strong>Notifications</strong><p>No new administrative alerts.</p><Link href="/admin/notifications/logs" onClick={() => setNotificationsOpen(false)}>View delivery logs</Link></div>}
                </div>}
                <div className="admin-v2-profile" ref={profileRef}>
                  <button aria-expanded={profileOpen} onClick={() => setProfileOpen((current) => !current)} type="button"><span className="admin-v2-avatar"><UserRound size={17} /></span><span className="admin-v2-profile-copy"><strong>{session.user.fullName}</strong><small>{session.user.roles.includes("super_admin") ? "Super Administrator" : "Clinic Administrator"}</small></span><ChevronDown size={15} /></button>
                  {profileOpen && <div className="admin-v2-popover admin-v2-profile-menu"><div><strong>{session.user.fullName}</strong><span>{session.user.email}</span></div><button onClick={() => void handleLogout()} type="button"><LogOut size={16} />Sign out</button></div>}
                </div>
              </div>
            </header>
            <main className="admin-v2-content">{isAdminDemoPath(pathname) ? children : <AdminDemoHiddenRoute />}</main>
          </div>
        </div>
      </ToastProvider>
    </AdminSessionContext.Provider>
  );
}

function AdminDemoHiddenRoute() {
  return (
    <>
      <div className="admin-v2-page-header">
        <div>
          <p>Admin demo</p>
          <h1>Demo area limited</h1>
          <span>This staging walkthrough is focused on clinics, doctors, and services.</span>
        </div>
      </div>
      <section className="admin-v2-card admin-v2-capability-gap">
        <span className="admin-v2-brand-mark"><ShieldCheck size={23} /></span>
        <h2>Available demo sections</h2>
        <p>Use the sidebar to continue with clinic setup, doctor registration, and service configuration.</p>
        <div className="admin-v2-section-actions">
          <Link className="primary-button" href="/admin/clinics">Clinics</Link>
          <Link className="primary-button" href="/admin/doctors">Doctors</Link>
          <Link className="primary-button" href="/admin/services">Services</Link>
        </div>
      </section>
    </>
  );
}

export function useAdminSession() {
  const context = useContext(AdminSessionContext);
  if (!context) throw new Error("useAdminSession must be used inside AdminShell");
  return context;
}

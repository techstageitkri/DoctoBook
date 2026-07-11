"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";

type SessionUser = {
  id: string;
  email: string | null;
  fullName: string;
  roles: string[];
};

type AuthSession = {
  accessToken: string;
  expiresInSeconds: number;
  user: SessionUser;
};

type AdminSessionContextValue = {
  apiUrl: string;
  accessToken: string;
  user: SessionUser;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);
const adminRoles = new Set(["super_admin", "clinic_admin"]);

const navigation = [
  { href: "/admin", label: "Clinics" },
  { href: "/admin/doctors", label: "Doctors" },
  { href: "/admin/services", label: "Services" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/appointments", label: "Appointments" },
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/refunds", label: "Refunds" },
  { href: "/admin/reports", label: "Reports" }
];

export function AdminShell({
  apiUrl,
  appName,
  children
}: {
  apiUrl: string;
  appName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void restoreSession();
  }, []);

  useEffect(() => {
    if (!session) return;
    const refreshDelay = Math.max(30_000, (session.expiresInSeconds - 60) * 1_000);
    const timer = window.setTimeout(() => void restoreSession(), refreshDelay);
    return () => window.clearTimeout(timer);
  }, [session]);

  async function authRequest<T>(path: string, options: RequestInit = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      }
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
      throw new Error(typeof payload?.message === "string" ? payload.message : "Authentication failed");
    }

    return (await response.json()) as T;
  }

  async function restoreSession() {
    setIsLoading(true);
    const restored = await authRequest<AuthSession>("/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({})
    }).catch(() => null);
    if (restored && !restored.user.roles.some((role) => adminRoles.has(role))) {
      await authRequest("/v1/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => null);
      setSession(null);
      setError("This account does not have portal access");
    } else {
      setSession(restored);
    }
    setIsLoading(false);
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const nextSession = await authRequest<AuthSession>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, deviceName: "DoctoBook admin web" })
      });

      if (!nextSession.user.roles.some((role) => adminRoles.has(role))) {
        await authRequest("/v1/auth/logout", { method: "POST", body: JSON.stringify({}) });
        throw new Error("This account does not have portal access");
      }

      setSession(nextSession);
      setPassword("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to sign in");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogout() {
    setSession(null);
    await authRequest("/v1/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => null);
  }

  const contextValue = useMemo(
    () => (session ? { apiUrl, accessToken: session.accessToken, user: session.user } : null),
    [apiUrl, session]
  );

  if (isLoading && !session) {
    return <main className="admin-auth-screen"><p>Restoring your session...</p></main>;
  }

  if (!session || !contextValue) {
    return (
      <main className="admin-auth-screen">
        <form className="admin-login-panel" onSubmit={handleLogin}>
          <div>
            <p className="eyebrow">Secure administration</p>
            <h1>{appName}</h1>
            <p>Sign in with an approved administrator account.</p>
          </div>
          <label className="field">
            Email
            <input autoComplete="username" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <label className="field">
            Password
            <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          {error && <div className="status-message error" role="alert">{error}</div>}
          <button className="primary-button" disabled={isLoading} type="submit">
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
          <Link className="admin-back-link" href="/">Back to marketplace</Link>
        </form>
      </main>
    );
  }

  return (
    <AdminSessionContext.Provider value={contextValue}>
      <main className="portal-shell">
        <aside className="portal-sidebar">
          <div>
            <p className="eyebrow">Administration</p>
            <h1>{appName}</h1>
          </div>
          <nav aria-label="Admin navigation">
            {navigation.map((item) => {
              const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
              return <Link className={`nav-item${active ? " active" : ""}`} href={item.href} key={item.href}>{item.label}</Link>;
            })}
          </nav>
          <div className="admin-account">
            <strong>{session.user.fullName}</strong>
            <span>{session.user.email}</span>
            <button onClick={handleLogout} type="button">Sign out</button>
          </div>
        </aside>
        <section className="portal-main">{children}</section>
      </main>
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession() {
  const context = useContext(AdminSessionContext);
  if (!context) {
    throw new Error("useAdminSession must be used inside AdminShell");
  }
  return context;
}

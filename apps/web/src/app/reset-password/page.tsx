"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { getPublicApiUrl } from "../public-api-url";

const apiUrl = getPublicApiUrl();

type ResetState = "idle" | "submitting" | "complete" | "error";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordShell state="idle" token="" password="" onPasswordChange={() => undefined} onSubmit={() => undefined} onTokenChange={() => undefined} />}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const initialToken = searchParams.get("token") ?? "";
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<ResetState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const fragmentToken = readTokenFromFragment();
    const nextToken = fragmentToken || initialToken;

    if (fragmentToken || initialToken) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    if (nextToken) {
      setToken(nextToken);
    }
  }, [initialToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setMessage("");

    try {
      const response = await fetch(`${apiUrl}/v1/auth/password/reset`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), newPassword: password })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
        throw new Error(
          typeof payload?.message === "string"
            ? payload.message
            : typeof payload?.error === "string"
              ? payload.error
              : "Password reset failed"
        );
      }

      setState("complete");
      setMessage("Your password has been reset. You can now sign in.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Password reset failed");
    }
  }

  return (
    <ResetPasswordShell
      message={message}
      onPasswordChange={setPassword}
      onSubmit={submit}
      onTokenChange={setToken}
      password={password}
      state={state}
      token={token}
    />
  );
}

function readTokenFromFragment() {
  if (typeof window === "undefined" || !window.location.hash) {
    return "";
  }

  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));

  return params.get("token") ?? "";
}

function ResetPasswordShell({
  state,
  token,
  password,
  message,
  onSubmit,
  onTokenChange,
  onPasswordChange
}: {
  state: ResetState;
  token: string;
  password: string;
  message?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTokenChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
}) {
  return (
    <main className="patient-v2-auth-page">
      <section className="patient-v2-card patient-v2-auth-panel">
        <span className="patient-v2-brand-icon"><KeyRound size={25} /></span>
        <div className="patient-v2-card-heading">
          <div>
            <p>Account recovery</p>
            <h1>Reset your password</h1>
          </div>
        </div>
        {message ? <div className={state === "error" ? "patient-v2-alert error" : "patient-v2-alert success"} role="status">{message}</div> : null}
        {state === "complete" ? (
          <Link className="primary-button" href="/patient">Sign in</Link>
        ) : (
          <form className="patient-v2-auth-card" onSubmit={onSubmit}>
            <label>
              Reset token
              <input onChange={(event) => onTokenChange(event.target.value)} required value={token} />
            </label>
            <label>
              New password
              <input autoComplete="new-password" minLength={8} onChange={(event) => onPasswordChange(event.target.value)} required type="password" value={password} />
            </label>
            <button className="primary-button" disabled={state === "submitting"} type="submit">
              <ShieldCheck size={16} />{state === "submitting" ? "Resetting..." : "Reset password"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

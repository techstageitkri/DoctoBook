"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, MailCheck, ShieldCheck, XCircle } from "lucide-react";
import { getPublicApiUrl } from "../public-api-url";

const apiUrl = getPublicApiUrl();

type VerificationState = "idle" | "verifying" | "verified" | "error";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailShell state="verifying" token="" onSubmit={() => undefined} onTokenChange={() => undefined} />}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const initialToken = searchParams.get("token") ?? "";
  const [token, setToken] = useState(initialToken);
  const [state, setState] = useState<VerificationState>(initialToken ? "verifying" : "idle");
  const [message, setMessage] = useState(initialToken ? "Verifying your email..." : "");

  useEffect(() => {
    const fragmentToken = readTokenFromFragment();
    const nextToken = fragmentToken || initialToken;

    if (fragmentToken || initialToken) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    if (!nextToken) {
      return;
    }

    setToken(nextToken);
    void verifyToken(nextToken);
  }, [initialToken]);

  async function verifyToken(nextToken = token) {
    const trimmed = nextToken.trim();

    if (!trimmed) {
      setState("error");
      setMessage("Enter the verification token from your email.");
      return;
    }

    setState("verifying");
    setMessage("Verifying your email...");

    try {
      const response = await fetch(`${apiUrl}/v1/auth/email-verification/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
        throw new Error(
          typeof payload?.message === "string"
            ? payload.message
            : typeof payload?.error === "string"
              ? payload.error
              : "Verification failed"
        );
      }

      setState("verified");
      setMessage("Your email is verified. You can now sign in to DoctoBook.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Verification failed");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void verifyToken();
  }

  return (
    <VerifyEmailShell
      message={message}
      onSubmit={submit}
      onTokenChange={setToken}
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

function VerifyEmailShell({
  state,
  token,
  message,
  onSubmit,
  onTokenChange
}: {
  state: VerificationState;
  token: string;
  message?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTokenChange: (value: string) => void;
}) {
  const Icon = state === "verified" ? CheckCircle2 : state === "error" ? XCircle : MailCheck;

  return (
    <main className="patient-v2-auth-page">
      <section className="patient-v2-card patient-v2-auth-panel">
        <span className="patient-v2-brand-icon"><Icon size={25} /></span>
        <div className="patient-v2-card-heading">
          <div>
            <p>Email verification</p>
            <h1>{state === "verified" ? "Email verified" : "Verify your email"}</h1>
          </div>
        </div>
        {message ? <div className={state === "error" ? "patient-v2-alert error" : "patient-v2-alert success"} role="status">{message}</div> : null}
        {state !== "verified" ? (
          <form className="patient-v2-auth-card" onSubmit={onSubmit}>
            <label>
              Manual token
              <input
                autoComplete="one-time-code"
                onChange={(event) => onTokenChange(event.target.value)}
                placeholder="Paste the verification token"
                required
                value={token}
              />
            </label>
            <button className="primary-button" disabled={state === "verifying"} type="submit">
              <ShieldCheck size={16} />{state === "verifying" ? "Verifying..." : "Verify email"}
            </button>
          </form>
        ) : (
          <Link className="primary-button" href="/patient">Sign in to your account</Link>
        )}
      </section>
    </main>
  );
}

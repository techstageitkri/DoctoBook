"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck, Stethoscope } from "lucide-react";

export default function DoctorInvitationAcceptPage() {
  return (
    <Suspense fallback={<DoctorInvitationShell token="" />}>
      <DoctorInvitationContent />
    </Suspense>
  );
}

function DoctorInvitationContent() {
  const searchParams = useSearchParams();
  const initialToken = searchParams.get("token") ?? "";
  const [token, setToken] = useState(initialToken);

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

  return <DoctorInvitationShell token={token} />;
}

function readTokenFromFragment() {
  if (typeof window === "undefined" || !window.location.hash) {
    return "";
  }

  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));

  return params.get("token") ?? "";
}

function DoctorInvitationShell({ token }: { token: string }) {
  return (
    <main className="patient-v2-auth-page">
      <section className="patient-v2-card patient-v2-auth-panel">
        <span className="patient-v2-brand-icon"><MailCheck size={25} /></span>
        <div className="patient-v2-card-heading">
          <div>
            <p>Doctor invitation</p>
            <h1>Clinic invitation received</h1>
          </div>
        </div>
        <div className="patient-v2-info-note">
          <Stethoscope size={17} />
          <span>
            Your invitation token is ready. The invitation acceptance API is not available yet, so keep this email and continue through doctor onboarding with your clinic administrator.
          </span>
        </div>
        {token ? (
          <label className="patient-v2-token-fallback">
            Invitation token
            <input readOnly value={token} />
          </label>
        ) : null}
        <Link className="primary-button" href="/admin/doctors/new">Open doctor registration</Link>
      </section>
    </main>
  );
}

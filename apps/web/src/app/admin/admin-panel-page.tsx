"use client";

import { useEffect, useState } from "react";
import { AppointmentOperationsPanel } from "../appointment-operations-panel";
import { DoctorAvailabilityPanel } from "../doctor-availability-panel";
import { DoctorOnboardingPanel } from "../doctor-onboarding-panel";
import { RefundRecoveryPanel } from "../refund-recovery-panel";
import { ReviewModerationPanel } from "../review-moderation-panel";
import { ServiceConfigurationPanel } from "../service-configuration-panel";
import { useAdminSession } from "./admin-shell";

type Section = "doctors" | "services" | "availability" | "appointments" | "reviews" | "refunds";
type Clinic = { id: string; name: string; status: string };

const titles: Record<Section, { eyebrow: string; title: string; description: string }> = {
  doctors: { eyebrow: "Provider network", title: "Doctor onboarding", description: "Review identities, documents, approvals, and clinic associations." },
  services: { eyebrow: "Care catalogue", title: "Services and pricing", description: "Configure clinic offerings, doctor services, fees, and payment policies." },
  availability: { eyebrow: "Scheduling", title: "Doctor availability", description: "Manage recurring hours, breaks, time off, and future slot generation." },
  appointments: { eyebrow: "Daily operations", title: "Appointment queue", description: "Check in patients and move appointments through the clinic workflow." },
  reviews: { eyebrow: "Trust and safety", title: "Review moderation", description: "Inspect patient feedback and manage its public visibility." },
  refunds: { eyebrow: "Financial operations", title: "Refund recovery", description: "Investigate failed refunds and perform audited recovery actions." }
};

export function AdminPanelPage({ section, variant }: { section: Section; variant?: string }) {
  const { apiUrl, accessToken } = useAdminSession();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState("");
  const needsClinic = section === "doctors" || section === "services" || section === "availability" || section === "appointments";
  const heading = variant === "today"
    ? { eyebrow: "Daily operations", title: "Today’s appointment queue", description: "Manage today’s check-ins, queue state, appointment progress, and offline payments." }
    : variant === "cancelled"
      ? { eyebrow: "Appointment exceptions", title: "Cancelled appointments", description: "Review clinic-cancelled appointments and related operational follow-up." }
      : variant === "no-shows"
        ? { eyebrow: "Appointment exceptions", title: "No-show appointments", description: "Review appointments recorded as no-shows for the selected clinic and date." }
        : variant === "pending-reviews"
          ? { eyebrow: "Trust and safety", title: "Pending review moderation", description: "Review patient feedback awaiting a moderation decision." }
          : variant === "hidden-reviews"
            ? { eyebrow: "Trust and safety", title: "Hidden and rejected reviews", description: "Inspect non-public patient feedback and moderation reasons." }
            : titles[section];

  useEffect(() => {
    if (!needsClinic) return;
    void fetch(`${apiUrl}/v1/admin/clinics`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => response.ok ? response.json() as Promise<{ clinics: Clinic[] }> : Promise.reject())
      .then((payload) => {
        setClinics(payload.clinics);
        setSelectedClinicId((current) => current || payload.clinics[0]?.id || "");
      })
      .catch(() => setClinics([]));
  }, [accessToken, apiUrl, needsClinic]);

  return (
    <>
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">{heading.eyebrow}</p>
          <h2>{heading.title}</h2>
          <p>{heading.description}</p>
        </div>
        {needsClinic && (
          <label className="admin-clinic-context">
            Clinic
            <select onChange={(event) => setSelectedClinicId(event.target.value)} value={selectedClinicId}>
              <option value="">Select a clinic</option>
              {clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
            </select>
          </label>
        )}
      </header>
      {section === "doctors" && <DoctorOnboardingPanel apiUrl={apiUrl} accessToken={accessToken} selectedClinicId={selectedClinicId} />}
      {section === "services" && <ServiceConfigurationPanel adminOnly apiUrl={apiUrl} accessToken={accessToken} selectedClinicId={selectedClinicId} />}
      {section === "availability" && <DoctorAvailabilityPanel adminOnly apiUrl={apiUrl} accessToken={accessToken} selectedClinicId={selectedClinicId} />}
      {section === "appointments" && <AppointmentOperationsPanel apiUrl={apiUrl} accessToken={accessToken} initialStatus={variant === "cancelled" ? "cancelled_by_clinic" : variant === "no-shows" ? "no_show" : ""} selectedClinicId={selectedClinicId} />}
      {section === "reviews" && <ReviewModerationPanel apiUrl={apiUrl} accessToken={accessToken} initialStatus={variant === "pending-reviews" ? "pending_moderation" : variant === "hidden-reviews" ? "hidden" : ""} />}
      {section === "refunds" && <RefundRecoveryPanel apiUrl={apiUrl} accessToken={accessToken} />}
    </>
  );
}

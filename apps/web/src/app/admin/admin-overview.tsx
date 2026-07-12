"use client";

import Link from "next/link";
import { Activity, ArrowRight, Building2, CalendarDays, CircleAlert, Stethoscope } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "./admin-shell";
import { EmptyState, LoadingSkeleton, MetricCard, PageHeader, StatusBadge } from "./admin-ui";
import type { Clinic, Doctor } from "./admin-types";

export function AdminOverview() {
  const { apiRequest, user } = useAdminSession();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [summary, setSummary] = useState<{ totalAppointments?: number; completedAppointments?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const from = new Date(); from.setDate(from.getDate() - 30);
    const params = new URLSearchParams({ from: from.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10), groupBy: "day", timezone: "Asia/Colombo" });
    void Promise.all([
      apiRequest<{ clinics: Clinic[] }>("/v1/admin/clinics"),
      apiRequest<{ doctors: Doctor[] }>("/v1/admin/doctors"),
      apiRequest<{ summary: { totalAppointments?: number; completedAppointments?: number } }>(`/v1/admin/reports/overview?${params}`)
    ]).then(([clinicData, doctorData, reportData]) => { setClinics(clinicData.clinics); setDoctors(doctorData.doctors); setSummary(reportData.summary); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load platform overview"))
      .finally(() => setLoading(false));
  }, [apiRequest]);

  const stats = useMemo(() => ({
    activeClinics: clinics.filter((clinic) => clinic.status === "ACTIVE").length,
    pendingClinics: clinics.filter((clinic) => clinic.status === "PENDING_APPROVAL" || clinic.status === "DRAFT").length,
    approvedDoctors: doctors.filter((doctor) => doctor.status === "APPROVED").length,
    pendingDoctors: doctors.filter((doctor) => doctor.status === "PENDING_APPROVAL").length
  }), [clinics, doctors]);

  return <>
    <PageHeader eyebrow="Platform operations" title={`Good day, ${user.fullName.split(" ")[0]}`} description="A concise view of network readiness and the work that needs administrator attention." actions={<Link className="primary-button" href="/admin/clinics/new">Create clinic</Link>} />
    {error && <div className="admin-v2-alert error" role="alert"><CircleAlert size={18} />{error}</div>}
    {loading ? <LoadingSkeleton rows={4} /> : <>
      <section className="admin-v2-metric-grid" aria-label="Platform metrics">
        <MetricCard icon={<Building2 size={18} />} label="Active clinics" value={stats.activeClinics} detail={`${clinics.length} total organizations`} />
        <MetricCard icon={<Stethoscope size={18} />} label="Approved doctors" value={stats.approvedDoctors} detail={`${doctors.length} provider records`} />
        <MetricCard icon={<CalendarDays size={18} />} label="Appointments (30 days)" value={summary?.totalAppointments ?? 0} detail={`${summary?.completedAppointments ?? 0} completed`} />
        <MetricCard icon={<Activity size={18} />} label="Items awaiting review" value={stats.pendingClinics + stats.pendingDoctors} detail="Clinic and doctor approvals" />
      </section>
      <section className="admin-v2-dashboard-grid">
        <div className="admin-v2-card">
          <div className="admin-v2-card-header"><div><h2>Approval queue</h2><p>Records that need a platform decision.</p></div><Link href="/admin/doctors/pending">Review all <ArrowRight size={15} /></Link></div>
          <div className="admin-v2-list">
            {doctors.filter((doctor) => doctor.status === "PENDING_APPROVAL").slice(0, 5).map((doctor) => <Link href={`/admin/doctors/${doctor.id}`} key={doctor.id}><span className="admin-v2-avatar admin-v2-avatar-text">{doctor.user.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{doctor.user.fullName}</strong><small>{doctor.licenseNumber || "License pending"}</small></span><StatusBadge status={doctor.status} /></Link>)}
            {!stats.pendingDoctors && <EmptyState title="Approval queue is clear" description="There are no pending doctor accounts." />}
          </div>
        </div>
        <div className="admin-v2-card">
          <div className="admin-v2-card-header"><div><h2>Clinic network</h2><p>Recently added organizations.</p></div><Link href="/admin/clinics">View directory <ArrowRight size={15} /></Link></div>
          <div className="admin-v2-list">
            {clinics.slice(0, 5).map((clinic) => <Link href={`/admin/clinics/${clinic.id}`} key={clinic.id}><span className="admin-v2-avatar"><Building2 size={17} /></span><span><strong>{clinic.name}</strong><small>{clinic.locations?.length ?? 0} locations · {clinic.slug}</small></span><StatusBadge status={clinic.status} /></Link>)}
            {!clinics.length && <EmptyState title="No clinics yet" description="Create the first clinic organization to begin." />}
          </div>
        </div>
      </section>
    </>}
  </>;
}

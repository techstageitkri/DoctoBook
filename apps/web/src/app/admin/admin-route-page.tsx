"use client";

import Link from "next/link";
import { ArrowRight, Construction, ShieldCheck } from "lucide-react";
import { AdminPanelPage } from "./admin-panel-page";
import { AdminReportsView } from "./admin-reports-view";
import { NotificationAdminPage } from "./notification-admin-page";
import { SlotAdminPage } from "./slot-admin-page";
import { PageHeader } from "./admin-ui";

const routeCopy: Record<string, { title: string; description: string; limitation: string; related?: { href: string; label: string } }> = {
  payments: { title: "Payments", description: "Platform payment operations and transaction lookup.", limitation: "The current API exposes patient payment status and webhook processing but does not provide a Super Admin payment directory endpoint.", related: { href: "/admin/reports/revenue", label: "Open revenue reports" } },
  reconciliation: { title: "Reconciliation", description: "Review financial exceptions and recovery outcomes.", limitation: "The current API records reconciliation actions on individual refunds but does not expose a standalone platform reconciliation feed.", related: { href: "/admin/refunds", label: "Open refund recovery" } },
  "settings": { title: "Platform settings", description: "Global platform defaults and operational controls.", limitation: "No platform-settings read or mutation contract currently exists. Adding one requires a backend security and audit design." },
  "settings/payments": { title: "Payment providers", description: "Provider configuration and payment operating modes.", limitation: "Payment credentials are environment-managed and the current API intentionally exposes no credential mutation endpoint." },
  "settings/providers": { title: "Email, SMS, and push providers", description: "Provider configuration for outbound communications.", limitation: "Provider health is available, but credential mutation remains environment-managed and is not exposed through the API.", related: { href: "/admin/notifications/health", label: "View provider health" } },
  "audit-logs": { title: "Security and audit logs", description: "Review sensitive administrative and operational actions.", limitation: "Audit events are written by the backend, but there is no authorized audit-log retrieval endpoint yet." }
};

export function AdminRoutePage({ route }: { route: string }) {
  if (["services/clinics", "services/doctors", "services/fees"].includes(route)) return <AdminPanelPage section="services" />;
  if (route === "availability/time-off") return <AdminPanelPage section="availability" />;
  if (route === "appointments/today") return <AdminPanelPage section="appointments" variant="today" />;
  if (route === "appointments/cancelled") return <AdminPanelPage section="appointments" variant="cancelled" />;
  if (route === "appointments/no-shows") return <AdminPanelPage section="appointments" variant="no-shows" />;
  if (route === "refunds/recovery") return <AdminPanelPage section="refunds" />;
  if (route === "reconciliation") return <CapabilityGap {...routeCopy.reconciliation!} />;
  if (route === "reviews/pending") return <AdminPanelPage section="reviews" variant="pending-reviews" />;
  if (route === "reviews/hidden") return <AdminPanelPage section="reviews" variant="hidden-reviews" />;
  if (route === "notifications") return <NotificationAdminPage />;
  if (route === "notifications/logs") return <NotificationAdminPage view="logs" />;
  if (route === "notifications/health") return <NotificationAdminPage view="health" />;
  if (route === "slots") return <SlotAdminPage />;
  if (route.startsWith("reports/")) return <AdminReportsView />;
  const copy = routeCopy[route];
  return copy ? <CapabilityGap {...copy} /> : <CapabilityGap title="Administration workspace" description="This focused route is ready for its backend contract." limitation="The current API does not expose the data required to render this workspace safely." />;
}

function CapabilityGap({ title, description, limitation, related }: { title: string; description: string; limitation: string; related?: { href: string; label: string } }) {
  return <><PageHeader eyebrow="Super Admin" title={title} description={description} /><section className="admin-v2-card admin-v2-capability-gap"><span className="admin-v2-brand-mark"><Construction size={23} /></span><h2>Backend capability required</h2><p>{limitation}</p><div className="admin-v2-info-note"><ShieldCheck size={17} />No mock data or unsecured mutation has been added. Existing authentication, authorization, and audit boundaries remain intact.</div>{related && <Link className="primary-button" href={related.href}>{related.label}<ArrowRight size={16} /></Link>}</section></>;
}

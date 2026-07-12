import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardCheck,
  Clock3,
  CreditCard,
  FileCheck2,
  FileText,
  HeartPulse,
  History,
  LayoutDashboard,
  ListChecks,
  MapPin,
  MessageSquareText,
  ReceiptText,
  RotateCcw,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserCog,
  UserPlus,
  UsersRound,
  WalletCards
} from "lucide-react";

export type AdminPermission =
  | "dashboard.read"
  | "clinic.read"
  | "clinic.create"
  | "clinic.update"
  | "doctor.read"
  | "doctor.manage"
  | "service.manage"
  | "schedule.manage"
  | "appointment.read"
  | "payment.read"
  | "refund.manage"
  | "review.moderate"
  | "notification.manage"
  | "report.read"
  | "settings.manage"
  | "audit.read";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: AdminPermission;
};

export type AdminNavGroup = {
  label: string;
  icon: LucideIcon;
  items: AdminNavItem[];
};

export const adminNavigation: AdminNavGroup[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    items: [{ href: "/admin", label: "Overview", icon: LayoutDashboard, permission: "dashboard.read" }]
  },
  {
    label: "Clinics",
    icon: Building2,
    items: [
      { href: "/admin/clinics", label: "View clinics", icon: Building2, permission: "clinic.read" },
      { href: "/admin/clinics/new", label: "Create clinic", icon: UserPlus, permission: "clinic.create" },
      { href: "/admin/clinics/approvals", label: "Clinic approvals", icon: ClipboardCheck, permission: "clinic.update" },
      { href: "/admin/clinics/locations", label: "Locations and branches", icon: MapPin, permission: "clinic.read" },
      { href: "/admin/clinics/hours", label: "Operating hours", icon: Clock3, permission: "clinic.read" },
      { href: "/admin/clinics/closures", label: "Closures", icon: CalendarDays, permission: "clinic.read" },
      { href: "/admin/clinics/administrators", label: "Clinic administrators", icon: UserCog, permission: "clinic.update" }
    ]
  },
  {
    label: "Doctors",
    icon: Stethoscope,
    items: [
      { href: "/admin/doctors", label: "View doctors", icon: UsersRound, permission: "doctor.read" },
      { href: "/admin/doctors/pending", label: "Pending approvals", icon: ClipboardCheck, permission: "doctor.manage" },
      { href: "/admin/doctors/new", label: "Register doctor", icon: UserPlus, permission: "doctor.manage" },
      { href: "/admin/doctors/directory", label: "Doctor details", icon: FileText, permission: "doctor.read" },
      { href: "/admin/doctors/assignments", label: "Clinic assignments", icon: Building2, permission: "doctor.manage" },
      { href: "/admin/doctors/documents", label: "Documents and verification", icon: FileCheck2, permission: "doctor.manage" }
    ]
  },
  {
    label: "Services",
    icon: HeartPulse,
    items: [
      { href: "/admin/services", label: "Master services", icon: ListChecks, permission: "service.manage" },
      { href: "/admin/services/clinics", label: "Clinic services", icon: Building2, permission: "service.manage" },
      { href: "/admin/services/doctors", label: "Doctor services", icon: Stethoscope, permission: "service.manage" },
      { href: "/admin/services/fees", label: "Fees and payment policies", icon: ReceiptText, permission: "service.manage" }
    ]
  },
  {
    label: "Scheduling",
    icon: CalendarClock,
    items: [
      { href: "/admin/availability", label: "Doctor availability", icon: CalendarClock, permission: "schedule.manage" },
      { href: "/admin/availability/time-off", label: "Breaks and time off", icon: Clock3, permission: "schedule.manage" },
      { href: "/admin/slots", label: "Generated slots", icon: CalendarDays, permission: "schedule.manage" }
    ]
  },
  {
    label: "Appointments",
    icon: CalendarDays,
    items: [
      { href: "/admin/appointments", label: "All appointments", icon: CalendarDays, permission: "appointment.read" },
      { href: "/admin/appointments/today", label: "Today’s queue", icon: ListChecks, permission: "appointment.read" },
      { href: "/admin/appointments/cancelled", label: "Cancelled appointments", icon: RotateCcw, permission: "appointment.read" },
      { href: "/admin/appointments/no-shows", label: "No-shows", icon: History, permission: "appointment.read" }
    ]
  },
  {
    label: "Finance",
    icon: WalletCards,
    items: [
      { href: "/admin/payments", label: "Payments", icon: CreditCard, permission: "payment.read" },
      { href: "/admin/refunds", label: "Refunds", icon: RotateCcw, permission: "refund.manage" },
      { href: "/admin/refunds/recovery", label: "Refund recovery", icon: Activity, permission: "refund.manage" },
      { href: "/admin/reconciliation", label: "Reconciliation", icon: ReceiptText, permission: "refund.manage" }
    ]
  },
  {
    label: "Reviews",
    icon: MessageSquareText,
    items: [
      { href: "/admin/reviews", label: "All reviews", icon: MessageSquareText, permission: "review.moderate" },
      { href: "/admin/reviews/pending", label: "Pending moderation", icon: ClipboardCheck, permission: "review.moderate" },
      { href: "/admin/reviews/hidden", label: "Hidden and rejected reviews", icon: History, permission: "review.moderate" }
    ]
  },
  {
    label: "Notifications",
    icon: Bell,
    items: [
      { href: "/admin/notifications", label: "Templates", icon: FileText, permission: "notification.manage" },
      { href: "/admin/notifications/logs", label: "Delivery logs", icon: History, permission: "notification.manage" },
      { href: "/admin/notifications/health", label: "Provider health", icon: Activity, permission: "notification.manage" }
    ]
  },
  {
    label: "Reports",
    icon: ChartNoAxesCombined,
    items: [
      { href: "/admin/reports", label: "Platform overview", icon: ChartNoAxesCombined, permission: "report.read" },
      { href: "/admin/reports/clinics", label: "Clinics", icon: Building2, permission: "report.read" },
      { href: "/admin/reports/doctors", label: "Doctors", icon: Stethoscope, permission: "report.read" },
      { href: "/admin/reports/appointments", label: "Appointments", icon: CalendarDays, permission: "report.read" },
      { href: "/admin/reports/revenue", label: "Revenue", icon: WalletCards, permission: "report.read" },
      { href: "/admin/reports/notifications", label: "Notifications", icon: Bell, permission: "report.read" }
    ]
  },
  {
    label: "Settings",
    icon: Settings,
    items: [
      { href: "/admin/settings", label: "Platform settings", icon: Settings, permission: "settings.manage" },
      { href: "/admin/settings/payments", label: "Payment providers", icon: CreditCard, permission: "settings.manage" },
      { href: "/admin/settings/providers", label: "Email, SMS, and push providers", icon: Bell, permission: "settings.manage" },
      { href: "/admin/audit-logs", label: "Security and audit logs", icon: ShieldCheck, permission: "audit.read" }
    ]
  }
];

const clinicAdminPermissions = new Set<AdminPermission>([
  "dashboard.read",
  "clinic.read",
  "clinic.update",
  "doctor.read",
  "doctor.manage",
  "service.manage",
  "schedule.manage",
  "appointment.read",
  "payment.read",
  "refund.manage",
  "review.moderate",
  "report.read"
]);

export function hasAdminPermission(roles: string[], permission: AdminPermission) {
  if (roles.includes("super_admin")) return true;
  return roles.includes("clinic_admin") && clinicAdminPermissions.has(permission);
}

export function hasAdminAccess(roles: string[]) {
  return roles.includes("super_admin") || roles.includes("clinic_admin");
}

export function activeNavigationGroup(pathname: string) {
  return adminNavigation.find((group) =>
    group.items.some((item) => item.href === pathname || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`)))
  )?.label;
}

export function breadcrumbLabels(pathname: string) {
  const parts = pathname.split("/").filter(Boolean).slice(1);
  return parts.map((part) =>
    /^[0-9a-f-]{20,}$/i.test(part)
      ? "Details"
      : part
          .split("-")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ")
  );
}

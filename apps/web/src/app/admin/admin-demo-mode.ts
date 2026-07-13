export function isAdminDemoMode() {
  return process.env.NEXT_PUBLIC_ADMIN_DEMO_MODE === "true";
}

export function isAdminDemoPath(pathname: string) {
  if (!isAdminDemoMode()) {
    return true;
  }

  if (pathname === "/admin") {
    return true;
  }

  const visibleClinicPages = new Set([
    "/admin/clinics",
    "/admin/clinics/new",
    "/admin/clinics/approvals",
    "/admin/clinics/locations",
    "/admin/clinics/hours",
    "/admin/clinics/closures",
    "/admin/clinics/administrators"
  ]);

  if (visibleClinicPages.has(pathname)) {
    return true;
  }

  const visibleDoctorPages = new Set([
    "/admin/doctors",
    "/admin/doctors/new",
    "/admin/doctors/pending",
    "/admin/doctors/directory",
    "/admin/doctors/assignments",
    "/admin/doctors/documents"
  ]);

  if (visibleDoctorPages.has(pathname)) {
    return true;
  }

  if (pathname === "/admin/services" || pathname.startsWith("/admin/services/")) {
    return true;
  }

  return /^\/admin\/clinics\/[0-9a-f-]{20,}(\/(locations|hours|closures|administrators|services|doctors))?$/i.test(pathname) ||
    /^\/admin\/doctors\/[0-9a-f-]{20,}(\/(clinic-assignments|documents))?$/i.test(pathname);
}

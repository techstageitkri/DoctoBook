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

  if (pathname === "/admin/clinics" || pathname === "/admin/clinics/new") {
    return true;
  }

  if (pathname === "/admin/doctors" || pathname === "/admin/doctors/new" || pathname === "/admin/doctors/pending") {
    return true;
  }

  if (pathname === "/admin/services" || pathname.startsWith("/admin/services/")) {
    return true;
  }

  return /^\/admin\/clinics\/[0-9a-f-]{20,}(\/(locations|services|doctors))?$/i.test(pathname) ||
    /^\/admin\/doctors\/[0-9a-f-]{20,}(\/(clinic-assignments|documents))?$/i.test(pathname);
}

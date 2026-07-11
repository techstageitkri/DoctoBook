"use client";

import { APP_NAME } from "@doctobook/shared";
import { ReportDashboard } from "../report-dashboard";
import { useAdminSession } from "./admin-shell";

export function AdminReportsView({ clinicId }: { clinicId?: string }) {
  const { apiUrl, accessToken } = useAdminSession();
  return (
    <ReportDashboard
      accessTokenOverride={accessToken}
      apiUrl={apiUrl}
      appName={APP_NAME}
      clinicId={clinicId}
      embedded
      mode={clinicId ? "clinic" : "admin"}
    />
  );
}

import { APP_NAME } from "@doctobook/shared";
import { ReportDashboard } from "../../report-dashboard";

export default function AdminReportsPage() {
  return (
    <ReportDashboard
      apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}
      appName={APP_NAME}
      mode="admin"
    />
  );
}

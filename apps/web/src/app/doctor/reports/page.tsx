import { APP_NAME } from "@doctobook/shared";
import { ReportDashboard } from "../../report-dashboard";

export default function DoctorReportsPage() {
  return (
    <ReportDashboard
      apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}
      appName={APP_NAME}
      mode="doctor"
    />
  );
}

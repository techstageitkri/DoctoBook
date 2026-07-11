import { APP_NAME } from "@doctobook/shared";
import { ReportDashboard } from "../../report-dashboard";
import { getPublicApiUrl } from "../../public-api-url";

export default function DoctorReportsPage() {
  return (
    <ReportDashboard
      apiUrl={getPublicApiUrl()}
      appName={APP_NAME}
      mode="doctor"
    />
  );
}

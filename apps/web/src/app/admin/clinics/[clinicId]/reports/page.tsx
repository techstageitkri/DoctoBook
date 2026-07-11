import { APP_NAME } from "@doctobook/shared";
import { ReportDashboard } from "../../../../report-dashboard";

export default async function ClinicReportsPage({
  params
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;

  return (
    <ReportDashboard
      apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}
      appName={APP_NAME}
      clinicId={clinicId}
      mode="clinic"
    />
  );
}

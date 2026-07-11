import { AdminReportsView } from "../../../admin-reports-view";

export default async function ClinicReportsPage({
  params
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;

  return <AdminReportsView clinicId={clinicId} />;
}

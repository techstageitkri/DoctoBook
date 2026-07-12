import { ClinicDetailPage } from "./clinic-detail-page";
export default async function ClinicPage({ params }: { params: Promise<{ clinicId: string }> }) { const { clinicId } = await params; return <ClinicDetailPage clinicId={clinicId} />; }

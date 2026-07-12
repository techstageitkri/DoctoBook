import { ClinicDetailPage } from "../clinic-detail-page";
export default async function Page({ params }: { params: Promise<{ clinicId: string }> }) { const { clinicId } = await params; return <ClinicDetailPage clinicId={clinicId} tab="administrators" />; }

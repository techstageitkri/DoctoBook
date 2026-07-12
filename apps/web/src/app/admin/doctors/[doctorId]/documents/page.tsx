import { DoctorDetailPage } from "../doctor-detail-page";
export default async function Page({ params }: { params: Promise<{ doctorId: string }> }) { const { doctorId } = await params; return <DoctorDetailPage doctorId={doctorId} tab="documents" />; }

import { APP_NAME } from "@doctobook/shared";
import { PatientBookingPortal } from "../../patient-booking-portal";

export default async function DoctorDetailPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <PatientBookingPortal
      apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}
      appName={APP_NAME}
      initialDoctorSlug={slug}
      initialView="booking"
    />
  );
}

import { APP_NAME } from "@doctobook/shared";
import { PatientBookingPortal } from "../../patient-booking-portal";
import { getPublicApiUrl } from "../../public-api-url";

export default async function DoctorDetailPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <PatientBookingPortal
      apiUrl={getPublicApiUrl()}
      appName={APP_NAME}
      initialDoctorSlug={slug}
      initialView="booking"
    />
  );
}

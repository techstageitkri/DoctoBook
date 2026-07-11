import { APP_NAME } from "@doctobook/shared";
import { PatientBookingPortal } from "../../patient-booking-portal";
import { getPublicApiUrl } from "../../public-api-url";

export default async function BookingPage({
  params
}: {
  params: Promise<{ doctorClinicServiceId: string }>;
}) {
  const { doctorClinicServiceId } = await params;

  return (
    <PatientBookingPortal
      apiUrl={getPublicApiUrl()}
      appName={APP_NAME}
      initialDoctorClinicServiceId={doctorClinicServiceId}
      initialView="booking"
    />
  );
}

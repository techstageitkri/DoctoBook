import { APP_NAME } from "@doctobook/shared";
import { PatientBookingPortal } from "../../../patient-booking-portal";
import { getPublicApiUrl } from "../../../public-api-url";

export default async function PatientAppointmentPage({
  params
}: {
  params: Promise<{ appointmentId: string }>;
}) {
  const { appointmentId } = await params;

  return (
    <PatientBookingPortal
      apiUrl={getPublicApiUrl()}
      appName={APP_NAME}
      initialAppointmentId={appointmentId}
      initialView="payment"
    />
  );
}

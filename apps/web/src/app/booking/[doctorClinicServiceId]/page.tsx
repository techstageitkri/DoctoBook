import { APP_NAME } from "@doctobook/shared";
import { PatientBookingPortal } from "../../patient-booking-portal";

export default async function BookingPage({
  params
}: {
  params: Promise<{ doctorClinicServiceId: string }>;
}) {
  const { doctorClinicServiceId } = await params;

  return (
    <PatientBookingPortal
      apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}
      appName={APP_NAME}
      initialDoctorClinicServiceId={doctorClinicServiceId}
      initialView="booking"
    />
  );
}

import { APP_NAME } from "@doctobook/shared";
import { PatientBookingPortal } from "../../patient-booking-portal";

export default function PatientAppointmentsPage() {
  return (
    <PatientBookingPortal
      apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}
      appName={APP_NAME}
      initialView="appointments"
    />
  );
}

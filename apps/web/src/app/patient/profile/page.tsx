import { APP_NAME } from "@doctobook/shared";
import { PatientBookingPortal } from "../../patient-booking-portal";
import { getPublicApiUrl } from "../../public-api-url";

export default function PatientProfilePage() {
  return <PatientBookingPortal apiUrl={getPublicApiUrl()} appName={APP_NAME} initialView="profile" />;
}

import { APP_NAME } from "@doctobook/shared";
import { PatientBookingPortal } from "../../patient-booking-portal";
import { getPublicApiUrl } from "../../public-api-url";

export default async function PaymentPage({
  params
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;

  return (
    <PatientBookingPortal
      apiUrl={getPublicApiUrl()}
      appName={APP_NAME}
      initialPaymentId={paymentId}
      initialView="payment"
    />
  );
}

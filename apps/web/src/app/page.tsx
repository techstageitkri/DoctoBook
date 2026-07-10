import { APP_NAME } from "@doctobook/shared";
import { ClinicAdminPortal } from "./clinic-admin-portal";

export default function HomePage() {
  return (
    <ClinicAdminPortal
      apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}
      appName={APP_NAME}
    />
  );
}

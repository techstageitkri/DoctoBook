import { ClinicAdminPortal } from "../clinic-admin-portal";
import { getPublicApiUrl } from "../public-api-url";

export default function AdminPage() {
  return (
    <ClinicAdminPortal
      apiUrl={getPublicApiUrl()}
    />
  );
}

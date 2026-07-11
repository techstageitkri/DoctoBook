import { ClinicAdminPortal } from "../clinic-admin-portal";

export default function AdminPage() {
  return (
    <ClinicAdminPortal
      apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}
    />
  );
}

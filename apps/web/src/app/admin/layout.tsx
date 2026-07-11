import { APP_NAME } from "@doctobook/shared";
import { getPublicApiUrl } from "../public-api-url";
import { AdminShell } from "./admin-shell";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminShell
      apiUrl={getPublicApiUrl()}
      appName={APP_NAME}
    >
      {children}
    </AdminShell>
  );
}

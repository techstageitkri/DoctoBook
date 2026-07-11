import { APP_NAME } from "@doctobook/shared";
import { AdminShell } from "./admin-shell";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminShell
      apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}
      appName={APP_NAME}
    >
      {children}
    </AdminShell>
  );
}

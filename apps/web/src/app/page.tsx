import { APP_NAME } from "@doctobook/shared";

export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", padding: "48px" }}>
      <h1>{APP_NAME}</h1>
      <p>Implementation foundation is ready.</p>
    </main>
  );
}

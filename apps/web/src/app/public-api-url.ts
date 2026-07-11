export function getPublicApiUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }

  return process.env.NODE_ENV === "production" ? "" : "http://localhost:4000";
}

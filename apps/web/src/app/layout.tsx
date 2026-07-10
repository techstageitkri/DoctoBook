import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DoctoBook",
  description: "Doctor appointment booking marketplace"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

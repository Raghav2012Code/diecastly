import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diecastly",
  description: "D2C business management for a diecast collectibles seller",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background antialiased">{children}</body>
    </html>
  );
}

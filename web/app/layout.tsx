import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Barrel Site Audit",
  description: "Code, performance, and site health reports for client Shopify storefronts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#f9f8f6] antialiased">{children}</body>
    </html>
  );
}

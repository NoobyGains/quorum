import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Built with Quorum",
  description: "A Next.js app scaffolded by create-quorum-app.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

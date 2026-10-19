import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Newtonite | Operations Workspace",
  description: "Clear ownership. Connected teams. A reliable home for operational work.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

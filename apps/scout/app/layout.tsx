import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contrib Signals",
  description: "Find open-source work worth doing.",
  openGraph: {
    title: "Contrib Signals — Find OSS work worth doing",
    description:
      "Live GitHub evidence, duplicate-work checks, maintainer signals, and cited investigation briefs.",
    images: [{ url: "/og.png", width: 1743, height: 909, alt: "Contrib Signals evidence map" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Contrib Signals — Find OSS work worth doing",
    description: "An evidence-first open-source contribution scout.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

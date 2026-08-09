import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forkyssey — Discover your next upstream quest",
  description: "Evidence-first discovery for open-source work worth doing.",
  openGraph: {
    title: "Forkyssey — Discover your next upstream quest",
    description:
      "Live GitHub evidence, duplicate-work checks, maintainer signals, and cited investigation briefs.",
    images: [{ url: "/og.png", width: 1743, height: 909, alt: "Forkyssey evidence map" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Forkyssey — Discover your next upstream quest",
    description: "Evidence-first discovery for open-source work worth doing.",
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

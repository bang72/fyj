import type { Metadata } from "next";

import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "MIVO V2 — Meet the vibe", template: "%s · MIVO" },
  description: "MIVO V2 is a privacy-first anonymous 1-on-1 connection platform. Talk first. Reveal by choice. Connect by consent.",
  applicationName: "MIVO",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MIVO" },
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
  other: { "codex-preview": "production" },
  icons: { icon: "/icon-192.jpg", apple: "/icon-512.jpg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id" suppressHydrationWarning><body><Providers>{children}</Providers></body></html>;
}

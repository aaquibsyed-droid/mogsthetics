import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope, Unbounded } from "next/font/google";
import { Providers } from "@/components/app/providers";
import { BRAND } from "@/lib/brand";
import "./globals.css";

// Unbounded: wide, athletic display face for headings and numbers. Manrope: clean body text.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600", "700"], display: "swap" });
const unbounded = Unbounded({ subsets: ["latin"], variable: "--font-heading", weight: ["300", "400", "500", "600", "700"], display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.shortName}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  appleWebApp: { capable: true, title: BRAND.shortName, statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f5f9fa",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${unbounded.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

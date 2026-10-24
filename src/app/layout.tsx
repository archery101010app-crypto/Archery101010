import type { Metadata, Viewport } from "next";
import "./globals.css";
import IPhoneFrame from "@/components/ui/IPhoneFrame";

export const metadata: Metadata = {
  title: "Archery 10 10 10 - App para Arqueros y Coaches",
  description: "App para arqueros y coach: diana, duelos, cronógrafo, planificación ¡y más!",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    apple: "/images/logo_final.png",
  },
  openGraph: {
    title: "Archery 10 10 10 - App para Arqueros y Coaches",
    description: "App para arqueros y coach: diana, duelos, cronógrafo, planificación ¡y más!",
    url: "https://archery101010.com",
    siteName: "Archery 101010",
    images: [
      {
        url: "https://archery101010.com/images/logo_final.png",
        width: 800,
        height: 200,
        alt: "Archery 101010 Logo",
      }
    ],
    locale: "es_ES",
    type: "website",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Archery 101010"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

import ServiceWorkerRegister from "@/components/sw/ServiceWorkerRegister";
import { LanguageProvider } from "@/lib/contexts/LanguageContext";
import ErrorBoundary from "@/components/ui/ErrorBoundary";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased dark overflow-x-hidden w-full max-w-full" style={{ colorScheme: "dark" }}>
      <body className="h-full bg-black-oled text-white flex flex-col font-sans select-none overflow-x-hidden w-full max-w-full">
        <ServiceWorkerRegister />
        <LanguageProvider>
          <ErrorBoundary>
            <IPhoneFrame>{children}</IPhoneFrame>
          </ErrorBoundary>
        </LanguageProvider>
      </body>
    </html>
  );
}

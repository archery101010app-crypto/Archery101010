import type { Metadata, Viewport } from "next";
import "./globals.css";
import IPhoneFrame from "@/components/ui/IPhoneFrame";

export const metadata: Metadata = {
  title: "Archery 101010 - SaaS Premium de Tiro con Arco",
  description: "Plataforma de entrenamiento de tiro con arco moderna, inteligente y offline-first.",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    apple: "/images/logo_final.png",
  },
  openGraph: {
    title: "Archery 101010 - SaaS Premium de Tiro con Arco",
    description: "Plataforma de entrenamiento de tiro con arco moderna, inteligente y offline-first.",
    url: "https://archery101010-prd.web.app",
    siteName: "Archery 101010",
    images: [
      {
        url: "https://archery101010-prd.web.app/images/logo_final.png",
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
  maximumScale: 5,
  userScalable: true,
};

import ServiceWorkerRegister from "@/components/sw/ServiceWorkerRegister";
import { LanguageProvider } from "@/lib/contexts/LanguageContext";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased dark" style={{ colorScheme: "dark" }}>
      <body className="h-full bg-black-oled text-white flex flex-col font-sans select-none">
        <ServiceWorkerRegister />
        <LanguageProvider>
          <IPhoneFrame>{children}</IPhoneFrame>
        </LanguageProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import IPhoneFrame from "@/components/ui/IPhoneFrame";

export const metadata: Metadata = {
  title: "Archery 101010 - SaaS Premium de Tiro con Arco",
  description: "Plataforma de entrenamiento de tiro con arco moderna, inteligente y offline-first.",
  manifest: "/manifest.json",
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

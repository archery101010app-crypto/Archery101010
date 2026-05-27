import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import IPhoneFrame from "@/components/ui/IPhoneFrame";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "Archery 101010 - SaaS Premium de Tiro con Arco",
  description: "Plataforma de entrenamiento de tiro con arco moderna, inteligente y offline-first.",
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
    <html lang="es" className={`${outfit.variable} h-full antialiased dark`}>
      <body className="h-full bg-black-oled text-white flex flex-col font-sans select-none">
        <ServiceWorkerRegister />
        <LanguageProvider>
          <IPhoneFrame>{children}</IPhoneFrame>
        </LanguageProvider>
      </body>
    </html>
  );
}

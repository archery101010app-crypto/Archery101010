import type { Metadata, Viewport } from "next";
import "./globals.css";
import IPhoneFrame from "@/components/ui/IPhoneFrame";

export const metadata: Metadata = {
  metadataBase: new URL("https://archery101010-c0bb4.web.app"),
  title: "Archery 101010 · The App",
  description: "Plataforma de rendimiento para tiro con arco olímpico y compuesto: diana interactiva, eliminatorias en vivo y portal de entrenadores.",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    apple: "/images/logo_final.png",
  },
  openGraph: {
    title: "Archery 101010 · The App",
    description: "Plataforma de rendimiento para tiro con arco olímpico y compuesto: diana interactiva, eliminatorias en vivo y portal de entrenadores.",
    url: "https://archery101010-c0bb4.web.app",
    siteName: "Archery 101010",
    images: [
      {
        url: "https://archery101010-c0bb4.web.app/images/logo_final.png",
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
  },
  other: {
    google: "notranslate"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

import ServiceWorkerRegister from "@/components/sw/ServiceWorkerRegister";
import { LanguageProvider } from "@/lib/contexts/LanguageContext";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { DOM_MUTATION_GUARD_INLINE_SCRIPT } from "@/lib/domMutationGuard";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      translate="no"
      suppressHydrationWarning
      className="notranslate h-full antialiased dark overflow-x-hidden w-full max-w-full"
      style={{ colorScheme: "dark" }}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: DOM_MUTATION_GUARD_INLINE_SCRIPT }} />
      </head>
      <body
        translate="no"
        suppressHydrationWarning
        className="notranslate h-full bg-black-oled text-white flex flex-col font-sans select-none overflow-x-hidden w-full max-w-full"
      >
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

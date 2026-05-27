"use client";

import React from "react";
import { usePathname } from "next/navigation";

export default function IPhoneFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // If the route starts with /admin, we bypass the iPhone simulator and render full desktop screen
  const isAdminRoute = pathname?.startsWith("/admin");

  if (isAdminRoute) {
    return <div className="min-h-screen bg-black-oled text-white">{children}</div>;
  }

  return (
    <div className="iphone-frame-wrapper min-h-screen w-full flex items-center justify-center p-4 bg-transparent">
      {/* Ambient background underneath */}
      <div className="ambient-bg" />

      {/* Simulator Device Frame */}
      <div className="iphone-frame">
        {/* Notch */}
        <div className="iphone-notch" />

        {/* Content Area */}
        <div className="flex-1 w-full overflow-y-auto overflow-x-hidden relative pt-6 pb-8 flex flex-col bg-black-oled">
          {children}
        </div>

        {/* Home Indicator */}
        <div className="iphone-home-indicator" />
      </div>
    </div>
  );
}

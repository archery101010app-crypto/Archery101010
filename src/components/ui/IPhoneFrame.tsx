"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

export default function IPhoneFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [showSimulator, setShowSimulator] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setShowSimulator(params.get("simulator") === "true");
    }
  }, []);

  const isAdminRoute = pathname?.startsWith("/admin");

  if (isAdminRoute || !showSimulator) {
    return (
      <div className="min-h-screen w-full flex flex-col bg-black-oled relative">
        {/* Ambient background */}
        <div className="ambient-bg" />

        {/* Responsive Content Area */}
        <div className="flex-1 w-full max-w-5xl mx-auto flex flex-col relative px-4 sm:px-6 md:px-8">
          {children}
        </div>
      </div>
    );
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
        <div className="iphone-content-area flex-1 w-full overflow-y-auto overflow-x-hidden relative pt-6 pb-8 flex flex-col bg-black-oled">
          {children}
        </div>

        {/* Home Indicator */}
        <div className="iphone-home-indicator" />
      </div>
    </div>
  );
}

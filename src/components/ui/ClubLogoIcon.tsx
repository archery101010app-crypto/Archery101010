import React from "react";

interface ClubLogoIconProps {
  logo?: string; // "0" - "4" or URL
  className?: string;
}

export default function ClubLogoIcon({ logo = "0", className = "w-10 h-10" }: ClubLogoIconProps) {
  const isUrl = logo.startsWith("http://") || logo.startsWith("https://") || logo.startsWith("/");

  if (isUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt="Club Logo"
        className={`${className} object-cover rounded-xl`}
        onError={(e) => {
          // Fallback if image fails to load
          e.currentTarget.style.display = "none";
          e.currentTarget.parentElement?.querySelector(".fallback-svg")?.classList.remove("hidden");
        }}
      />
    );
  }

  // Library of 5 vector icons
  switch (logo) {
    case "0": // Diana Dorada
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${className} text-yellow-gold`}>
          <circle cx="12" cy="12" r="10" stroke="#FFE300" strokeWidth="2" fill="rgba(255,227,0,0.1)" />
          <circle cx="12" cy="12" r="6" stroke="#FFE300" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="2" fill="#FFE300" />
        </svg>
      );
    case "1": // Arco Neón
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${className} text-cyan-neon`}>
          <path d="M6 3c5 3 5 15 0 18" stroke="#00FFF0" strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M6 3v18" stroke="#00FFF0" strokeOpacity="0.3" strokeWidth="1" />
          <path d="M6 12h5" stroke="#FFE300" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "2": // Aljaba Olímpica
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${className} text-[#D100F3]`}>
          <path d="M8 4l2-1 4 16-2 1z" stroke="#D100F3" strokeWidth="2" fill="rgba(209,0,243,0.1)" />
          <path d="M12 3l3-1M13 5l3-1" stroke="#D100F3" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "3": // Escudo Club
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${className} text-cyan-neon`}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#00FFF0" strokeWidth="2" fill="rgba(0,255,240,0.1)" />
          <path d="M12 6v10M9 9h6" stroke="#00FFF0" strokeOpacity="0.6" strokeWidth="1.5" />
        </svg>
      );
    case "4": // Laureles
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${className} text-yellow-gold`}>
          <path d="M6 18c0-3.5 2-6 5-6M18 18c0-3.5-2-6-5-6M12 6v6" stroke="#FFE300" strokeWidth="2" strokeLinecap="round" fill="none" />
          <circle cx="6" cy="12" r="1.5" fill="#FFE300" />
          <circle cx="8" cy="8" r="1.5" fill="#FFE300" />
          <circle cx="18" cy="12" r="1.5" fill="#FFE300" />
          <circle cx="16" cy="8" r="1.5" fill="#FFE300" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${className} text-gray-dim fallback-svg`}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" />
          <path d="M8 12h8M12 8v8" stroke="currentColor" />
        </svg>
      );
  }
}

export interface CountryItem {
  code: string;
  olympic: string;
  emoji: string;
  name: string;
  flag: string;
  dialCode: string;
  defaultUnits?: "metric" | "imperial";
}

export const COUNTRIES: CountryItem[] = [
  // Latin America & Caribbean
  { code: "CR", olympic: "CRC", emoji: "🇨🇷", name: "Costa Rica", flag: "🇨🇷 CRC", dialCode: "+506" },
  { code: "MX", olympic: "MEX", emoji: "🇲🇽", name: "México", flag: "🇲🇽 MEX", dialCode: "+52" },
  { code: "CO", olympic: "COL", emoji: "🇨🇴", name: "Colombia", flag: "🇨🇴 COL", dialCode: "+57" },
  { code: "AR", olympic: "ARG", emoji: "🇦🇷", name: "Argentina", flag: "🇦🇷 ARG", dialCode: "+54" },
  { code: "BR", olympic: "BRA", emoji: "🇧🇷", name: "Brasil", flag: "🇧🇷 BRA", dialCode: "+55" },
  { code: "CL", olympic: "CHI", emoji: "🇨🇱", name: "Chile", flag: "🇨🇱 CHI", dialCode: "+56" },
  { code: "PE", olympic: "PER", emoji: "🇵🇪", name: "Perú", flag: "🇵🇪 PER", dialCode: "+51" },
  { code: "GT", olympic: "GUA", emoji: "🇬🇹", name: "Guatemala", flag: "🇬🇹 GUA", dialCode: "+502" },
  { code: "PA", olympic: "PAN", emoji: "🇵🇦", name: "Panamá", flag: "🇵🇦 PAN", dialCode: "+507" },
  { code: "SV", olympic: "ESA", emoji: "🇸🇻", name: "El Salvador", flag: "🇸🇻 ESA", dialCode: "+503" },
  { code: "HN", olympic: "HON", emoji: "🇭🇳", name: "Honduras", flag: "🇭🇳 HON", dialCode: "+504" },
  { code: "NI", olympic: "NCA", emoji: "🇳🇮", name: "Nicaragua", flag: "🇳🇮 NCA", dialCode: "+505" },
  { code: "EC", olympic: "ECU", emoji: "🇪🇨", name: "Ecuador", flag: "🇪🇨 ECU", dialCode: "+593" },
  { code: "VE", olympic: "VEN", emoji: "🇻🇪", name: "Venezuela", flag: "🇻🇪 VEN", dialCode: "+58" },
  { code: "UY", olympic: "URU", emoji: "🇺🇾", name: "Uruguay", flag: "🇺🇾 URU", dialCode: "+598" },
  { code: "PY", olympic: "PAR", emoji: "🇵🇾", name: "Paraguay", flag: "🇵🇾 PAR", dialCode: "+595" },
  { code: "BO", olympic: "BOL", emoji: "🇧🇴", name: "Bolivia", flag: "🇧🇴 BOL", dialCode: "+591" },
  { code: "PR", olympic: "PUR", emoji: "🇵🇷", name: "Puerto Rico", flag: "🇵🇷 PUR", dialCode: "+1" },
  { code: "DO", olympic: "DOM", emoji: "🇩🇴", name: "República Dominicana", flag: "🇩🇴 DOM", dialCode: "+1" },
  { code: "CU", olympic: "CUB", emoji: "🇨🇺", name: "Cuba", flag: "🇨🇺 CUB", dialCode: "+53" },
  { code: "JM", olympic: "JAM", emoji: "🇯🇲", name: "Jamaica", flag: "🇯🇲 JAM", dialCode: "+1" },
  { code: "TT", olympic: "TTO", emoji: "🇹🇹", name: "Trinidad y Tobago", flag: "🇹🇹 TTO", dialCode: "+1" },

  // North America
  { code: "US", olympic: "USA", emoji: "🇺🇸", name: "Estados Unidos", flag: "🇺🇸 USA", dialCode: "+1", defaultUnits: "imperial" },
  { code: "CA", olympic: "CAN", emoji: "🇨🇦", name: "Canadá", flag: "🇨🇦 CAN", dialCode: "+1" },

  // Europe (World Archery Europe)
  { code: "ES", olympic: "ESP", emoji: "🇪🇸", name: "España", flag: "🇪🇸 ESP", dialCode: "+34" },
  { code: "FR", olympic: "FRA", emoji: "🇫🇷", name: "Francia", flag: "🇫🇷 FRA", dialCode: "+33" },
  { code: "IT", olympic: "ITA", emoji: "🇮🇹", name: "Italia", flag: "🇮🇹 ITA", dialCode: "+39" },
  { code: "DE", olympic: "GER", emoji: "🇩🇪", name: "Alemania", flag: "🇩🇪 GER", dialCode: "+49" },
  { code: "GB", olympic: "GBR", emoji: "🇬🇧", name: "Reino Unido", flag: "🇬🇧 GBR", dialCode: "+44" },
  { code: "NL", olympic: "NED", emoji: "🇳🇱", name: "Países Bajos", flag: "🇳🇱 NED", dialCode: "+31" },
  { code: "TR", olympic: "TUR", emoji: "🇹🇷", name: "Turquía", flag: "🇹🇷 TUR", dialCode: "+90" },
  { code: "PT", olympic: "POR", emoji: "🇵🇹", name: "Portugal", flag: "🇵🇹 POR", dialCode: "+351" },
  { code: "BE", olympic: "BEL", emoji: "🇧🇪", name: "Bélgica", flag: "🇧🇪 BEL", dialCode: "+32" },
  { code: "CH", olympic: "SUI", emoji: "🇨🇭", name: "Suiza", flag: "🇨🇭 SUI", dialCode: "+41" },
  { code: "AT", olympic: "AUT", emoji: "🇦🇹", name: "Austria", flag: "🇦🇹 AUT", dialCode: "+43" },
  { code: "PL", olympic: "POL", emoji: "🇵🇱", name: "Polonia", flag: "🇵🇱 POL", dialCode: "+48" },
  { code: "CZ", olympic: "CZE", emoji: "🇨🇿", name: "República Checa", flag: "🇨🇿 CZE", dialCode: "+420" },
  { code: "UA", olympic: "UKR", emoji: "🇺🇦", name: "Ucrania", flag: "🇺🇦 UKR", dialCode: "+380" },
  { code: "DK", olympic: "DEN", emoji: "🇩🇰", name: "Dinamarca", flag: "🇩🇰 DEN", dialCode: "+45" },
  { code: "SE", olympic: "SWE", emoji: "🇸🇪", name: "Suecia", flag: "🇸🇪 SWE", dialCode: "+46" },
  { code: "NO", olympic: "NOR", emoji: "🇳🇴", name: "Noruega", flag: "🇳🇴 NOR", dialCode: "+47" },
  { code: "FI", olympic: "FIN", emoji: "🇫🇮", name: "Finlandia", flag: "🇫🇮 FIN", dialCode: "+358" },
  { code: "IE", olympic: "IRL", emoji: "🇮🇪", name: "Irlanda", flag: "🇮🇪 IRL", dialCode: "+353" },
  { code: "GR", olympic: "GRE", emoji: "🇬🇷", name: "Grecia", flag: "🇬🇷 GRE", dialCode: "+30" },
  { code: "SI", olympic: "SLO", emoji: "🇸🇮", name: "Eslovenia", flag: "🇸🇮 SLO", dialCode: "+386" },
  { code: "SK", olympic: "SVK", emoji: "🇸🇰", name: "Eslovaquia", flag: "🇸🇰 SVK", dialCode: "+421" },
  { code: "HU", olympic: "HUN", emoji: "🇭🇺", name: "Hungría", flag: "🇭🇺 HUN", dialCode: "+36" },
  { code: "RO", olympic: "ROU", emoji: "🇷🇴", name: "Rumania", flag: "🇷🇴 ROU", dialCode: "+40" },
  { code: "HR", olympic: "CRO", emoji: "🇭🇷", name: "Croacia", flag: "🇭🇷 CRO", dialCode: "+385" },
  { code: "BG", olympic: "BUL", emoji: "🇧🇬", name: "Bulgaria", flag: "🇧🇬 BUL", dialCode: "+359" },
  { code: "RS", olympic: "SRB", emoji: "🇷🇸", name: "Serbia", flag: "🇷🇸 SRB", dialCode: "+381" },
  { code: "LU", olympic: "LUX", emoji: "🇱🇺", name: "Luxemburgo", flag: "🇱🇺 LUX", dialCode: "+352" },
  { code: "IL", olympic: "ISR", emoji: "🇮🇱", name: "Israel", flag: "🇮🇱 ISR", dialCode: "+972" },
  { code: "RU", olympic: "RUS", emoji: "🇷🇺", name: "Rusia", flag: "🇷🇺 RUS", dialCode: "+7" },

  // Asia & Oceania (World Archery Asia & Oceania)
  { code: "KR", olympic: "KOR", emoji: "🇰🇷", name: "Corea del Sur", flag: "🇰🇷 KOR", dialCode: "+82" },
  { code: "JP", olympic: "JPN", emoji: "🇯🇵", name: "Japón", flag: "🇯🇵 JPN", dialCode: "+81" },
  { code: "TW", olympic: "TPE", emoji: "🇹🇼", name: "China Taipéi", flag: "🇹🇼 TPE", dialCode: "+886" },
  { code: "CN", olympic: "CHN", emoji: "🇨🇳", name: "China", flag: "🇨🇳 CHN", dialCode: "+86" },
  { code: "IN", olympic: "IND", emoji: "🇮🇳", name: "India", flag: "🇮🇳 IND", dialCode: "+91" },
  { code: "AU", olympic: "AUS", emoji: "🇦🇺", name: "Australia", flag: "🇦🇺 AUS", dialCode: "+61" },
  { code: "NZ", olympic: "NZL", emoji: "🇳🇿", name: "Nueva Zelanda", flag: "🇳🇿 NZL", dialCode: "+64" },
  { code: "ID", olympic: "INA", emoji: "🇮🇩", name: "Indonesia", flag: "🇮🇩 INA", dialCode: "+62" },
  { code: "MY", olympic: "MAS", emoji: "🇲🇾", name: "Malasia", flag: "🇲🇾 MAS", dialCode: "+60" },
  { code: "TH", olympic: "THA", emoji: "🇹🇭", name: "Tailandia", flag: "🇹🇭 THA", dialCode: "+66" },
  { code: "SG", olympic: "SGP", emoji: "🇸🇬", name: "Singapur", flag: "🇸🇬 SGP", dialCode: "+65" },
  { code: "PH", olympic: "PHI", emoji: "🇵🇭", name: "Filipinas", flag: "🇵🇭 PHI", dialCode: "+63" },
  { code: "VN", olympic: "VIE", emoji: "🇻🇳", name: "Vietnam", flag: "🇻🇳 VIE", dialCode: "+84" },
  { code: "HK", olympic: "HKG", emoji: "🇭🇰", name: "Hong Kong", flag: "🇭🇰 HKG", dialCode: "+852" },
  { code: "KZ", olympic: "KAZ", emoji: "🇰🇿", name: "Kazajistán", flag: "🇰🇿 KAZ", dialCode: "+7" },
  { code: "MN", olympic: "MGL", emoji: "🇲🇳", name: "Mongolia", flag: "🇲🇳 MGL", dialCode: "+976" },
  { code: "BD", olympic: "BAN", emoji: "🇧🇩", name: "Bangladés", flag: "🇧🇩 BAN", dialCode: "+880" },

  // Middle East & Africa (World Archery Africa & West Asia)
  { code: "SA", olympic: "KSA", emoji: "🇸🇦", name: "Arabia Saudita", flag: "🇸🇦 KSA", dialCode: "+966" },
  { code: "AE", olympic: "UAE", emoji: "🇦🇪", name: "Emiratos Árabes Unidos", flag: "🇦🇪 UAE", dialCode: "+971" },
  { code: "QA", olympic: "QAT", emoji: "🇶🇦", name: "Catar", flag: "🇶🇦 QAT", dialCode: "+974" },
  { code: "KW", olympic: "KUW", emoji: "🇰🇼", name: "Kuwait", flag: "🇰🇼 KUW", dialCode: "+965" },
  { code: "EG", olympic: "EGY", emoji: "🇪🇬", name: "Egipto", flag: "🇪🇬 EGY", dialCode: "+20" },
  { code: "ZA", olympic: "RSA", emoji: "🇿🇦", name: "Sudáfrica", flag: "🇿🇦 RSA", dialCode: "+27" },
  { code: "MA", olympic: "MAR", emoji: "🇲🇦", name: "Marruecos", flag: "🇲🇦 MAR", dialCode: "+212" },
  { code: "TN", olympic: "TUN", emoji: "🇹🇳", name: "Túnez", flag: "🇹🇳 TUN", dialCode: "+216" },
  { code: "KE", olympic: "KEN", emoji: "🇰🇪", name: "Kenia", flag: "🇰🇪 KEN", dialCode: "+254" },

  // Global fallback
  { code: "INT", olympic: "INT", emoji: "🌐", name: "Internacional / Otro", flag: "🌐 INT", dialCode: "+" }
];

export const COUNTRIES_MAP: Record<
  string,
  { name: string; flag: string; olympic: string; emoji: string; dialCode: string; defaultUnits?: "metric" | "imperial" }
> = Object.fromEntries(
  COUNTRIES.map((c) => [
    c.code,
    {
      name: c.name,
      flag: c.flag,
      olympic: c.olympic,
      emoji: c.emoji,
      dialCode: c.dialCode,
      defaultUnits: c.defaultUnits
    }
  ])
);

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

/**
 * Resolves the country display name localized into the active UI language (`en`, `ko`, `ja`, `fr`, `de`, `pt`, etc.)
 * via native browser `Intl.DisplayNames`, with graceful World Archery fallback (e.g. `TW` -> Chinese Taipei).
 */
export function getLocalizedCountryName(code: string, lang: string = "es"): string {
  const upper = (code || "").trim().toUpperCase();
  const baseEntry = COUNTRIES_MAP[upper];
  const normalizedLang = (lang === "iw" ? "he" : lang || "es").trim();

  if (upper === "INT") {
    if (normalizedLang.startsWith("es")) return "Internacional / Otro";
    if (normalizedLang.startsWith("ko")) return "기타 / 국제";
    if (normalizedLang.startsWith("ja")) return "その他 / 国際";
    if (normalizedLang.startsWith("fr")) return "International / Autre";
    if (normalizedLang.startsWith("de")) return "International / Andere";
    if (normalizedLang.startsWith("pt")) return "Internacional / Outro";
    if (normalizedLang.startsWith("zh")) return "国际 / 其他";
    return "International / Other";
  }

  if (normalizedLang.startsWith("es") && baseEntry) {
    return baseEntry.name;
  }

  if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function" && upper.length === 2) {
    try {
      let dn = displayNamesCache.get(normalizedLang);
      if (dn === undefined) {
        dn = new Intl.DisplayNames([normalizedLang, "en"], { type: "region" });
        displayNamesCache.set(normalizedLang, dn);
      }
      if (dn) {
        const localized = dn.of(upper);
        if (localized && localized !== upper) {
          return localized;
        }
      }
    } catch {
      // Fallback below
    }
  }

  return baseEntry?.name || upper || "—";
}

export interface CountryItem {
  code: string;
  olympic: string;
  emoji: string;
  name: string;
  flag: string;
}

export const COUNTRIES: CountryItem[] = [
  { code: "CR", olympic: "CRC", emoji: "🇨🇷", name: "Costa Rica", flag: "🇨🇷 CRC" },
  { code: "MX", olympic: "MEX", emoji: "🇲🇽", name: "México", flag: "🇲🇽 MEX" },
  { code: "ES", olympic: "ESP", emoji: "🇪🇸", name: "España", flag: "🇪🇸 ESP" },
  { code: "CO", olympic: "COL", emoji: "🇨🇴", name: "Colombia", flag: "🇨🇴 COL" },
  { code: "AR", olympic: "ARG", emoji: "🇦🇷", name: "Argentina", flag: "🇦🇷 ARG" },
  { code: "CL", olympic: "CHI", emoji: "🇨🇱", name: "Chile", flag: "🇨🇱 CHI" },
  { code: "PE", olympic: "PER", emoji: "🇵🇪", name: "Perú", flag: "🇵🇪 PER" },
  { code: "BR", olympic: "BRA", emoji: "🇧🇷", name: "Brasil", flag: "🇧🇷 BRA" },
  { code: "GT", olympic: "GUA", emoji: "🇬🇹", name: "Guatemala", flag: "🇬🇹 GUA" },
  { code: "PA", olympic: "PAN", emoji: "🇵🇦", name: "Panamá", flag: "🇵🇦 PAN" },
  { code: "SV", olympic: "ESA", emoji: "🇸🇻", name: "El Salvador", flag: "🇸🇻 ESA" },
  { code: "HN", olympic: "HON", emoji: "🇭🇳", name: "Honduras", flag: "🇭🇳 HON" },
  { code: "NI", olympic: "NCA", emoji: "🇳🇮", name: "Nicaragua", flag: "🇳🇮 NCA" },
  { code: "EC", olympic: "ECU", emoji: "🇪🇨", name: "Ecuador", flag: "🇪🇨 ECU" },
  { code: "VE", olympic: "VEN", emoji: "🇻🇪", name: "Venezuela", flag: "🇻🇪 VEN" },
  { code: "UY", olympic: "URU", emoji: "🇺🇾", name: "Uruguay", flag: "🇺🇾 URU" },
  { code: "PY", olympic: "PAR", emoji: "🇵🇾", name: "Paraguay", flag: "🇵🇾 PAR" },
  { code: "BO", olympic: "BOL", emoji: "🇧🇴", name: "Bolivia", flag: "🇧🇴 BOL" },
  { code: "PR", olympic: "PUR", emoji: "🇵🇷", name: "Puerto Rico", flag: "🇵🇷 PUR" },
  { code: "DO", olympic: "DOM", emoji: "🇩🇴", name: "República Dominicana", flag: "🇩🇴 DOM" },
  { code: "CU", olympic: "CUB", emoji: "🇨🇺", name: "Cuba", flag: "🇨🇺 CUB" },
  { code: "US", olympic: "USA", emoji: "🇺🇸", name: "Estados Unidos", flag: "🇺🇸 USA" },
  { code: "CA", olympic: "CAN", emoji: "🇨🇦", name: "Canadá", flag: "🇨🇦 CAN" },
  { code: "PT", olympic: "POR", emoji: "🇵🇹", name: "Portugal", flag: "🇵🇹 POR" },
  { code: "FR", olympic: "FRA", emoji: "🇫🇷", name: "Francia", flag: "🇫🇷 FRA" },
  { code: "IT", olympic: "ITA", emoji: "🇮🇹", name: "Italia", flag: "🇮🇹 ITA" },
  { code: "DE", olympic: "GER", emoji: "🇩🇪", name: "Alemania", flag: "🇩🇪 GER" },
  { code: "GB", olympic: "GBR", emoji: "🇬🇧", name: "Reino Unido", flag: "🇬🇧 GBR" },
  { code: "KR", olympic: "KOR", emoji: "🇰🇷", name: "Corea del Sur", flag: "🇰🇷 KOR" },
  { code: "JP", olympic: "JPN", emoji: "🇯🇵", name: "Japón", flag: "🇯🇵 JPN" }
];

export const COUNTRIES_MAP: Record<string, { name: string; flag: string; olympic: string; emoji: string }> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, { name: c.name, flag: c.flag, olympic: c.olympic, emoji: c.emoji }])
);

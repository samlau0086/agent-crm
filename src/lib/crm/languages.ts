import { resolveCountry } from "@/lib/crm/countries";

export interface LanguageOption {
  value: string;
  label: string;
  nativeLabel: string;
}

export const languageOptions: LanguageOption[] = [
  { value: "en", label: "English", nativeLabel: "English" },
  { value: "zh-CN", label: "Chinese (Simplified)", nativeLabel: "Chinese (Simplified)" },
  { value: "es", label: "Spanish", nativeLabel: "Spanish" },
  { value: "fr", label: "French", nativeLabel: "French" },
  { value: "de", label: "German", nativeLabel: "Deutsch" },
  { value: "ja", label: "Japanese", nativeLabel: "Japanese" },
  { value: "ko", label: "Korean", nativeLabel: "Korean" },
  { value: "pt", label: "Portuguese", nativeLabel: "Portuguese" },
  { value: "it", label: "Italian", nativeLabel: "Italiano" },
  { value: "nl", label: "Dutch", nativeLabel: "Nederlands" },
  { value: "ru", label: "Russian", nativeLabel: "Russian" },
  { value: "ar", label: "Arabic", nativeLabel: "Arabic" },
  { value: "hi", label: "Hindi", nativeLabel: "Hindi" },
  { value: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia" },
  { value: "ms", label: "Malay", nativeLabel: "Bahasa Melayu" },
  { value: "th", label: "Thai", nativeLabel: "Thai" },
  { value: "vi", label: "Vietnamese", nativeLabel: "Vietnamese" },
  { value: "tr", label: "Turkish", nativeLabel: "Turkish" },
  { value: "pl", label: "Polish", nativeLabel: "Polski" },
  { value: "sv", label: "Swedish", nativeLabel: "Svenska" },
  { value: "da", label: "Danish", nativeLabel: "Dansk" },
  { value: "no", label: "Norwegian", nativeLabel: "Norsk" },
  { value: "fi", label: "Finnish", nativeLabel: "Suomi" },
  { value: "cs", label: "Czech", nativeLabel: "Czech" },
  { value: "hu", label: "Hungarian", nativeLabel: "Magyar" },
  { value: "ro", label: "Romanian", nativeLabel: "Romanian" },
  { value: "el", label: "Greek", nativeLabel: "Greek" },
  { value: "he", label: "Hebrew", nativeLabel: "Hebrew" },
  { value: "uk", label: "Ukrainian", nativeLabel: "Ukrainian" },
  { value: "fa", label: "Persian", nativeLabel: "Persian" },
  { value: "bn", label: "Bengali", nativeLabel: "Bengali" },
  { value: "sw", label: "Swahili", nativeLabel: "Kiswahili" }
];

const languageByValue = new Map(languageOptions.map((language) => [language.value.toLowerCase(), language]));

const officialLanguageByCountryCode: Record<string, string> = {
  CN: "zh-CN",
  HK: "zh-CN",
  MO: "zh-CN",
  TW: "zh-CN",
  US: "en",
  GB: "en",
  CA: "en",
  AU: "en",
  NZ: "en",
  IE: "en",
  SG: "en",
  IN: "hi",
  JP: "ja",
  KR: "ko",
  ES: "es",
  MX: "es",
  AR: "es",
  CL: "es",
  CO: "es",
  PE: "es",
  VE: "es",
  EC: "es",
  BO: "es",
  UY: "es",
  PY: "es",
  CR: "es",
  PA: "es",
  DO: "es",
  GT: "es",
  HN: "es",
  SV: "es",
  NI: "es",
  CU: "es",
  BR: "pt",
  PT: "pt",
  FR: "fr",
  BE: "fr",
  LU: "fr",
  MC: "fr",
  DE: "de",
  AT: "de",
  CH: "de",
  IT: "it",
  NL: "nl",
  RU: "ru",
  SA: "ar",
  AE: "ar",
  QA: "ar",
  KW: "ar",
  BH: "ar",
  OM: "ar",
  EG: "ar",
  MA: "ar",
  JO: "ar",
  LB: "ar",
  ID: "id",
  MY: "ms",
  TH: "th",
  VN: "vi",
  TR: "tr",
  PL: "pl",
  SE: "sv",
  DK: "da",
  NO: "no",
  FI: "fi",
  CZ: "cs",
  HU: "hu",
  RO: "ro",
  GR: "el",
  IL: "he",
  UA: "uk",
  IR: "fa",
  BD: "bn",
  KE: "sw",
  TZ: "sw"
};

export function getLanguageSelectOptions(): Array<{ label: string; value: string; meta?: string }> {
  return languageOptions.map((language) => ({
    label: language.nativeLabel === language.label ? language.label : `${language.nativeLabel} / ${language.label}`,
    value: language.value,
    meta: language.value
  }));
}

export function resolveLanguage(value: unknown): LanguageOption | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return languageByValue.get(normalized.toLowerCase()) ?? { value: normalized, label: normalized, nativeLabel: normalized };
}

export function getLanguageLabel(value: unknown): string {
  const language = resolveLanguage(value);
  if (!language) {
    return "";
  }
  return language.nativeLabel === language.label ? language.label : `${language.nativeLabel} / ${language.label}`;
}

export function getCountryOfficialLanguage(country: unknown): string {
  const resolvedCountry = resolveCountry(country);
  if (!resolvedCountry) {
    return "en";
  }
  return officialLanguageByCountryCode[resolvedCountry.code] ?? "en";
}

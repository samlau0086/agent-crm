import { getCountryLabel, resolveCountry } from "@/lib/crm/countries";

export type ParsedAddressDraft = {
  country?: string;
  region?: string;
  city?: string;
  line1?: string;
  line2?: string;
  postalCode?: string;
};

const addressPartSeparator = /[\n,\uFF0C;\uFF1B|]+/;
const ukPostalCodePattern = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const canadaPostalCodePattern = /\b([A-Z]\d[A-Z][ -]?\d[A-Z]\d)\b/i;
const numericPostalCodePattern = /\b(\d{5,6}(?:-\d{4})?)\b/;

function normalizeAddressToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePostalCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function findPostalCode(text: string): string | undefined {
  const match = text.match(ukPostalCodePattern) ?? text.match(canadaPostalCodePattern) ?? text.match(numericPostalCodePattern);
  return match?.[1] ? normalizePostalCode(match[1]) : undefined;
}

function isRegionLike(part: string): boolean {
  return /(\u7701|\u5dde|\u81ea\u6cbb\u533a|\u7279\u522b\u884c\u653f\u533a|province|state|region)$/i.test(part.trim());
}

function isCityLike(part: string): boolean {
  return /(\u5e02|city)$/i.test(part.trim());
}

export function parseAddressWithLocalAi(input: string): ParsedAddressDraft {
  const text = input.trim();
  if (!text) {
    return {};
  }

  const rawParts = text.split(addressPartSeparator).map((part) => part.trim()).filter(Boolean);
  const postalCode = findPostalCode(text);
  const postalToken = postalCode ? normalizeAddressToken(postalCode) : "";
  const countryMatch = rawParts.map((part) => ({ part, country: resolveCountry(part) })).find((entry) => entry.country);
  const country = countryMatch?.country;
  const countryToken = countryMatch ? normalizeAddressToken(countryMatch.part) : "";
  const parts = rawParts.filter((part) => {
    const normalized = normalizeAddressToken(part);
    return normalized !== countryToken && normalized !== postalToken;
  });

  const regionIndex = parts.findIndex(isRegionLike);
  const cityIndex = parts.findIndex(isCityLike);
  let region = regionIndex >= 0 ? parts[regionIndex] : "";
  let city = cityIndex >= 0 ? parts[cityIndex] : "";
  const lineParts = parts.filter((_, index) => index !== regionIndex && index !== cityIndex);

  if (!city && lineParts.length >= 2) {
    city = lineParts.pop() ?? "";
  }

  if (!region && !country && lineParts.length >= 3) {
    region = lineParts.splice(lineParts.length - 1, 1)[0] ?? "";
  }

  return {
    country: country?.name,
    postalCode,
    region: region || undefined,
    city: city || undefined,
    line1: lineParts[0] ?? (!city ? text : undefined),
    line2: lineParts.slice(1).join(", ") || undefined
  };
}

export function formatParsedAddressText(address: ParsedAddressDraft): string {
  return [
    address.line1,
    address.line2,
    [address.city, address.region, address.country ? getCountryLabel(address.country) : ""].filter(Boolean).join(", "),
    address.postalCode
  ].filter(Boolean).join("\n");
}

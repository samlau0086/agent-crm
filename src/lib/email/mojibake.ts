const windows1252SpecialChars = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f]
]);

const mojibakePattern = /(?:Ã.|Â.|â.|ä.|å.|æ.|ç.|è.|é.|ï.|ð.|ñ.|ò.|ó.|ô.|õ.|ö.|ø.|ù.|ú.|û.|ü.)/;
const cjkPattern = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g;
const replacementPattern = /\uFFFD/g;

export function repairEmailMojibake(value: string | undefined | null): string {
  if (!value || !mojibakePattern.test(value)) {
    return value ?? "";
  }

  const repaired = decodeWindows1252Mojibake(value);
  return shouldUseRepairedText(value, repaired) ? repaired : value;
}

function decodeWindows1252Mojibake(value: string): string {
  const bytes: number[] = [];
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    const mapped = windows1252SpecialChars.get(codePoint);
    if (mapped !== undefined) {
      bytes.push(mapped);
    } else if (codePoint <= 0xff) {
      bytes.push(codePoint);
    } else {
      bytes.push(...new TextEncoder().encode(char));
    }
  }

  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return value;
  }
}

function shouldUseRepairedText(original: string, repaired: string): boolean {
  if (!repaired || repaired === original) {
    return false;
  }

  const originalScore = textQualityScore(original);
  const repairedScore = textQualityScore(repaired);
  return repairedScore >= originalScore + 3;
}

function textQualityScore(value: string): number {
  const cjkCount = value.match(cjkPattern)?.length ?? 0;
  const replacementCount = value.match(replacementPattern)?.length ?? 0;
  const mojibakeCount = value.match(new RegExp(mojibakePattern.source, "g"))?.length ?? 0;
  return cjkCount * 3 - mojibakeCount * 2 - replacementCount * 5;
}

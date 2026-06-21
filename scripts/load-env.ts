import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnvFiles(fileNames = [".env", ".env.local"], cwd = process.cwd()): void {
  for (const fileName of fileNames) {
    const filePath = resolve(cwd, fileName);
    if (!existsSync(filePath)) {
      continue;
    }
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      if (process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim());
    }
  }
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

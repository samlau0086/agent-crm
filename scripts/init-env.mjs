import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const examplePath = resolve(process.cwd(), String(args.example ?? ".env.example"));
const outputPath = resolve(process.cwd(), String(args.output ?? ".env"));
const force = args.force === true;
const mergeMissing = args["merge-missing"] === true;

if (!existsSync(examplePath)) {
  console.error(`[init-env] Example file not found: ${examplePath}`);
  process.exit(1);
}

if (existsSync(outputPath) && mergeMissing) {
  const existing = readFileSync(outputPath, "utf8");
  const merged = mergeMissingEnvValues(existing, buildInitializedTemplate(readFileSync(examplePath, "utf8")));
  writeFileSync(outputPath, merged, { encoding: "utf8", flag: "w" });
  console.log(`[init-env] Merged missing values into ${outputPath}`);
  console.log("[init-env] Existing values were preserved. Review APP_BASE_URL, AI_API_KEY, and mailbox OAuth variables before production use.");
  process.exit(0);
}

if (existsSync(outputPath) && !force) {
  console.error(`[init-env] Refusing to overwrite existing file: ${outputPath}`);
  console.error("[init-env] Pass --merge-missing to preserve existing values and append missing keys, or --force only after reviewing the existing environment file.");
  process.exit(1);
}

const initialized = buildInitializedTemplate(readFileSync(examplePath, "utf8"));

writeFileSync(outputPath, initialized, { encoding: "utf8", flag: force ? "w" : "wx" });
console.log(`[init-env] Wrote ${outputPath}`);
console.log("[init-env] Review APP_BASE_URL, AI_API_KEY, and mailbox OAuth variables before production use.");

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

function buildInitializedTemplate(template) {
  return template
    .replace(/^EMAIL_CONFIG_SECRET=.*$/m, `EMAIL_CONFIG_SECRET="${randomSecret()}"`)
    .replace(/^EMAIL_OAUTH_STATE_SECRET=.*$/m, `EMAIL_OAUTH_STATE_SECRET="${randomSecret()}"`);
}

function mergeMissingEnvValues(existing, initializedTemplate) {
  const existingKeys = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => parseEnvKey(line))
      .filter(Boolean)
  );
  const missingLines = initializedTemplate
    .split(/\r?\n/)
    .filter((line) => {
      const key = parseEnvKey(line);
      return key && !existingKeys.has(key);
    });
  if (missingLines.length === 0) {
    return existing;
  }
  const separator = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  return `${existing}${separator}\n# Added by scripts/init-env.mjs --merge-missing\n${missingLines.join("\n")}\n`;
}

function parseEnvKey(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmed);
  return match?.[1];
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) {
      parsed[key] = inline;
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

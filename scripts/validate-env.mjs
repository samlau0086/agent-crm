import { existsSync, readFileSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
loadEnvFile(".env");
loadEnvFile(".env.local");
const env = process.env;
const result = validateEnv(env);

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const warning of result.warnings) {
    console.error(`Warning: ${warning}`);
  }
  for (const error of result.errors) {
    console.error(`Error: ${error}`);
  }
  if (result.ok) {
    console.log("Environment validation passed.");
  }
}

if (!result.ok) {
  process.exit(1);
}

function validateEnv(values) {
  const errors = [];
  const warnings = [];
  const isProduction = values.NODE_ENV === "production";

  if (!values.DATABASE_URL?.trim()) {
    errors.push("DATABASE_URL is required.");
  }

  if (values.JOB_EXECUTOR === "redis" && !values.REDIS_URL?.trim()) {
    errors.push("REDIS_URL is required when JOB_EXECUTOR=redis.");
  }

  if (values.ALLOW_TEST_USER_HEADER === "true" && isProduction) {
    errors.push("ALLOW_TEST_USER_HEADER must not be enabled in production.");
  }

  if (isProduction) {
    validateProductionAppBaseUrl(values.APP_BASE_URL, errors, warnings, values.ALLOW_INSECURE_APP_BASE_URL === "true");
    if (values.SEED_ON_EMPTY === "true") {
      warnings.push("SEED_ON_EMPTY=true will seed demo data into an empty production database.");
    }
    if ((values.AI_PROVIDER ?? "openai-compatible") === "openai-compatible" && !values.AI_API_KEY?.trim()) {
      warnings.push("AI_API_KEY is empty; AI features will use the local read-only fallback.");
    }
    if (values.ALLOW_PRIVATE_WEBHOOK_URLS === "true") {
      warnings.push("ALLOW_PRIVATE_WEBHOOK_URLS=true permits webhooks to target localhost or private network addresses.");
    }
  }

  if (args.strict && warnings.length > 0) {
    errors.push(...warnings.map((warning) => `Strict mode warning: ${warning}`));
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateProductionAppBaseUrl(value, errors, warnings, allowInsecure) {
  if (!value?.trim()) {
    errors.push("APP_BASE_URL is required in production.");
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    errors.push("APP_BASE_URL must be a valid URL.");
    return;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    errors.push("APP_BASE_URL must use http or https.");
    return;
  }

  if (url.username || url.password) {
    errors.push("APP_BASE_URL must not include credentials.");
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    warnings.push("APP_BASE_URL should be an origin only, for example https://crm.example.com.");
  }

  if (url.protocol === "http:" && !isLoopbackHost(url.hostname) && !allowInsecure) {
    errors.push("APP_BASE_URL must use https for non-local production deployments. Set ALLOW_INSECURE_APP_BASE_URL=true only for trusted private networks.");
  }
}

function isLoopbackHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    parsed[key] = inline ?? true;
  }
  return parsed;
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index <= 0) continue;

    const key = trimmed.slice(0, index).trim();
    if (process.env[key] !== undefined) continue;

    process.env[key] = unquote(trimmed.slice(index + 1).trim());
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

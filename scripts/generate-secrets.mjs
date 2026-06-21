import { randomBytes } from "node:crypto";

const args = parseArgs(process.argv.slice(2));
const byteLength = normalizeByteLength(args.bytes);
const secrets = {
  EMAIL_CONFIG_SECRET: randomSecret(byteLength),
  EMAIL_OAUTH_STATE_SECRET: randomSecret(byteLength)
};

if (args.json) {
  console.log(JSON.stringify(secrets, null, 2));
} else {
  for (const [key, value] of Object.entries(secrets)) {
    console.log(`${key}="${value}"`);
  }
}

function randomSecret(bytes) {
  return randomBytes(bytes).toString("base64url");
}

function normalizeByteLength(value) {
  const parsed = Number(value ?? 32);
  if (!Number.isFinite(parsed)) {
    return 32;
  }
  return Math.min(128, Math.max(16, Math.floor(parsed)));
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

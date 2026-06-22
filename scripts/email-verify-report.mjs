import { existsSync, readFileSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const file = String(args.file ?? args.f ?? "email-verify-last.json");
const failOnNotReady = args["fail-on-not-ready"] !== false && args["fail-on-not-ready"] !== "false";

try {
  if (!existsSync(file)) {
    throw new Error(`Email verification result file not found: ${file}`);
  }

  const payload = JSON.parse(readFileSync(file, "utf8"));
  const readiness = payload.readiness ?? {};
  const mailbox = readiness.mailboxConnections ?? {};
  const aiProvider = readiness.aiProvider ?? {};
  const smoke = readiness.applicationSmoke ?? {};
  const operationalUser = payload.operationalUser ?? {};

  const lines = [
    `ok=${payload.ok === true}`,
    `liveReadinessRequired=${payload.liveReadinessRequired === true}`,
    `liveTrafficReady=${readiness.liveTrafficReady === true}`,
    `automatedChecksOk=${readiness.automatedChecksOk === true}`,
    `mailboxes=${mailbox.passed ?? 0}/${mailbox.tested ?? 0}`,
    `mailboxesRequired=${mailbox.required === true}`,
    `aiProvider=${aiProvider.status ?? "unknown"}`,
    `aiProviderVerified=${aiProvider.verified === true}`,
    `applicationSmoke=${smoke.status ?? "unknown"}`,
    `applicationSmokeVerified=${smoke.verified === true}`,
    `operationalUser=${operationalUser.resolvedUserId ?? payload.userId ?? "unknown"}`,
    `fallbackUser=${operationalUser.fallbackUsed === true}`
  ];

  console.log(lines.join("\n"));
  printList("blockers", readiness.blockers);
  printList("warnings", readiness.warnings);
  printList("manualActions", readiness.manualActions);

  if (failOnNotReady && (payload.ok !== true || readiness.liveTrafficReady !== true)) {
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Email verification report failed.");
  process.exit(1);
}

function printList(label, values) {
  const items = Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.trim()) : [];
  console.log(`${label}=${items.length}`);
  for (const item of items.slice(0, 10)) {
    console.log(`- ${item}`);
  }
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

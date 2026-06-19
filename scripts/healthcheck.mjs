const port = process.env.PORT ?? "3000";
const host = process.env.HOSTNAME ?? "127.0.0.1";
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS ?? 5000);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(`http://${host}:${port}/api/health`, {
    signal: controller.signal
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.ok !== true) {
    console.error(`Health check failed: HTTP ${response.status}`);
    process.exit(1);
  }

  console.log("Health check passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Health check failed");
  process.exit(1);
} finally {
  clearTimeout(timeout);
}

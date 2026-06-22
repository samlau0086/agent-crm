const port = process.env.PORT ?? "3000";
const host = process.env.HEALTHCHECK_HOST ?? "127.0.0.1";
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
    console.error(formatHealthSummary(body));
    process.exit(1);
  }

  console.log(`Health check passed. ${formatHealthSummary(body)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Health check failed");
  process.exit(1);
} finally {
  clearTimeout(timeout);
}

function formatHealthSummary(body) {
  const parts = [
    `database=${body?.database ?? "unknown"}`,
    `jobs=${body?.jobs?.ok === true ? "ok" : body?.jobs?.queue ?? "unknown"}`,
    `email=${body?.emailReadiness?.status ?? body?.email?.status ?? "unknown"}`,
    `emailSecrets=${body?.emailReadiness?.encryption ?? body?.email?.encryption?.status ?? "unknown"}`,
    `emailOAuthState=${body?.emailReadiness?.oauthState ?? body?.email?.oauthState?.status ?? "unknown"}`,
    `emailOAuthCallback=${body?.emailReadiness?.oauthCallback ?? body?.email?.oauthCallback?.status ?? "unknown"}`,
    `emailDelivery=${body?.emailReadiness?.deliveryMode ?? body?.email?.deliveryMode?.status ?? "unknown"}`,
    `emailAi=${body?.emailReadiness?.aiProvider ?? body?.email?.aiProvider?.status ?? "unknown"}`,
    `emailAiContext=${body?.emailReadiness?.aiContextPolicy?.status ?? body?.email?.aiContextPolicy?.status ?? "unknown"}`,
    `emailAiAutomations=${body?.emailReadiness?.aiContextPolicy?.enabledAutomationCount ?? body?.email?.aiContextPolicy?.enabledAutomationCount ?? "unknown"}`,
    `emailAiFallbacks=${body?.emailReadiness?.aiProviderFallbacks?.recentFallbackCount ?? body?.email?.aiProviderFallbacks?.recentFallbackCount ?? "unknown"}`,
    `emailAutoSummary=${body?.emailReadiness?.autoSummaryPolicy?.status ?? body?.email?.autoSummaryPolicy?.status ?? "unknown"}`,
    `emailSync=${body?.emailReadiness?.syncScheduler?.status ?? body?.email?.syncScheduler?.status ?? "unknown"}`,
    `emailSyncUserSource=${body?.emailReadiness?.syncScheduler?.userIdSource ?? body?.email?.syncScheduler?.userIdSource ?? "unknown"}`,
    `emailSyncFallback=${body?.emailReadiness?.syncScheduler?.fallbackToAdmin ?? body?.email?.syncScheduler?.fallbackToAdmin ?? "unknown"}`,
    `emailSendClaims=${body?.emailReadiness?.sendClaims?.staleCount ?? body?.email?.sendClaims?.staleCount ?? "unknown"}`
  ];
  if (body?.error) {
    parts.push(`error=${body.error}`);
  }
  return parts.join(" ");
}

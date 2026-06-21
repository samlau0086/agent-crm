export type EmailDeliveryMode = "live" | "dry-run";

export function getEmailDeliveryMode(env: NodeJS.ProcessEnv = process.env): EmailDeliveryMode {
  return env.EMAIL_DELIVERY_MODE === "dry-run" ? "dry-run" : "live";
}

export function assertEmailDeliveryModeAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (getEmailDeliveryMode(env) === "dry-run" && env.NODE_ENV === "production") {
    throw new Error("EMAIL_DELIVERY_MODE=dry-run must not be enabled in production");
  }
}

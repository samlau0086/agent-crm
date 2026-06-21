export const MAX_OUTBOUND_EMAIL_RECIPIENTS = 100;

export interface OutboundEmailRecipientInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
}

export interface OutboundEmailRecipientPolicyResult {
  total: number;
  uniqueTotal: number;
  duplicateRecipients: string[];
  errors: string[];
}

export function validateOutboundEmailRecipientPolicy(input: OutboundEmailRecipientInput): OutboundEmailRecipientPolicyResult {
  const recipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
  const seen = new Map<string, string>();
  const duplicates = new Map<string, string>();

  for (const recipient of recipients) {
    const normalized = normalizeEmailAddressForPolicy(recipient);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      duplicates.set(normalized, seen.get(normalized) ?? recipient);
      continue;
    }
    seen.set(normalized, recipient.trim());
  }

  const duplicateRecipients = [...duplicates.values()].sort((left, right) => left.localeCompare(right));
  const errors: string[] = [];
  if (recipients.length > MAX_OUTBOUND_EMAIL_RECIPIENTS) {
    errors.push(`Outbound email recipients are limited to ${MAX_OUTBOUND_EMAIL_RECIPIENTS} total addresses across to, cc, and bcc`);
  }
  if (duplicateRecipients.length) {
    errors.push(`Outbound email recipients must be unique across to, cc, and bcc: ${duplicateRecipients.join(", ")}`);
  }

  return {
    total: recipients.length,
    uniqueTotal: seen.size,
    duplicateRecipients,
    errors
  };
}

export function assertOutboundEmailRecipientPolicy(input: OutboundEmailRecipientInput): void {
  const result = validateOutboundEmailRecipientPolicy(input);
  if (result.errors.length) {
    throw new Error(result.errors.join("; "));
  }
}

function normalizeEmailAddressForPolicy(value: string): string {
  return value.trim().toLowerCase();
}

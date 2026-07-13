-- Repair outbound messages that were accepted by the provider but were later
-- mislabeled as failed by post-delivery bookkeeping errors. A tracking event or
-- a complete synced IMAP Sent locator is treated as conclusive delivery evidence.
UPDATE "EmailMessage"
SET
  "status" = 'sent',
  "sentAt" = COALESCE("sendAttemptedAt", "createdAt"),
  "scheduledSendAt" = NULL,
  "failureReason" = NULL
WHERE
  "direction" = 'outbound'
  AND "status" = 'failed'
  AND (
    CASE
      WHEN jsonb_typeof("trackingEvents") = 'array'
        THEN jsonb_array_length("trackingEvents") > 0
      ELSE FALSE
    END
    OR (
      "imapSyncStatus" IN ('sent', 'synced')
      AND NULLIF(BTRIM("imapMailbox"), '') IS NOT NULL
      AND NULLIF(BTRIM("imapUid"), '') IS NOT NULL
    )
  );

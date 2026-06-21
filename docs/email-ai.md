# Email And AI Assistant

This phase adds the internal platform layer for CRM email features. It does not hard-code Gmail, Outlook, SMTP, or IMAP behavior into CRM records.

## Core Model

- `EmailAccount`: workspace-scoped mailbox configuration with provider type, send toggle, sync toggle, and status.
- `EmailThread`: customer conversation thread that can link back to a CRM record.
- `EmailMessage`: inbound, outbound, draft, queued, sent, or failed email message, with optional AI translation cache and structured attachment metadata.
- `KnowledgeArticle`: system knowledge used by AI email features.
- `EmailAiSettings`: workspace-level feature toggles and context limits.

Provider-specific sync and send implementations should be added behind adapters that read and write this model.

## REST Interfaces

- `GET/POST /api/email/accounts`: list and create workspace mailbox configurations.
- `GET /api/email/accounts/:id`: read one mailbox account without exposing encrypted connection secrets.
- `PATCH /api/email/accounts/:id`: update mailbox metadata, send/sync toggles, status, or encrypted connection config.
- `DELETE /api/email/accounts/:id`: delete an unused mailbox account, or safely disable it when email history exists.
- `GET /api/email/threads?recordId=...`: list email threads, optionally scoped to a CRM record.
- `GET /api/email/threads/:id`: read one thread using the same record/thread visibility rules as thread message listing.
- `GET /api/email/threads/:id/messages`: list messages in a thread.
- `POST /api/email/threads/:id/summarize`: refresh a compact AI thread summary when `auto_summarize` is enabled.
- `POST /api/email/threads/:id/analyze`: refresh read-only AI thread analysis and next-action guidance when `context_analysis` is enabled.
- `POST /api/email/messages`: record an inbound received message and optionally link it to a CRM record. Public outbound delivery must use `POST /api/email/send` so provider delivery, queue state, recipient policy, and failure auditing stay consistent.
- `GET /api/email/messages/:id`: read one visible message for source navigation, reply drafting, or AI provenance display.
- `POST /api/email/messages/:id/retry`: requeue a failed outbound message and run or enqueue the send job.
- `POST /api/email/messages/:id/translate`: translate one message through the shared AI context and persist the translated text on the message.
- `POST /api/email/send`: create a queued outbound CRM message with `to`, optional `cc`, and optional `bcc`, then send it through the configured provider adapter inline or through the background queue.
- `POST /api/email/sync`: trigger provider sync for an account and update sync metadata.
- `POST /api/email/sync-all`: schedule sync for all active, sync-enabled mailbox accounts in the workspace.
- `GET /api/email/diagnostics`: admin-only deployment diagnostics for mailbox secrets, OAuth, AI, queue, sync scheduler, and account readiness.
- `POST /api/email/test-connection` and `POST /api/email/test-connections`: admin-only provider connection checks for one mailbox or all active configured mailboxes.
- `GET/PATCH /api/email/ai-settings`: read or update per-workspace AI feature toggles and context limits.
- `POST /api/email/ai-context`: build bounded, source-backed context for drafting, translation, analysis, or thread summarization.
- `POST /api/email/ai-generate`: generate an email draft, translation, analysis, or compact summary from bounded context.
- `GET/POST /api/knowledge/articles`: manage active knowledge used by AI email features.
- `GET/PATCH/DELETE /api/knowledge/articles/:id`: read, update, or soft-disable a knowledge article. GET also works for disabled articles so historical AI source references remain explainable.

The API records messages and thread state through repository methods. SMTP/IMAP, Gmail, Outlook, and future custom connectors stay behind provider adapters instead of writing directly to CRM records.

## Provider Adapter

`src/lib/email/provider.ts` defines the provider boundary:

- `send(context, input)` persists outbound messages through the repository.
- `sendQueued(context, messageId)` sends an already queued outbound message, then marks it `sent` or `failed`.
- `sync(context, accountId)` updates account sync state and is the extension point for importing provider messages.

The first adapter is repository-backed so the product workflow is usable without hard-coding a vendor. SMTP/IMAP, Gmail, Outlook, or custom provider adapters can replace it behind the same interface.

`src/lib/email/providers.ts` is the provider capability registry shared by UI, OAuth, diagnostics, and attachment download checks. Add new mailbox providers there first, then implement the adapter branch behind `EmailProviderAdapter`; this keeps provider labels, OAuth environment prefixes, default scopes, and feature capability checks from spreading through the CRM codebase. The account setup UI also reads `getEmailProviderSetupVisibility()` from this registry to show SMTP/IMAP fields only for password-based providers and OAuth fields only for OAuth-capable providers, clearing stale connection fields when the provider changes.

The built-in `custom` provider is only an extension slot. Without a private adapter implementation, provider execution rejects send, sync, and connection-test attempts instead of marking email as delivered without touching a mailbox.

## SMTP/IMAP Configuration

Mailbox credentials are stored as encrypted JSON on `EmailAccount.encryptedConnectionConfig`. API responses only expose `connectionConfigured` and never return the password.

Set one of these environment variables before creating accounts with credentials:

- `EMAIL_CONFIG_SECRET`
- `APP_SECRET`

The secret must stay stable across deployments. Rotating it without re-encrypting account configs will make existing mailbox credentials unreadable.

The built-in SMTP/IMAP adapter supports:

- SMTP send over direct TLS or STARTTLS, with `AUTH PLAIN`.
- To, CC, and BCC recipients for outbound mail.
- IMAP sync from a configured mailbox, importing recent messages into CRM email threads.
- Adapter-level failure recording on the email account.

Sync requires provider connection configuration. Active accounts without SMTP/IMAP or OAuth credentials fail sync explicitly and record a connection error instead of reporting a zero-message success.

Mailbox configuration is intentionally mutable after creation:

- rotate SMTP/IMAP passwords or OAuth refresh tokens with `PATCH /api/email/accounts/:id`;
- use the email workspace's Edit connection action to load non-secret account metadata into the setup form, then enter new credentials or OAuth tokens; stored secrets are never echoed back to the browser;
- turn sending or syncing on/off independently;
- set `status=disabled` to pause the account without deleting communication history;
- use `clearConnectionConfig=true` to remove stored credentials and return the account to draft status unless an explicit status is provided.

OAuth-specific Gmail and Outlook adapters reuse the same provider interface and store refresh tokens through the same encrypted config mechanism.

## Gmail And Outlook OAuth

Gmail and Outlook accounts can store encrypted OAuth configuration in `EmailAccount.encryptedConnectionConfig`:

- `oauthProvider`
- `accessToken`
- `refreshToken`
- `tokenType`
- `expiresAt`
- `scope`

The OAuth helper validates provider/account alignment and can refresh expired access tokens through standard OAuth token endpoints. Configure these variables when using refresh tokens:

- `EMAIL_OAUTH_STATE_SECRET`
- `GMAIL_OAUTH_CLIENT_ID`
- `GMAIL_OAUTH_CLIENT_SECRET`
- `GMAIL_OAUTH_AUTH_URL`
- `GMAIL_OAUTH_TOKEN_URL`
- `GMAIL_OAUTH_SCOPE`
- `OUTLOOK_OAUTH_CLIENT_ID`
- `OUTLOOK_OAUTH_CLIENT_SECRET`
- `OUTLOOK_OAUTH_AUTH_URL`
- `OUTLOOK_OAUTH_TOKEN_URL`
- `OUTLOOK_OAUTH_SCOPE`

The SMTP/IMAP adapter does not handle Gmail or Outlook accounts implicitly. Gmail accounts send through the Gmail API and sync recent messages through Gmail message APIs. Outlook accounts send through Microsoft Graph `sendMail` and sync recent messages through Graph message APIs. Refreshed access tokens are written back to encrypted account configuration.

Current scope:

- OAuth token storage and refresh are implemented.
- Gmail/Outlook API send and recent-message sync are implemented behind `EmailProviderAdapter`.
- `POST /api/email/oauth/start` returns a signed authorization URL for Gmail or Outlook.
- `GET /api/email/oauth/callback` validates signed state, exchanges the authorization code, and creates an active encrypted email account, or updates the existing account with the same normalized email address so token rotation and reconnect flows do not create duplicates. Browser callbacks redirect back to the CRM workspace with `emailOAuth=connected`, `emailAccountId`, and `emailAccountCreated` query parameters; OAuth errors redirect back with `emailOAuth=error` and a bounded `emailOAuthError`. JSON clients still receive the connected account payload or structured API error.
- The email account UI includes an OAuth authorization button for Gmail and Outlook.

Configure the OAuth app redirect URI as:

```text
{APP_BASE_URL}/api/email/oauth/callback
```

For Docker Compose deployments, `APP_BASE_URL` is read from `.env`; set it to the externally reachable CRM origin before enabling Gmail or Outlook OAuth.

## Background Email Jobs

Email sync and queued email send run through the shared background job executor:

- Inline mode processes the selected sync account or queued outbound message immediately.
- Redis mode enqueues `email_sync`, `email_send`, `email_translate`, `email_analyze`, and `email_summarize` jobs.
- `EMAIL_DELIVERY_MODE=dry-run` can be used in non-production E2E or local verification to record outbound messages without contacting SMTP, Gmail, or Outlook. Production validation rejects this mode.
- Redis mode checks the same caller permissions before enqueueing: email sync requires `crm.admin`, queued send requires `crm.write`, and AI translation, analysis, and summarization require `ai.use`.
- `POST /api/email/send` persists a `queued` outbound message before execution. The worker sends that message through the same provider adapter and updates the status to `sent`; provider failures mark the message `failed` and can be retried by the job worker.
- Outbound messages can include up to 10 small attachments as structured JSON. SMTP and Gmail send them as multipart MIME; Outlook sends them as Graph `fileAttachment` objects. Inbound sync stores provider attachment metadata, including provider message and attachment ids when available, and `GET /api/email/messages/:id/attachments/:index` downloads stored bytes or retrieves Gmail/Outlook content through the provider adapter.
- Outbound sends enforce a sales-email policy before provider delivery: at most 100 total recipients across `to`, `cc`, and `bcc`, and no duplicate recipient across those fields. Policy failures keep queued messages from reaching SMTP, Gmail, or Outlook and store a message-level failure reason.
- AI-assisted outbound drafts carry bounded provenance (`aiAssisted`, `aiPurpose`, optional source message id, structured `aiSources`, and generation timestamp) through queueing and delivery. Source message and CRM record refs are validated before persistence. The system does not store the AI prompt or duplicate the generated body into audit metadata, and sending still requires the user to submit the composed email.
- The compose UI shows an AI-assisted draft marker before send and lets the user clear that marker after manual rewrite.
- `POST /api/email/messages/:id/retry` moves a failed outbound message back to `queued` and uses the same send job path, so manual retries do not bypass provider adapters or audit logging.
- The worker consumes email jobs through the same provider adapter used by manual actions.

Operational entry points:

- `POST /api/email/send` queues or runs one outbound message.
- `POST /api/email/messages/:id/retry` queues or runs one failed outbound message again.
- `POST /api/email/messages/:id/translate` queues or runs one message translation and stores the result.
- `POST /api/email/sync` queues or runs one account.
- `POST /api/email/sync-all` queues or runs every active account with `syncEnabled=true`.
- `POST /api/email/test-connections` explicitly tests every active configured account against its provider and returns per-account success, failure, and skipped results.
- Automatic thread summarization runs through the same AI summarization service as `POST /api/email/threads/:id/summarize`; inline mode updates the compact memory immediately, while Redis mode queues `email_summarize`.
- Manual `POST /api/email/threads/:id/summarize` calls use the same background executor. Redis mode returns `queued=true`, the current thread, and a queued placeholder result while the worker refreshes the compact summary later.
- `npm run worker` processes queued `email_sync`, `email_send`, `email_translate`, `email_analyze`, and `email_summarize` jobs through the same provider adapter and AI context rules as manual actions.
- `npm run email:sync` schedules sync once for every active account with `syncEnabled=true`.
- `npm run email:sync -- --loop` runs the same scheduler continuously. Set `EMAIL_SYNC_INTERVAL_MS` to control the polling interval; it defaults to 300000 ms. Set `EMAIL_SYNC_LIMIT` or pass `-- --limit <1-100>` to cap how many messages each account syncs per run.
- The Docker Compose stack includes an `email-sync` service that runs `email:sync -- --loop`, enqueues account sync jobs through Redis, and leaves provider execution to the `worker` service.
- Set `EMAIL_SYNC_USER_ID` to the admin user that should own the audit context; it defaults to `user-admin`.
- `npm run email:verify` prints email subsystem diagnostics and a manual real-mailbox verification checklist. Add `-- --test-connections` to test all active configured accounts against SMTP/IMAP, Gmail, or Outlook provider APIs. Set `EMAIL_VERIFY_USER_ID` or pass `-- --user-id <admin-user-id>` when `user-admin` is not available.
- Email operational scripts (`worker`, `email:sync`, and `email:verify`) load `.env` and `.env.local` before connecting to the database, without overriding environment variables already supplied by the shell, Docker, or the process manager.
- Email operational scripts also run a PostgreSQL TCP preflight before Prisma starts. Set `EMAIL_SKIP_DATABASE_PREFLIGHT=true` only for emergency troubleshooting when another layer already guarantees database readiness.
- `npm run email:verify -- --smoke` runs an application-level smoke flow against the configured database. It creates a temporary email account, contact record, knowledge article, inbound email, AI-assisted outbound draft, and small attachment, then sends through dry-run delivery inside the script process and cleans up the temporary data by default. Add `-- --keep-smoke-data` only when you intentionally want to inspect the generated smoke records.
- `npm test` includes an email CRM smoke flow that links a customer record, inbound email history, knowledge context, AI drafting, source references, attachment handling, dry-run send, and audit metadata. This does not replace a real mailbox test, but it keeps the core application path covered when Docker or a browser is unavailable.
- Browser E2E uses the production `next start` server through `scripts/e2e-next-start.mjs`. Run `npm run build` first and ensure Postgres is reachable at the `DATABASE_URL` host and port. The compose file exposes Postgres on `127.0.0.1:54329`, matching `.env.local` and `.env.example`; if that port changes, update compose and `DATABASE_URL` together.
- Browser E2E server scripts run a PostgreSQL TCP preflight before starting Next. Use `E2E_SKIP_DATABASE_PREFLIGHT=true` only when another test fixture already guarantees database readiness.

This keeps scheduling, queue transport, and provider-specific mailbox code separated.

Failed outbound sends keep the provider error on `EmailMessage.failureReason`. Requeueing or successful delivery clears that message-level reason, while mailbox-level connection errors remain on `EmailAccount.lastConnectionError` for account diagnostics. Connection failures and recoveries also write `email_account` audit log entries, but repeated identical failures are not logged again.

Outbound sends can include an optional `clientRequestId` on `POST /api/email/send`. The value is scoped to workspace, mailbox account, and user, then stored on `EmailMessage`; retrying the same request id returns the existing outbound message instead of creating another queued email. Use a stable id per compose/send attempt, not a new random value for every retry.

Queued outbound sends are atomically claimed as `sending` before provider delivery. `sendAttemptedAt` records the claim time, and `EMAIL_SEND_CLAIM_TIMEOUT_MS` controls when a stale `sending` claim can be reclaimed after a crashed worker; it defaults to 900000 ms and is clamped to at least 60000 ms.

Provider sync is idempotent per mailbox account. Imported messages are deduplicated by `workspaceId + accountId + externalMessageId`, so running IMAP, Gmail, or Outlook sync repeatedly does not duplicate timeline entries or expand future AI context with repeated message bodies. The same external message id may still appear in another mailbox account.

## AI Toggles

Email AI features are controlled independently:

- `draft`: AI can draft replies.
- `translate`: AI can translate email content from compose text or a selected thread message.
- `auto_translate`: CRM can automatically translate inbound messages and cache the translated text when `translate` is also enabled.
- `context_analysis`: AI can analyze compose text or a selected thread message and suggest next steps.
- `auto_context_analysis`: CRM can automatically refresh a thread-level analysis and next-action suggestion when `context_analysis` is also enabled.
- `auto_summarize`: CRM can summarize email threads to reduce future prompt size.

When a feature is disabled, the assistant context builder returns `enabled=false` and instructs the caller not to generate that output.
The compose UI uses the same purpose-to-feature mapping as the assistant context builder, so disabled AI actions are blocked before the request and still rechecked server-side.
Automatic AI jobs also require the acting context to have `ai.use`. This prevents a write-only CRM user from recording an email and triggering AI translation or AI summarization as a side effect.
Server-side AI jobs still write skipped `email_ai_generation` audit entries when a feature is disabled; they do not call the model provider and do not write generated text back to email messages or threads.
When `requireSourceLinks=true`, generation is also blocked until the request has at least one CRM record, email message, activity, or active knowledge article source.
Missing feature keys in existing workspace settings are normalized to safe defaults; new AI automations such as `auto_translate` default to off.

## AI Provider

`POST /api/email/ai-generate` uses the same OpenAI-compatible environment variables as the record AI assistant:

- `AI_PROVIDER=openai-compatible`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`
- `AI_TIMEOUT_MS`

When no API key is configured, or the provider fails, the endpoint returns a local bounded fallback. Results expose `generationMode` as `provider`, `provider_fallback`, `local`, `queued`, or `disabled`; provider failures also include a bounded `providerError` summary. The model prompt is assembled from the linked customer record, recent communication summary, recent messages, CRM activities, and active knowledge articles. Feature toggles are enforced before any model call. Generated email AI output is also bounded before it can be returned, persisted as translation/summary/analysis, or recorded in audit metadata; results expose `budget.outputTruncated` when the generated body or suggested subject had to be clipped.

The email workspace can run AI against compose text or against an individual message in the selected thread:

- Draft generation returns a clean customer-facing body plus an optional `suggestedSubject`; source references remain in the structured `sources` array and are not appended to the email body.
- Message `Translate` sends the message body as `sourceText` with `sourceMessageId`, the thread, and linked CRM record context, then stores the translated text and `translatedSources` on `EmailMessage`.
- Message `Analyze` sends the message body as `sourceText` with `sourceMessageId` and asks for context analysis plus the next sales action.
- Thread `Analyze` stores the generated analysis on `EmailThread.aiAnalysis` with `aiAnalysisUpdatedAt` and `aiAnalysisSources`; it is a recommendation cache only and does not update deals, contacts, tasks, amounts, or stages.
- Both actions keep source references to CRM records, email messages, activities, or knowledge articles when `requireSourceLinks=true`.

When `sourceMessageId` is supplied without an explicit `threadId`, the context builder resolves the message's thread and linked CRM record before building the prompt. This keeps message-level AI entry points aligned with customer background, communication history, and knowledge articles. Draft and summarize requests can use `sourceMessageId` as their only CRM context input. The resolved record, thread, and source message identifiers are returned in AI results so generation audit entries and AI-assisted outbound drafts preserve the inferred provenance.

AI generation writes `email_ai_generation` audit entries with purpose, enabled/skipped status, generation mode, bounded provider error summary, source counts, source labels, related record/thread/message ids, context budget, context/output truncation status, and text lengths. The audit log intentionally does not store generated email bodies, user prompts, or source text. Email diagnostics also surfaces recent `automationFailed=true` AI audit entries and recent `generationMode=provider_fallback` entries so admins can see when automatic translation/summarization fails or when the remote model provider is unavailable without blocking email intake.

## Context Sources

AI email context is built from:

- linked customer CRM record and configured fields;
- CRM activity history;
- email thread summary and recent messages;
- active knowledge articles.

The builder caps message count, knowledge article count, and total context size. When `auto_summarize` is enabled and a thread has `summaryUpdatedAt`, the prompt uses the compact thread summary plus only messages newer than that timestamp. Older message bodies are intentionally omitted from the prompt and source list so token use stays bounded.

Only active knowledge articles are included in AI email context. Articles are soft-disabled instead of hard-deleted so previous AI source references and audit history remain explainable.

## CRM Record Linking

Email threads can be linked explicitly by passing `recordId` when recording, sending, or composing a message. When no explicit record is provided and the thread has no existing record link, CRM automatically tries to match participant emails against `contacts.data.email`, excluding the mailbox account's own address.

This makes synced inbound mail immediately available in the linked contact's activity timeline and gives the email AI assistant customer background without manual linking. Explicit `recordId` and existing thread links always take precedence over automatic matching.

## Thread Matching

When a message is recorded without an explicit `threadId`, CRM tries to attach it to a recent thread on the same mailbox account before creating a new thread. Matching is conservative:

- Subject prefixes such as `Re:`, `Fwd:`, and `Fw:` are ignored for comparison.
- The normalized subject must match.
- The message must either share the same linked CRM record or overlap with an existing participant email.

This keeps synced replies in the same communication history while avoiding subject-only merges across unrelated customers.

Outbound SMTP and Gmail messages include standard threading headers when sent from an existing CRM email thread:

- `Message-ID` is generated from the CRM message id.
- `In-Reply-To` points to the latest external message id in the thread.
- `References` includes recent external message ids from the CRM thread.

Outlook sends the same values through Microsoft Graph `internetMessageHeaders` when available.

After successful delivery, CRM stores an outbound `externalMessageId` for future threading:

- Gmail stores the generated RFC822 `Message-ID`; Gmail API resource ids are not used for `References`.
- SMTP stores the generated RFC822 `Message-ID`.
- Outlook stores the generated `Message-ID` sent through Graph internet headers.

This lets future replies reference prior outbound CRM emails, not only inbound provider messages.
For Gmail sync, inbound `externalMessageId` also prefers the RFC822 `Message-ID` header and only falls back to the Gmail API message id when the header is missing.

## Reply Composition

The email workspace supports replying from a message in the selected thread:

- Inbound messages prefill the sender and copied external participants as recipients.
- Outbound messages reuse the original external recipients.
- The mailbox account's own address is excluded from reply recipients.
- Subjects are prefixed with `Re:` unless they already start with a reply prefix.
- The current thread remains selected, so the reply is stored back into the same communication history.

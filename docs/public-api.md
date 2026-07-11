# Public API Notes

The CRM exposes REST endpoints for browser sessions and Bearer API keys. API key calls are scoped to the permissions assigned when the key is created, and validation errors from authenticated API key calls are written to audit logs with `authType=api_key`.

## Pagination

List endpoints accept `page` and `pageSize` query parameters.

- `page` must be a positive integer. Invalid values fall back to page `1`.
- Record list endpoints cap `pageSize` at `200` and default to `50`.
- Audit log list endpoints cap API `pageSize` at `200` and default to `200`.
- CSV export paths use server-side limits and do not accept unlimited result sets.

This keeps public REST calls predictable and prevents accidental oversized database reads.

## Payload Limits

JSON API requests are limited to `5 MB` by default, and form requests are limited to `256 KB`.

CSV import payloads and metadata-heavy configuration endpoints also enforce structural limits:

- CSV import text is limited to `5,000,000` characters.
- CSV header mappings are limited to `200` fields.
- Saved views are limited to `100` columns and `50` filters.
- Pipeline definitions are limited to `50` stages.
- Select field options are limited to `200` choices.

Large imports should be split into smaller files so validation errors stay readable and retries remain cheap.

## CRM Tags

CRM records and tasks support free-form `tags`.

- Record create/update payloads accept `tags?: string[]` for contacts, companies, deals, products, quotes, and other CRM objects.
- Activity create/update payloads accept `tags?: string[]`; the product UI currently exposes this for tasks.
- Tags are normalized by trimming whitespace, lowercasing, removing empty values, and de-duplicating. A payload may include at most `50` unique tags, and each tag may contain at most `40` characters.
- Record list `q` search matches record title, record data, and tags.
- Record list filters can use `field: "tags"` with `operator: "equals"` for exact tag membership or `operator: "contains"` for substring matching within any tag.
- Record and activity list endpoints accept a `tags` query parameter. Pass comma- or semicolon-separated values, for example `?tags=vip;renewal`; all listed tags must be present.
- CSV record export includes a `tags` column joined with `; `. CSV import and templates recognize the same `tags` column.
- Contact, company, and deal tag changes follow the existing record-change approval flow. Other objects save tag changes directly according to their normal permissions.

## Email And AI Mail

Email endpoints follow the same workspace, RBAC, and audit rules as the rest of the CRM API. Browser sessions and Bearer API keys can call these endpoints when the credential has the required permission.

- Mailbox administration requires `crm.admin`.
- Sending and recording email requires `crm.write` plus visibility to the linked CRM record when one is supplied.
- Reading threads and messages follows CRM record visibility; unlinked threads are visible only within the same workspace.
- AI mail actions require `ai.use` and the corresponding workspace feature toggle.
- Provider credentials are encrypted at rest and never returned by API responses.

Mailbox and provider operations:

- `GET/POST /api/email/accounts`: list or create mailbox accounts.
- `GET/PATCH/DELETE /api/email/accounts/:id`: read, update, or safely disable mailbox accounts.
- `POST /api/email/oauth/start`: create a signed Gmail or Outlook authorization URL.
- `GET /api/email/oauth/callback`: complete OAuth and connect or rotate the mailbox account.
- `POST /api/email/test-connection`: test one configured mailbox.
- `POST /api/email/test-connections`: test all active configured mailboxes.
- `GET /api/email/diagnostics`: return admin-only diagnostics for secrets, OAuth, AI, queue, sync scheduler, and accounts.

Mail flow:

- `GET /api/email/threads`: list visible threads, optionally filtered by `recordId`.
- `GET/PATCH /api/email/threads/:id`: read or relink a visible thread to another visible CRM record.
- `GET /api/email/threads/:id/messages`: list messages in a visible thread.
- `POST /api/email/messages`: record an inbound or manually logged email message.
- `GET /api/email/messages/:id`: read a visible message.
- `GET /api/email/messages/:id/attachments/:index`: download stored or provider-backed attachment content.
- `POST /api/email/send`: queue or send an outbound email through the configured provider adapter. Include a stable optional `clientRequestId` per compose/send attempt so client retries return the same outbound message instead of creating a duplicate queued email.
- `POST /api/email/messages/:id/retry`: requeue a failed outbound message or recover a stale `sending` message through the same send path.
- `POST /api/email/sync`: sync one mailbox account, with optional bounded `limit` from 1 to 100 messages.
- `POST /api/email/sync-all`: schedule sync for all active `syncEnabled` mailbox accounts, with optional bounded `limit` from 1 to 100 messages per account.

AI mail and knowledge:

- `GET/PATCH /api/email/ai-settings`: read or update workspace AI mail feature toggles and context limits.
- `POST /api/email/ai-context`: build bounded, source-backed CRM, thread, message, activity, and knowledge context.
- `POST /api/email/ai-generate`: generate a draft, translation, context analysis, or compact summary without directly changing contacts, companies, deals, amounts, or stages.
- `POST /api/email/messages/:id/translate`: translate one visible message and persist the translated cache with source references; accepts optional `targetLocale`, otherwise uses workspace default.
- `POST /api/email/threads/:id/analyze`: refresh read-only thread analysis and next-action guidance.
- `POST /api/email/threads/:id/summarize`: refresh compact thread memory to reduce future prompt size.
- `GET/POST /api/knowledge/articles`: list or create knowledge articles used by AI mail context.
- `GET/PATCH/DELETE /api/knowledge/articles/:id`: read, update, or soft-disable knowledge articles.

AI output is source-backed when `requireSourceLinks=true`. AI generation responses include `generationMode` so clients can distinguish provider output, local fallback, provider fallback, queued jobs, and disabled features. Audit logs keep purpose, generation mode, bounded provider error summaries, source counts, related record/thread/message ids, context budget, context/output truncation flags, and text lengths, but they do not store prompts, source text, or generated email bodies.

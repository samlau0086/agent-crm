# Email And AI Assistant

This phase adds the internal platform layer for CRM email features. It does not hard-code Gmail, Outlook, SMTP, or IMAP behavior into CRM records.

## Core Model

- `EmailAccount`: workspace-scoped mailbox configuration with provider type, send toggle, sync toggle, and status.
- `EmailThread`: customer conversation thread that can link back to a CRM record.
- `EmailMessage`: inbound, outbound, draft, queued, sent, or failed email message.
- `KnowledgeArticle`: system knowledge used by AI email features.
- `EmailAiSettings`: workspace-level feature toggles and context limits.

Provider-specific sync and send implementations should be added behind adapters that read and write this model.

## REST Interfaces

- `GET/POST /api/email/accounts`: manage workspace mailbox configurations.
- `GET /api/email/threads?recordId=...`: list email threads, optionally scoped to a CRM record.
- `GET /api/email/threads/:id/messages`: list messages in a thread.
- `POST /api/email/messages`: record an inbound/outbound message and optionally link it to a CRM record.
- `GET/PATCH /api/email/ai-settings`: read or update per-workspace AI feature toggles and context limits.
- `POST /api/email/ai-context`: build bounded, source-backed context for drafting, translation, analysis, or thread summarization.
- `GET/POST /api/knowledge/articles`: manage active knowledge used by AI email features.

The current API records messages and thread state. Real sending, receiving, OAuth, SMTP, IMAP, Gmail, and Outlook connectors should be implemented as provider adapters that call these repository methods instead of writing directly to CRM records.

## AI Toggles

Email AI features are controlled independently:

- `draft`: AI can draft replies.
- `translate`: AI can translate email content.
- `context_analysis`: AI can analyze context and suggest next steps.
- `auto_summarize`: CRM can summarize email threads to reduce future prompt size.

When a feature is disabled, the assistant context builder returns `enabled=false` and instructs the caller not to generate that output.

## Context Sources

AI email context is built from:

- linked customer CRM record and configured fields;
- CRM activity history;
- email thread summary and recent messages;
- active knowledge articles.

The builder caps message count, knowledge article count, and total context size. Thread summaries are intended to replace long email history in future prompts so token use stays bounded.

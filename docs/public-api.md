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

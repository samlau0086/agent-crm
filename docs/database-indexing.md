# Database Indexing Strategy

This CRM keeps standard columns for stable access patterns and JSONB for extensible custom fields. Indexes should follow that split:

- B-tree indexes cover workspace scoping, object scoping, ownership, stages, timelines, saved views, and audit filters.
- GIN indexes cover JSONB containment and future metadata dependency checks.
- High-volume custom fields should get explicit generated columns or expression indexes once they become operationally important.

## Current Index Groups

- Records: `workspaceId + objectKey + updatedAt`, `ownerId`, and `stageKey` support list views, RBAC ownership checks, pipeline guards, and record validation scans.
- Activities: `recordId + createdAt`, task fields, and actor fields support timelines, task lists, and ownership checks.
- Metadata: object, field, relation, pipeline, and saved-view indexes support admin screens and destructive-change guards.
- Audit logs: created time, entity, object, actor, and action indexes support admin review and incident lookup.
- JSONB: record data, pipeline stages, saved-view filters/sorts, and audit details have GIN indexes for containment lookups.

## Custom Field Scaling

Generic JSONB indexing is broad but not enough for every high-volume custom field. When a field becomes a frequent filter/sort key, prefer one of these:

1. Add a generated column for the field and index it.
2. Add a PostgreSQL expression index, for example on `("data"->>'tier')`.
3. Promote the field into a standard column only if it has become core CRM behavior.

Keep these as explicit migrations. Do not silently add indexes from admin field creation until there is a usage signal or an admin-controlled indexing workflow.

## Migration Notes

The `20260618_query_governance_indexes` migration includes a partial unique index enforcing one default pipeline per workspace/object. If an existing deployment has duplicate default pipelines, clean them before applying the migration.

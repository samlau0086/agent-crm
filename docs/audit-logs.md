# Audit logs

Critical write operations create audit entries for production traceability:

- Records: create, update, delete.
- Activities and tasks: create, update, complete, reopen.
- Admin configuration: object definitions, fields, relations, pipelines, and saved views.

Admins can read recent audit entries with:

```http
GET /api/audit-logs
```

Non-admin users receive `403`.

For a clean deployment, apply `prisma/migrations/20260618_audit_logs/migration.sql` through `npm run db:migrate`. For an existing local development database that was created with `db:push` and has no Prisma migration baseline, run `npm run db:push` to sync the schema.

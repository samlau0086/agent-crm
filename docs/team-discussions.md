# Team discussions

Team discussions are available on every CRM record (including custom objects), activity/task, and email thread. They inherit the target's CRM permissions and support replies, mentions, unread state, images, files, and 10-second incremental polling.

## VPS file storage

Attachments are stored directly on the VPS in a private persistent directory. Configure the web service with:

- `MEDIA_STORAGE_DIR=/app/media-uploads`
- `DISCUSSION_STORAGE_DIR=/app/discussion-uploads`（仅用于读取迁移前的旧讨论附件）

Docker Compose mounts the unified media directory from `${CRM_DATA_DIR}/media-uploads` (normally `/opt/ai-agent-crm/media-uploads`) so files survive container replacement and application upgrades. Include it in the same recovery point as the PostgreSQL backup. Never expose it as a public static directory; authenticated downloads go through `/api/media-assets/[id]/content`.

After deploying the schema migration, run `npm run media:migrate-vps` once. The command is idempotent: it moves Base64 `MediaAsset` data and legacy discussion files into the unified VPS directory while retaining failed rows for a later retry.

Each file is limited to 20 MB. A message can contain at most 10 files and 50 MB total. Executable, script, HTML, and SVG files are rejected.

## API

- `GET|POST /api/discussions/messages`
- `PATCH|DELETE /api/discussions/messages/[id]`
- `POST /api/discussions/attachments`
- `GET /api/discussions/attachments/[id]`
- `POST /api/discussions/read`
- `POST /api/discussions/unread`
- `GET|PATCH /api/discussion-notifications`

Reading requires `crm.read`; posting, editing, deleting, and uploading require `crm.write`. Administrators can moderate messages written by other users.

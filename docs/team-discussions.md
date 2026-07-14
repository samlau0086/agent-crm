# Team discussions

Team discussions are available on every CRM record (including custom objects), activity/task, and email thread. They inherit the target's CRM permissions and support replies, mentions, unread state, images, files, and 10-second incremental polling.

## VPS file storage

Attachments are stored directly on the VPS in a private persistent directory. Configure the web service with:

- `DISCUSSION_STORAGE_DIR=/app/discussion-uploads`

Docker Compose mounts this directory from `${CRM_DATA_DIR}/discussion-uploads` (normally `/opt/ai-agent-crm/discussion-uploads`) so files survive container replacement and application upgrades. The directory must be included in VPS backups. It must not be exposed as a public static directory; authenticated downloads go through `/api/discussions/attachments/[id]`.

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

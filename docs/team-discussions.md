# Team discussions

Team discussions are available on every CRM record (including custom objects), activity/task, and email thread. They inherit the target's CRM permissions and support replies, mentions, unread state, images, files, and 10-second incremental polling.

## Object storage

Attachments are private S3-compatible objects. Configure these variables for the web service:

- `DISCUSSION_STORAGE_ENDPOINT`
- `DISCUSSION_STORAGE_REGION`
- `DISCUSSION_STORAGE_BUCKET`
- `DISCUSSION_STORAGE_ACCESS_KEY`
- `DISCUSSION_STORAGE_SECRET_KEY`
- `DISCUSSION_STORAGE_FORCE_PATH_STYLE`

The bucket must already exist. The CRM needs permission to put, get, and delete objects in the bucket. Browsers never receive object-storage credentials or direct public object URLs; authenticated downloads go through `/api/discussions/attachments/[id]`.

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

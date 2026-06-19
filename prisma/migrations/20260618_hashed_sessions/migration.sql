-- Store only SHA-256 session token hashes in the database.
-- Existing plaintext UUID tokens are converted in place; already-hashed
-- 64-character hex tokens are left unchanged.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "Session"
SET "token" = encode(digest("token", 'sha256'), 'hex')
WHERE "token" !~ '^[0-9a-f]{64}$';

CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

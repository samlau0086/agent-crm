ALTER TABLE "EmailAccount"
  ADD COLUMN "encryptedConnectionConfig" TEXT,
  ADD COLUMN "lastConnectionError" TEXT;

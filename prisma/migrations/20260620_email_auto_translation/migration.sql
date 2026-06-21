ALTER TABLE "EmailMessage"
  ADD COLUMN "translatedBodyText" TEXT,
  ADD COLUMN "translatedLocale" TEXT,
  ADD COLUMN "translatedAt" TIMESTAMP(3);

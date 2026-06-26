-- Performance phase one: make high-cardinality CRM record paths index-friendly.
-- Contacts and companies are expected to grow first, so standard searchable fields
-- get expression indexes while custom fields continue to work through JSONB.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "CrmRecord_contacts_email_eq_idx"
  ON "CrmRecord" ("workspaceId", lower("data"->>'email'))
  WHERE "objectKey" = 'contacts';

CREATE INDEX IF NOT EXISTS "CrmRecord_contacts_phone_eq_idx"
  ON "CrmRecord" ("workspaceId", lower("data"->>'phone'))
  WHERE "objectKey" = 'contacts';

CREATE INDEX IF NOT EXISTS "CrmRecord_contacts_company_id_idx"
  ON "CrmRecord" ("workspaceId", ("data"->>'companyId'))
  WHERE "objectKey" = 'contacts';

CREATE INDEX IF NOT EXISTS "CrmRecord_companies_domain_eq_idx"
  ON "CrmRecord" ("workspaceId", lower("data"->>'domain'))
  WHERE "objectKey" = 'companies';

CREATE INDEX IF NOT EXISTS "CrmRecord_title_trgm_idx"
  ON "CrmRecord" USING gin (lower("title") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "CrmRecord_contacts_email_trgm_idx"
  ON "CrmRecord" USING gin (lower("data"->>'email') gin_trgm_ops)
  WHERE "objectKey" = 'contacts';

CREATE INDEX IF NOT EXISTS "CrmRecord_contacts_phone_trgm_idx"
  ON "CrmRecord" USING gin (lower("data"->>'phone') gin_trgm_ops)
  WHERE "objectKey" = 'contacts';

CREATE INDEX IF NOT EXISTS "CrmRecord_contacts_methods_trgm_idx"
  ON "CrmRecord" USING gin (lower("data"->>'contactMethods') gin_trgm_ops)
  WHERE "objectKey" = 'contacts';

CREATE INDEX IF NOT EXISTS "CrmRecord_companies_domain_trgm_idx"
  ON "CrmRecord" USING gin (lower("data"->>'domain') gin_trgm_ops)
  WHERE "objectKey" = 'companies';

CREATE INDEX IF NOT EXISTS "CrmRecord_companies_industry_trgm_idx"
  ON "CrmRecord" USING gin (lower("data"->>'industry') gin_trgm_ops)
  WHERE "objectKey" = 'companies';

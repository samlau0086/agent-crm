UPDATE "Role"
SET "permissions" = "permissions" || ARRAY['ai.use']::text[]
WHERE 'crm.admin' = ANY("permissions")
  AND NOT ('ai.use' = ANY("permissions"));

UPDATE "Role"
SET "permissions" = "permissions" || ARRAY['ai.admin']::text[]
WHERE 'crm.admin' = ANY("permissions")
  AND NOT ('ai.admin' = ANY("permissions"));

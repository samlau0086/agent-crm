-- Company records are now the authoritative source for formal customer level.
-- Contacts keep only a temporary level when they are not linked to a company.

INSERT INTO "FieldDefinition" ("id", "workspaceId", "objectDefinitionId", "key", "label", "type", "required", "unique", "options", "isSystem", "position")
SELECT 'field-' || object_definition."key" || '-temp-customer-level-' || object_definition."workspaceId",
       object_definition."workspaceId",
       object_definition."id",
       'contactTempCustomerLevel',
       '临时客户等级',
       'select',
       false,
       false,
       '[{"label":"A 级客户","value":"A"},{"label":"B 级客户","value":"B"},{"label":"C 级客户","value":"C"},{"label":"D 级客户","value":"D"}]'::jsonb,
       true,
       11
FROM "ObjectDefinition" object_definition
WHERE object_definition."key" = 'contacts'
ON CONFLICT ("objectDefinitionId", "key") DO NOTHING;

UPDATE "CrmRecord"
SET "data" =
  CASE
    WHEN COALESCE("data"->>'companyId', '') = ''
      THEN jsonb_strip_nulls(
        ("data" - 'customerLevelSuggested' - 'customerLevelScore' - 'customerLevelReasons' - 'customerLevelSuggestedAt' - 'customerLevel')
        || CASE
             WHEN "data"->>'customerLevel' IN ('A', 'B', 'C', 'D')
               THEN jsonb_build_object('contactTempCustomerLevel', "data"->>'customerLevel')
             ELSE '{}'::jsonb
           END
      )
    ELSE "data" - 'customerLevel' - 'customerLevelSuggested' - 'customerLevelScore' - 'customerLevelReasons' - 'customerLevelSuggestedAt' - 'contactTempCustomerLevel'
  END
WHERE "objectKey" = 'contacts';

DELETE FROM "FieldDefinition"
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'contacts')
  AND "key" IN ('customerLevel', 'customerLevelSuggested', 'customerLevelScore', 'customerLevelReasons', 'customerLevelSuggestedAt');

UPDATE "SavedView"
SET "columns" = ARRAY(
  SELECT normalized.column_name
  FROM (
    SELECT CASE WHEN source.column_name = 'customerLevel' THEN 'contactTempCustomerLevel' ELSE source.column_name END AS column_name,
           MIN(source.ordinality) AS first_position
    FROM unnest("columns") WITH ORDINALITY AS source(column_name, ordinality)
    WHERE source.column_name NOT IN ('customerLevelSuggested', 'customerLevelScore', 'customerLevelReasons', 'customerLevelSuggestedAt')
    GROUP BY CASE WHEN source.column_name = 'customerLevel' THEN 'contactTempCustomerLevel' ELSE source.column_name END
  ) normalized
  ORDER BY normalized.first_position
)
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'contacts');

UPDATE "SavedView"
SET "sort" = NULL
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'contacts')
  AND "sort"->>'field' IN ('customerLevel', 'customerLevelSuggested', 'customerLevelScore', 'customerLevelReasons', 'customerLevelSuggestedAt');

UPDATE "SavedView"
SET "filters" = COALESCE(
  (
    SELECT jsonb_agg(filter_item)
    FROM jsonb_array_elements(COALESCE("filters", '[]'::jsonb)) AS filter_item
    WHERE filter_item->>'field' NOT IN ('customerLevel', 'customerLevelSuggested', 'customerLevelScore', 'customerLevelReasons', 'customerLevelSuggestedAt')
  ),
  '[]'::jsonb
)
WHERE "objectDefinitionId" IN (SELECT "id" FROM "ObjectDefinition" WHERE "key" = 'contacts');

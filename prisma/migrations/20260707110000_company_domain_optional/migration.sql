UPDATE "FieldDefinition" field_definition
SET "required" = false
FROM "ObjectDefinition" object_definition
WHERE field_definition."objectDefinitionId" = object_definition."id"
  AND object_definition."key" = 'companies'
  AND field_definition."key" = 'domain';

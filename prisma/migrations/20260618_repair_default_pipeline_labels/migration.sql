-- Repair default sales stage labels that were corrupted by a previous
-- Windows console encoding pass. The update preserves custom stage fields.
UPDATE "Pipeline"
SET "stages" = (
  SELECT jsonb_agg(
    CASE stage ->> 'key'
      WHEN 'new' THEN jsonb_set(stage, '{label}', to_jsonb('新机会'::text), false)
      WHEN 'qualified' THEN jsonb_set(stage, '{label}', to_jsonb('已确认'::text), false)
      WHEN 'proposal' THEN jsonb_set(stage, '{label}', to_jsonb('方案报价'::text), false)
      WHEN 'negotiation' THEN jsonb_set(stage, '{label}', to_jsonb('商务谈判'::text), false)
      WHEN 'won' THEN jsonb_set(stage, '{label}', to_jsonb('赢单'::text), false)
      ELSE stage
    END
    ORDER BY COALESCE((stage ->> 'position')::int, 0)
  )
  FROM jsonb_array_elements("Pipeline"."stages") AS stage
)
WHERE "objectKey" = 'deals';

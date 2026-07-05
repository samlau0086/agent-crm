ALTER TABLE "CrmPoolSettings"
  ADD COLUMN "levelRules" JSONB NOT NULL DEFAULT '[
    {"level":"A","enabled":true,"privateLimit":20,"autoReclaimDays":60},
    {"level":"B","enabled":true,"privateLimit":40,"autoReclaimDays":45},
    {"level":"C","enabled":true,"privateLimit":80,"autoReclaimDays":30},
    {"level":"D","enabled":true,"privateLimit":100,"autoReclaimDays":14},
    {"level":"unrated","enabled":true,"privateLimit":100,"autoReclaimDays":21}
  ]'::jsonb;

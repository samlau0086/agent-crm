ALTER TABLE "WorkflowDefinition"
  ADD COLUMN "graph" JSONB;

ALTER TABLE "WorkflowRun"
  ADD COLUMN "nodeResults" JSONB;

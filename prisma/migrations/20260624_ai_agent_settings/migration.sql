ALTER TABLE "EmailAiSettings"
ADD COLUMN IF NOT EXISTS "agents" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "EmailAiSettings"
SET "agents" = jsonb_build_array(
  jsonb_build_object(
    'key', 'inbound_email_preprocess',
    'name', 'Inbound Email Preprocess Agent',
    'scenario', 'email',
    'enabled', true,
    'model', 'gpt-4.1-mini',
    'agentMarkdown', '# Inbound Email Preprocess Agent

You preprocess newly received customer emails for a private sales CRM.
Use customer background, communication history, and the system knowledge base.
Produce concise, source-grounded summaries and next-context signals.
Do not modify CRM records, deal stages, amounts, contacts, tasks, or mailbox state.
Prefer compact memory that reduces future prompt tokens.',
    'maxOutputChars', 4000
  )
)
WHERE "agents" = '[]'::jsonb;

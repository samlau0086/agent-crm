import { normalizeAiProviderConfig } from "@/lib/ai/provider-config";
import type {
  AiProviderConfig,
  EmailAiSettings,
  WorkflowAiGenerationRequest,
  WorkflowAiGenerationResult,
  WorkflowDefinition,
  WorkflowGraph
} from "@/lib/crm/types";
import { getAiAgentSetting, workflowDesignerAgentKey } from "@/lib/email/assistant";
import { buildWorkflowDraftFromGoal, graphToLegacyWorkflow, normalizeWorkflowGraph } from "@/lib/workflows/core";

type AiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface WorkflowDesignerModelResponse {
  name?: unknown;
  description?: unknown;
  goal?: unknown;
  trigger?: unknown;
  graph?: unknown;
  explanation?: {
    triggerReason?: unknown;
    expectedOutcome?: unknown;
    risks?: unknown;
  };
}

export async function generateWorkflowWithAiDesigner(
  input: WorkflowAiGenerationRequest,
  options: {
    settings: EmailAiSettings;
    providerConfig: Partial<AiProviderConfig>;
    fetchImpl?: AiFetch;
  }
): Promise<WorkflowAiGenerationResult> {
  const fallback = buildWorkflowDraftFromGoal(input);
  const agent = getAiAgentSetting(options.settings, workflowDesignerAgentKey);
  const providerConfig = normalizeAiProviderConfig({
    ...options.providerConfig,
    model: agent?.model || options.providerConfig.model
  });
  if (!agent?.enabled || !providerConfig.apiKey) {
    return fallback;
  }

  try {
    const modelResult = await requestWorkflowDesign(input, fallback, {
      agentMarkdown: agent.agentMarkdown,
      maxOutputChars: agent.maxOutputChars,
      providerConfig,
      fetchImpl: options.fetchImpl ?? fetch
    });
    return modelResult ?? fallback;
  } catch {
    return fallback;
  }
}

async function requestWorkflowDesign(
  input: WorkflowAiGenerationRequest,
  fallback: WorkflowAiGenerationResult,
  options: {
    agentMarkdown?: string;
    maxOutputChars?: number;
    providerConfig: AiProviderConfig;
    fetchImpl: AiFetch;
  }
): Promise<WorkflowAiGenerationResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.providerConfig.timeoutMs);
  const fallbackGraph = fallback.workflow.graph ?? normalizeWorkflowGraph(undefined, fallback.workflow);
  try {
    const response = await options.fetchImpl(`${trimTrailingSlash(options.providerConfig.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.providerConfig.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: options.providerConfig.model,
        temperature: 0.1,
        max_tokens: Math.min(Math.max(options.maxOutputChars ?? 6000, 1000), 12000),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildWorkflowDesignerSystemPrompt(options.agentMarkdown) },
          { role: "user", content: buildWorkflowDesignerUserPrompt(input, fallbackGraph) }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Workflow designer returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }
    return parseWorkflowDesignerResponse(content, input, fallback);
  } finally {
    clearTimeout(timeout);
  }
}

function parseWorkflowDesignerResponse(content: string, input: WorkflowAiGenerationRequest, fallback: WorkflowAiGenerationResult): WorkflowAiGenerationResult | null {
  const parsed = parseJsonObject(content) as WorkflowDesignerModelResponse | null;
  if (!parsed || !parsed.graph) {
    return null;
  }
  const fallbackTrigger = isRecord(parsed.trigger) ? normalizeTrigger(parsed.trigger, fallback.workflow.trigger) : fallback.workflow.trigger;
  const graph = normalizeWorkflowGraph(parsed.graph, {
    trigger: fallbackTrigger,
    conditions: fallback.workflow.conditions,
    actions: fallback.workflow.actions
  });
  const graphWithScope = enforceRequestedScope(graph, input);
  const legacy = graphToLegacyWorkflow(graphWithScope);
  const workflow: Omit<WorkflowDefinition, "id" | "workspaceId" | "createdById" | "createdAt" | "updatedAt"> = {
    name: stringValue(parsed.name, fallback.workflow.name),
    description: stringValue(parsed.description, fallback.workflow.description),
    goal: stringValue(parsed.goal, input.goal),
    status: "draft",
    trigger: legacy.trigger,
    conditions: legacy.conditions,
    actions: legacy.actions,
    graph: graphWithScope,
    version: 1
  };
  return {
    workflow,
    explanation: {
      goal: workflow.goal,
      triggerReason: stringValue(parsed.explanation?.triggerReason, fallback.explanation.triggerReason),
      expectedOutcome: stringValue(parsed.explanation?.expectedOutcome, fallback.explanation.expectedOutcome),
      risks: Array.isArray(parsed.explanation?.risks)
        ? parsed.explanation.risks.filter((risk): risk is string => typeof risk === "string" && risk.trim().length > 0)
        : fallback.explanation.risks
    }
  };
}

function buildWorkflowDesignerSystemPrompt(agentMarkdown?: string): string {
  return [
    agentMarkdown || "# Workflow Designer Agent",
    "",
    "You design executable graph workflows for a private sales CRM. Return JSON only.",
    "Do not use fixed templates blindly. Infer the user's real automation goal, then compose the graph from supported nodes and edges.",
    "",
    "Supported node types and output handles:",
    "- start: outputs main. Scope is record/object/global.",
    "- if: outputs true and false. Use for binary conditions.",
    "- switch: outputs case:<value> and default.",
    "- loop: outputs continue and break. Use only for bounded iteration over a collection; include maxIterations.",
    "- wait_delay: outputs after_delay. Use for time delays before the next check.",
    "- wait_reply: outputs replied and not_replied. Use for email reply checks.",
    "- ai_agent: outputs done, needs_review, failed. Use for reasoning, selecting tools, or human-reviewed plans.",
    "- create_email_draft: outputs main. Creates an email draft, not a direct send.",
    "- send_email: outputs main. High risk; requires approval unless explicitly safe.",
    "- create_task: outputs main.",
    "- update_deal: outputs main. High risk; requires approval.",
    "- notify: outputs main.",
    "- end: no outputs.",
    "",
    "Safety rules:",
    "- Generated workflows must be draft.",
    "- Prefer create_email_draft over send_email for outreach unless the user explicitly requests automatic sending.",
    "- For 'until reply' goals, include wait_reply branches: replied path should handle/stop, not_replied path should continue follow-up or review.",
    "- Do not create duplicate IF nodes with empty recordId. Only use recordId equals when an actual recordId is provided.",
    "- Avoid infinite loops; every loop must have a break path and maxIterations.",
    "",
    "Return shape:",
    "{\"name\":\"...\",\"description\":\"...\",\"goal\":\"...\",\"trigger\":{...},\"graph\":{\"scope\":{...},\"nodes\":[...],\"edges\":[...]},\"explanation\":{\"triggerReason\":\"...\",\"expectedOutcome\":\"...\",\"risks\":[\"...\"]}}"
  ].join("\n");
}

function buildWorkflowDesignerUserPrompt(input: WorkflowAiGenerationRequest, fallbackGraph: WorkflowGraph): string {
  return JSON.stringify({
    userGoal: input.goal,
    target: {
      objectKey: input.objectKey,
      recordId: input.recordId,
      recordTitle: input.recordTitle,
      audience: input.audience,
      constraints: input.constraints
    },
    fallbackGraphExample: fallbackGraph,
    requiredScope: input.recordId
      ? { mode: "record", objectKey: input.objectKey, recordId: input.recordId, recordTitle: input.recordTitle }
      : input.objectKey
        ? { mode: "object", objectKey: input.objectKey }
        : { mode: "global" },
    instruction: "Design a workflow graph that best satisfies the user goal. The graph may differ from the fallback example when the goal requires a different structure."
  });
}

function enforceRequestedScope(graph: WorkflowGraph, input: WorkflowAiGenerationRequest): WorkflowGraph {
  const scope: WorkflowGraph["scope"] = input.recordId
    ? { mode: "record", objectKey: input.objectKey, recordId: input.recordId, recordTitle: input.recordTitle }
    : input.objectKey
      ? { mode: "object", objectKey: input.objectKey }
      : graph.scope;
  return {
    ...graph,
    scope,
    nodes: graph.nodes.map((node) => node.type === "start"
      ? (() => {
          const existingTrigger = isRecord(node.config.trigger) ? node.config.trigger : {};
          const existingTriggerConfig = isRecord(existingTrigger.config) ? existingTrigger.config : {};
          return {
          ...node,
          config: {
            ...node.config,
            trigger: {
              ...existingTrigger,
              ...(scope.objectKey ? { objectKey: scope.objectKey } : {}),
              config: {
                ...existingTriggerConfig,
                ...(scope.mode === "record" && scope.recordId ? { targetRecordId: scope.recordId, targetRecordTitle: scope.recordTitle, targetObjectKey: scope.objectKey } : {})
              }
            }
          }
        };
        })()
      : node)
  };
}

function normalizeTrigger(value: Record<string, unknown>, fallback: WorkflowDefinition["trigger"]): WorkflowDefinition["trigger"] {
  const type = value.type === "email_event" || value.type === "task_event" || value.type === "schedule" || value.type === "manual" ? value.type : "crm_event";
  return {
    ...fallback,
    type,
    event: stringValue(value.event, fallback.event),
    objectKey: stringValue(value.objectKey, fallback.objectKey),
    config: isRecord(value.config) ? value.config : fallback.config,
    schedule: isRecord(value.schedule) ? value.schedule as WorkflowDefinition["trigger"]["schedule"] : fallback.schedule
  };
}

function parseJsonObject(content: string): unknown {
  const text = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

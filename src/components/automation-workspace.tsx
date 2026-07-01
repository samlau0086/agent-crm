"use client";

import {
  Activity,
  BadgeDollarSign,
  Bot,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Copy,
  GitBranch,
  Mail,
  Maximize2,
  Minimize2,
  MousePointer2,
  PauseCircle,
  PlayCircle,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Repeat2,
  Split,
  Trash2,
  UserRound,
  Workflow as WorkflowIcon,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import type {
  CrmRecord,
  EmailAccount,
  User,
  WorkflowAction,
  WorkflowActionApproval,
  WorkflowAiGenerationResult,
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowRun,
  WorkflowTrigger
} from "@/lib/crm/types";
import { graphToLegacyWorkflow, legacyWorkflowToGraph } from "@/lib/workflows/core";
import { formatDateTimeSeconds } from "@/lib/utils/format";

type AutomationObjectKey = "all" | "contacts" | "companies" | "deals" | "email" | "tasks";
type AutomationNodeKind = "trigger" | "condition" | "action";
type AutomationNode =
  | { id: "trigger"; kind: "trigger"; title: string; subtitle: string; trigger: WorkflowTrigger }
  | { id: string; kind: "condition"; title: string; subtitle: string; condition: WorkflowCondition }
  | { id: string; kind: "action"; title: string; subtitle: string; action: WorkflowAction };
type AutomationDraft = Omit<WorkflowDefinition, "id" | "workspaceId" | "createdById" | "createdAt" | "updatedAt"> & Partial<Pick<WorkflowDefinition, "id" | "workspaceId" | "createdById" | "createdAt" | "updatedAt" | "lastRunAt">>;

interface AutomationWorkspaceProps {
  workflows: WorkflowDefinition[];
  workflowRuns: WorkflowRun[];
  workflowApprovals: WorkflowActionApproval[];
  records: CrmRecord[];
  emailAccounts: EmailAccount[];
  users: User[];
}

const automationObjects: Array<{ key: AutomationObjectKey; label: string; description: string; icon: LucideIcon }> = [
  { key: "all", label: "全部", description: "查看所有业务自动化", icon: WorkflowIcon },
  { key: "contacts", label: "联系人", description: "线索培育、跟进和唤醒", icon: UserRound },
  { key: "companies", label: "公司", description: "账号经营、主联系人和回收", icon: Building2 },
  { key: "deals", label: "交易", description: "阶段推进、Close 和赢单后动作", icon: BadgeDollarSign },
  { key: "email", label: "邮件", description: "收发信、分类、标签和自动回复草稿", icon: Mail },
  { key: "tasks", label: "任务", description: "逾期、完成和后续提醒", icon: CheckCircle2 }
];

const triggerEventOptions: Array<{ value: string; label: string; type: WorkflowTrigger["type"]; objectKey?: string }> = [
  { value: "record.created", label: "记录创建", type: "crm_event" },
  { value: "record.updated", label: "记录更新", type: "crm_event" },
  { value: "activity.created", label: "活动创建", type: "crm_event" },
  { value: "email.message.received", label: "收到邮件", type: "email_event", objectKey: "email" },
  { value: "email.message.sent", label: "邮件发送成功", type: "email_event", objectKey: "email" },
  { value: "email.message.failed", label: "邮件发送失败", type: "email_event", objectKey: "email" },
  { value: "task.completed", label: "任务完成", type: "task_event", objectKey: "tasks" },
  { value: "task.overdue", label: "任务逾期", type: "task_event", objectKey: "tasks" },
  { value: "schedule.daily", label: "每日定时", type: "schedule" },
  { value: "manual.run", label: "手动运行", type: "manual" }
];

const conditionTemplates: WorkflowCondition[] = [
  { key: "field-owner-exists", type: "field", field: "ownerId", operator: "exists", value: true },
  { key: "field-stage-exists", type: "field", field: "stageKey", operator: "exists", value: true },
  { key: "ai-high-intent", type: "ai", prompt: "判断客户是否为高意向，需要结合客户背景、邮件摘要、活动时间线和知识库。" }
];

const controlConditionTemplates: WorkflowCondition[] = [
  { key: "if-record-match", type: "if", field: "recordId", operator: "equals", value: "", config: { label: "IF 条件分支", branch: "matched" } },
  { key: "switch-stage", type: "switch", field: "stageKey", operator: "exists", config: { label: "SWITCH 多分支", cases: "new,qualified,proposal,won,lost" } },
  { key: "loop-contacts", type: "loop", field: "items", operator: "exists", config: { label: "LOOP 循环处理", collectionField: "items", maxIterations: 50 } }
];

const allConditionTemplates: WorkflowCondition[] = [...conditionTemplates, ...controlConditionTemplates];

const actionTemplates: WorkflowAction[] = [
  {
    key: "create-follow-up-task",
    type: "create_activity",
    name: "创建跟进任务",
    requiresApproval: false,
    config: { activityType: "task", title: "客户跟进", body: "根据工作流目标创建跟进任务。", dueInDays: 2 }
  },
  {
    key: "draft-follow-up-email",
    type: "send_email",
    name: "生成待审核邮件",
    requiresApproval: true,
    config: { mode: "draft", subject: "跟进：{{record.title}}", bodyText: "请基于客户背景生成简洁跟进邮件。" }
  },
  {
    key: "notify-owner",
    type: "notify",
    name: "发送通知",
    requiresApproval: false,
    config: { title: "工作流提醒", content: "请处理当前客户跟进事项。" }
  }
];

export function AutomationWorkspace({ workflows: initialWorkflows, workflowRuns: initialRuns, workflowApprovals: initialApprovals, records, emailAccounts, users }: AutomationWorkspaceProps) {
  const searchParams = useSearchParams();
  const initializedFromUrl = useRef(false);
  const [workflows, setWorkflows] = useState(initialWorkflows);
  const [workflowRuns, setWorkflowRuns] = useState(initialRuns);
  const [workflowApprovals, setWorkflowApprovals] = useState(initialApprovals);
  const [activeObjectKey, setActiveObjectKey] = useState<AutomationObjectKey>("contacts");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(initialWorkflows.find((workflow) => workflow.trigger.objectKey === "contacts")?.id ?? initialWorkflows[0]?.id ?? "");
  const [draft, setDraft] = useState<AutomationDraft>(() => createWorkflowDraft("contacts"));
  const [selectedNodeId, setSelectedNodeId] = useState("trigger");
  const [goal, setGoal] = useState("7 天未回复的报价客户自动跟进");
  const [isBusy, setIsBusy] = useState(false);
  const [toast, setToast] = useState<{ intent: "success" | "error" | "info"; message: string } | null>(null);
  const [targetRecordId, setTargetRecordId] = useState("");
  const [draggedNodeId, setDraggedNodeId] = useState("");
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState("start");
  const [pendingConnection, setPendingConnection] = useState<{ sourceNodeId: string; sourceHandle: string } | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ x: number; y: number; connection: { sourceNodeId: string; sourceHandle: string } } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<WorkflowDefinition | null>(null);

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId);
  const graph = useMemo(() => draft.graph ?? legacyWorkflowToGraph(draft as Pick<WorkflowDefinition, "trigger" | "conditions" | "actions">), [draft]);
  const selectedGraphNode = graph.nodes.find((node) => node.id === selectedGraphNodeId) ?? graph.nodes.find((node) => node.type === "start") ?? graph.nodes[0];
  const nodes = useMemo(() => workflowToNodes(draft), [draft]);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const relatedRuns = workflowRuns.filter((run) => !selectedWorkflowId || run.workflowId === selectedWorkflowId).slice(0, 20);
  const pendingApprovals = workflowApprovals.filter((approval) => approval.status === "pending");
  const targetObjectKey = activeObjectKey === "contacts" || activeObjectKey === "companies" || activeObjectKey === "deals"
    ? activeObjectKey
    : draft.trigger.objectKey === "contacts" || draft.trigger.objectKey === "companies" || draft.trigger.objectKey === "deals"
      ? draft.trigger.objectKey
      : "";
  const targetRecords = useMemo(
    () => records.filter((record) => targetObjectKey && record.objectKey === targetObjectKey).slice(0, 100),
    [records, targetObjectKey]
  );
  const selectedTargetRecord = targetRecords.find((record) => record.id === targetRecordId);
  const filteredWorkflows = useMemo(() => {
    const objectScoped = workflows.filter((workflow) => activeObjectKey === "all" || workflowTargetKey(workflow) === activeObjectKey);
    return targetRecordId ? objectScoped.filter((workflow) => workflowTargetRecordId(workflow) === targetRecordId) : objectScoped;
  }, [activeObjectKey, targetRecordId, workflows]);

  useEffect(() => {
    if (initializedFromUrl.current) return;
    initializedFromUrl.current = true;
    const objectKey = searchParams.get("objectKey");
    const recordId = searchParams.get("recordId");
    const workflowId = searchParams.get("workflowId");
    if ((objectKey === "contacts" || objectKey === "companies" || objectKey === "deals") && recordId) {
      setActiveObjectKey(objectKey);
      setTargetRecordId(recordId);
      const workflow = workflowId ? workflows.find((candidate) => candidate.id === workflowId) : undefined;
      if (workflow) {
        setSelectedWorkflowId(workflow.id);
        setDraft(workflow);
      } else {
        setSelectedWorkflowId("");
        setDraft(createWorkflowDraft(objectKey));
      }
    }
  }, [searchParams, workflows]);

  function showToast(intent: "success" | "error" | "info", message: string) {
    setToast({ intent, message });
    window.setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 3200);
  }

  function selectWorkflow(workflow: WorkflowDefinition) {
    setSelectedWorkflowId(workflow.id);
    setDraft(workflow);
    setTargetRecordId(workflowTargetRecordId(workflow));
    setSelectedNodeId("trigger");
    setSelectedGraphNodeId("start");
  }

  function createNewWorkflow(objectKey: AutomationObjectKey = activeObjectKey === "all" ? "contacts" : activeObjectKey) {
    setSelectedWorkflowId("");
    setDraft(createWorkflowDraft(objectKey));
    setTargetRecordId("");
    setSelectedNodeId("trigger");
    setSelectedGraphNodeId("start");
    setPendingConnection(null);
  }

  async function runAutomationAction(action: () => Promise<void>) {
    setIsBusy(true);
    try {
      await action();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "自动化操作失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function generateDraft() {
    if (!goal.trim()) {
      showToast("error", "请先输入自动化目标");
      return;
    }
    await runAutomationAction(async () => {
      const result = await fetchAutomationJson<WorkflowAiGenerationResult>("/api/workflows/generate", {
        method: "POST",
        body: {
          goal: goal.trim(),
          objectKey: selectedTargetRecord?.objectKey ?? (activeObjectKey === "all" || activeObjectKey === "email" || activeObjectKey === "tasks" ? undefined : activeObjectKey),
          recordId: selectedTargetRecord?.id,
          recordTitle: selectedTargetRecord?.title
        }
      });
      setSelectedWorkflowId("");
      setDraft(applyWorkflowRecordScope(result.workflow, selectedTargetRecord));
      setSelectedNodeId("trigger");
      setSelectedGraphNodeId("start");
      setPendingConnection(null);
      showToast("success", `已生成草稿：${result.workflow.name}`);
    });
  }

  async function saveDraft() {
    if (!draft.name.trim() || !draft.goal.trim()) {
      showToast("error", "请填写工作流名称和目标");
      return;
    }
    await runAutomationAction(async () => {
      const scopedDraft = applyWorkflowRecordScope(draft, selectedTargetRecord);
      const payload = stripWorkflowReadonlyFields(scopedDraft);
      const saved = draft.id
        ? await fetchAutomationJson<WorkflowDefinition>(`/api/workflows/${draft.id}`, { method: "PATCH", body: payload })
        : await fetchAutomationJson<WorkflowDefinition>("/api/workflows", { method: "POST", body: payload });
      setWorkflows((current) => [saved, ...current.filter((workflow) => workflow.id !== saved.id)]);
      setSelectedWorkflowId(saved.id);
      setDraft(saved);
      showToast("success", `已保存工作流：${saved.name}`);
    });
  }

  async function toggleWorkflow(workflow: WorkflowDefinition) {
    await runAutomationAction(async () => {
      const next = await fetchAutomationJson<WorkflowDefinition>(`/api/workflows/${workflow.id}/${workflow.status === "active" ? "disable" : "enable"}`, { method: "POST" });
      setWorkflows((current) => current.map((item) => (item.id === next.id ? next : item)));
      if (draft.id === next.id) setDraft(next);
      showToast("success", `${next.status === "active" ? "已启用" : "已停用"}：${next.name}`);
    });
  }

  async function duplicateWorkflow(workflow: WorkflowDefinition) {
    const copy = stripWorkflowReadonlyFields({ ...workflow, id: undefined, name: `${workflow.name} 副本`, status: "draft" });
    await runAutomationAction(async () => {
      const saved = await fetchAutomationJson<WorkflowDefinition>("/api/workflows", { method: "POST", body: copy });
      setWorkflows((current) => [saved, ...current]);
      selectWorkflow(saved);
      showToast("success", `已复制工作流：${saved.name}`);
    });
  }

  async function deleteWorkflow(workflow: WorkflowDefinition) {
    await runAutomationAction(async () => {
      await fetchAutomationJson(`/api/workflows/${workflow.id}`, { method: "DELETE" });
      setWorkflows((current) => current.filter((item) => item.id !== workflow.id));
      if (selectedWorkflowId === workflow.id) {
        createNewWorkflow();
      }
      setDeleteCandidate(null);
      showToast("success", `已删除工作流：${workflow.name}`);
    });
  }

  async function testWorkflow(workflow: WorkflowDefinition) {
    await runAutomationAction(async () => {
      const sampleRecord = records.find((record) => record.objectKey === workflow.trigger.objectKey) ?? records[0];
      const run = await fetchAutomationJson<WorkflowRun>(`/api/workflows/${workflow.id}/test`, {
        method: "POST",
        body: {
          triggerData: {
            objectKey: sampleRecord?.objectKey ?? workflow.trigger.objectKey ?? "contacts",
            recordId: sampleRecord?.id,
            title: sampleRecord?.title ?? "Workflow test run"
          }
        }
      });
      setWorkflowRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      showToast("success", `测试运行完成：${run.status}`);
    });
  }

  async function reviewApproval(approval: WorkflowActionApproval, decision: "approve" | "reject") {
    await runAutomationAction(async () => {
      const updated = await fetchAutomationJson<WorkflowActionApproval>(`/api/workflow-approvals/${approval.id}/${decision}`, { method: "POST", body: { decision } });
      setWorkflowApprovals((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      showToast("success", decision === "approve" ? "已通过动作审批" : "已拒绝动作审批");
    });
  }

  function addCondition(template = conditionTemplates[0]) {
    const condition = { ...template, key: uniqueNodeKey(template.key, graph.nodes.map((item) => item.id)) };
    const type: WorkflowNodeType = condition.type === "switch" ? "switch" : condition.type === "loop" ? "loop" : "if";
    const node = createGraphNode(type, graph.nodes.length, { condition });
    updateGraph({ ...graph, nodes: [...graph.nodes, { ...node, id: `condition:${condition.key}`, label: conditionLabel(condition) }] });
    setSelectedGraphNodeId(`condition:${condition.key}`);
  }

  function addAction(template = actionTemplates[0]) {
    const action = { ...template, key: uniqueNodeKey(template.key, graph.nodes.map((item) => item.id)), config: { ...template.config } };
    const type: WorkflowNodeType = action.type === "send_email" ? "send_email" : action.type === "update_stage" ? "update_deal" : action.type === "notify" ? "notify" : "create_task";
    const node = createGraphNode(type, graph.nodes.length, { action });
    updateGraph({ ...graph, nodes: [...graph.nodes, { ...node, id: `action:${action.key}`, label: action.name }] });
    setSelectedGraphNodeId(`action:${action.key}`);
  }

  function removeNode(node: AutomationNode) {
    if (node.kind === "trigger") {
      showToast("info", "触发器是工作流入口，不能删除。");
      return;
    }
    if (node.kind === "condition") {
      setDraft((current) => ({ ...current, conditions: current.conditions.filter((condition) => condition.key !== node.condition.key) }));
    } else {
      setDraft((current) => ({ ...current, actions: current.actions.filter((action) => action.key !== node.action.key) }));
    }
    setSelectedNodeId("trigger");
  }

  function handleNodeDrop(event: DragEvent<HTMLElement>, targetNodeId: string) {
    event.preventDefault();
    if (!draggedNodeId || draggedNodeId === targetNodeId) return;
    const source = nodes.find((node) => node.id === draggedNodeId);
    const target = nodes.find((node) => node.id === targetNodeId);
    setDraggedNodeId("");
    if (!source || !target || source.kind !== target.kind || source.kind === "trigger") return;
    if (source.kind === "condition") {
      if (target.kind !== "condition") return;
      setDraft((current) => ({ ...current, conditions: reorderByKey(current.conditions, source.condition.key, target.condition.key) }));
    } else if (source.kind === "action") {
      if (target.kind !== "action") return;
      setDraft((current) => ({ ...current, actions: reorderByKey(current.actions, source.action.key, target.action.key) }));
    }
  }

  function updateGraph(nextGraph: WorkflowGraph) {
    setDraft((current) => withWorkflowGraph(current, nextGraph));
  }

  function addGraphNode(type: WorkflowNodeType, position?: WorkflowNode["position"], explicitConnection?: { sourceNodeId: string; sourceHandle: string }) {
    const nextNode = createGraphNode(type, graph.nodes.length, {}, position);
    const connection = explicitConnection ?? pendingConnection;
    const source = connection?.sourceNodeId
      ? graph.nodes.find((node) => node.id === connection.sourceNodeId)
      : selectedGraphNode;
    const sourceHandle = connection?.sourceHandle ?? defaultGraphOutputHandles(source?.type ?? "start")[0] ?? "main";
    const nextGraph: WorkflowGraph = {
      ...graph,
      nodes: [...graph.nodes, nextNode],
      edges: source && source.type !== "end"
        ? [
            ...graph.edges.filter((edge) => !(edge.sourceNodeId === source.id && edge.sourceHandle === sourceHandle && nextNode.type !== "end")),
            createGraphEdge(source.id, sourceHandle, nextNode.id)
          ]
        : graph.edges
    };
    setPendingConnection(null);
    setQuickAdd(null);
    setSelectedGraphNodeId(nextNode.id);
    updateGraph(nextGraph);
  }

  function updateGraphNode(nodeId: string, patch: Partial<WorkflowNode>) {
    updateGraph({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch, config: patch.config ?? node.config } : node))
    });
  }

  function deleteGraphNode(nodeId: string) {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type === "start" || node.type === "end") {
      showToast("info", "Start 和 End 节点不能删除。");
      return;
    }
    updateGraph({
      ...graph,
      nodes: graph.nodes.filter((candidate) => candidate.id !== nodeId),
      edges: graph.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId)
    });
    setSelectedGraphNodeId("start");
    setPendingConnection(null);
    setQuickAdd(null);
  }

  function connectGraphNode(targetNodeId: string, explicitConnection?: { sourceNodeId: string; sourceHandle: string }) {
    const connection = explicitConnection ?? pendingConnection;
    if (!connection) return;
    if (connection.sourceNodeId === targetNodeId) {
      setPendingConnection(null);
      return;
    }
    updateGraph({
      ...graph,
      edges: [
        ...graph.edges.filter((edge) => !(edge.sourceNodeId === connection.sourceNodeId && edge.sourceHandle === connection.sourceHandle)),
        createGraphEdge(connection.sourceNodeId, connection.sourceHandle, targetNodeId)
      ]
    });
    setPendingConnection(null);
    setQuickAdd(null);
  }

  function deleteGraphEdge(edgeId: string) {
    updateGraph({ ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) });
  }

  function moveGraphNode(nodeId: string, position: WorkflowNode["position"]) {
    updateGraph({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node))
    });
  }

  function openQuickAdd(position: WorkflowNode["position"], connection: { sourceNodeId: string; sourceHandle: string }) {
    setPendingConnection(connection);
    setQuickAdd({ ...position, connection });
  }

  return (
    <div className="automation-workspace" data-testid="automation-workspace">
      <section className="automation-hero section">
        <div>
          <div className="activity-meta">
            <WorkflowIcon size={16} />
            自动化运营工作台
          </div>
          <h2 className="page-title">围绕联系人、公司、交易和邮件构建自动化流程</h2>
          <p className="subtle">触发器、条件、AI 判断、动作和审批以节点形式编排；保存后仍由现有工作流引擎执行。</p>
        </div>
        <div className="toolbar">
          <button className="secondary-button" type="button" onClick={() => createNewWorkflow()}>
            <Plus size={16} />
            新建流程
          </button>
          <button className="primary-button" type="button" onClick={() => { void saveDraft(); }} disabled={isBusy}>
            <Save size={16} />
            保存草稿
          </button>
        </div>
      </section>

      <section className="automation-object-tabs section" aria-label="自动化对象分类">
        {automationObjects.map((item) => {
          const Icon = item.icon;
          const count = workflows.filter((workflow) => item.key === "all" || workflowTargetKey(workflow) === item.key).length;
          return (
            <button
              className={`automation-object-tab ${activeObjectKey === item.key ? "active" : ""}`}
              data-testid={`automation-object-${item.key}`}
              key={item.key}
              type="button"
              onClick={() => {
                setActiveObjectKey(item.key);
                setTargetRecordId("");
                const first = workflows.find((workflow) => item.key === "all" || workflowTargetKey(workflow) === item.key);
                if (first) selectWorkflow(first);
                else createNewWorkflow(item.key === "all" ? "contacts" : item.key);
              }}
            >
              <Icon size={18} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <span className="badge">{count}</span>
            </button>
          );
        })}
      </section>

      <section className="automation-ai-strip section">
        <label>
          <span className="subtle">AI 一键生成工作流目标</span>
          <input className="input" data-testid="automation-ai-goal" value={goal} onChange={(event) => setGoal(event.target.value)} />
        </label>
        <label>
          <span className="subtle">目标记录</span>
          <select
            className="select"
            data-testid="automation-target-record"
            value={targetRecordId}
            onChange={(event) => setTargetRecordId(event.target.value)}
            disabled={!targetObjectKey}
          >
            <option value="">不绑定具体记录</option>
            {targetRecords.map((record) => (
              <option key={record.id} value={record.id}>{record.title}</option>
            ))}
          </select>
        </label>
        <button className="secondary-button" data-testid="automation-ai-generate" type="button" onClick={() => { void generateDraft(); }} disabled={isBusy}>
          <Sparkles size={16} />
          生成流程草稿
        </button>
      </section>

      <div className="automation-layout">
        <aside className="automation-list section">
          <div className="stage-header">
            <strong>对象流程</strong>
            <span className="badge">{filteredWorkflows.length}</span>
          </div>
          <div className="automation-list-items">
            {filteredWorkflows.map((workflow) => (
              <button
                className={`automation-list-item ${selectedWorkflowId === workflow.id ? "active" : ""}`}
                data-testid={`automation-workflow-${workflow.id}`}
                key={workflow.id}
                type="button"
                onClick={() => selectWorkflow(workflow)}
              >
                <span>
                  <strong>{workflow.name}</strong>
                  <small>{workflow.description || workflow.goal}</small>
                </span>
                <span className={workflow.status === "active" ? "badge" : workflow.status === "draft" ? "badge" : "danger-badge"}>{workflowStatusLabel(workflow.status)}</span>
              </button>
            ))}
            {filteredWorkflows.length === 0 ? <div className="empty-state">当前对象还没有自动化流程。</div> : null}
          </div>
        </aside>

        <section className="automation-canvas-shell section">
          <div className="automation-editor-header">
            <div className="form-grid">
              <label>
                <span className="subtle">流程名称</span>
                <input className="input" data-testid="automation-workflow-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                <span className="subtle">状态</span>
                <select className="select" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as WorkflowDefinition["status"] }))}>
                  <option value="draft">草稿</option>
                  <option value="disabled">停用</option>
                  <option value="active">启用</option>
                  <option value="archived">归档</option>
                </select>
              </label>
              <label className="wide">
                <span className="subtle">目标</span>
                <input className="input" value={draft.goal} onChange={(event) => setDraft((current) => ({ ...current, goal: event.target.value }))} />
              </label>
            </div>
            <div className="toolbar">
              {selectedWorkflow ? (
                <>
                  <button className="secondary-button" type="button" onClick={() => { void testWorkflow(selectedWorkflow); }} disabled={isBusy}>
                    <MousePointer2 size={16} />
                    测试
                  </button>
                  <button className={selectedWorkflow.status === "active" ? "secondary-button" : "primary-button"} type="button" onClick={() => { void toggleWorkflow(selectedWorkflow); }} disabled={isBusy}>
                    {selectedWorkflow.status === "active" ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                    {selectedWorkflow.status === "active" ? "停用" : "启用"}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => { void duplicateWorkflow(selectedWorkflow); }} disabled={isBusy}>
                    <Copy size={16} />
                    复制
                  </button>
                  <button className="danger-button" type="button" onClick={() => setDeleteCandidate(selectedWorkflow)} disabled={isBusy}>
                    <Trash2 size={16} />
                    删除
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="automation-designer">
            <div className="automation-palette">
              <strong>节点库</strong>
              <button className="automation-palette-item" type="button" onClick={() => setSelectedNodeId("trigger")}>
                <GitBranch size={16} />
                触发器
              </button>
              {allConditionTemplates.map((condition) => (
                <button className="automation-palette-item" key={condition.key} type="button" onClick={() => addCondition(condition)}>
                  {condition.type === "switch" ? <Split size={16} /> : condition.type === "loop" ? <Repeat2 size={16} /> : <ShieldCheck size={16} />}
                  {conditionLabel(condition)}
                </button>
              ))}
              {actionTemplates.map((action) => (
                <button className="automation-palette-item" key={action.key} type="button" onClick={() => addAction(action)}>
                  <Send size={16} />
                  {action.name}
                </button>
              ))}
            </div>

            <WorkflowGraphCanvas
              graph={graph}
              selectedNodeId={selectedGraphNode?.id ?? ""}
              pendingConnection={pendingConnection}
              quickAdd={quickAdd}
              onCompleteConnection={connectGraphNode}
              onCreateConnectedNode={(type, position, connection) => addGraphNode(type, position, connection)}
              onDeleteEdge={deleteGraphEdge}
              onMoveNode={moveGraphNode}
              onOpenQuickAdd={openQuickAdd}
              onSelectNode={setSelectedGraphNodeId}
              onStartConnection={setPendingConnection}
              onCancelQuickAdd={() => { setQuickAdd(null); setPendingConnection(null); }}
            />

            {selectedGraphNode ? (
              <WorkflowGraphInspector
                node={selectedGraphNode}
                graph={graph}
                emailAccounts={emailAccounts}
                users={users}
                onChange={updateGraphNode}
                onDelete={deleteGraphNode}
                onGraphChange={updateGraph}
              />
            ) : null}
          </div>
        </section>
      </div>

      <div className="automation-bottom-grid">
        <section className="section">
          <div className="stage-header">
            <strong>动作审批</strong>
            <span className="badge">{pendingApprovals.length}</span>
          </div>
          <div className="automation-approval-list">
            {pendingApprovals.map((approval) => (
              <div className="activity-item" key={approval.id}>
                <div className="stage-header">
                  <strong>{approval.summary}</strong>
                  <span className="badge">{actionTypeLabel(approval.actionType)}</span>
                </div>
                <div className="subtle">{approval.actionKey} · {formatDateTimeSeconds(approval.createdAt)}</div>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <button className="primary-button" type="button" onClick={() => { void reviewApproval(approval, "approve"); }} disabled={isBusy}>
                    通过
                  </button>
                  <button className="danger-button" type="button" onClick={() => { void reviewApproval(approval, "reject"); }} disabled={isBusy}>
                    拒绝
                  </button>
                </div>
              </div>
            ))}
            {pendingApprovals.length === 0 ? <div className="empty-state">暂无待审批动作。</div> : null}
          </div>
        </section>
        <section className="section">
          <div className="stage-header">
            <strong>运行历史</strong>
            <span className="badge">{relatedRuns.length}</span>
          </div>
          <div className="automation-run-list">
            {relatedRuns.map((run) => (
              <div className="activity-item" key={run.id}>
                <div className="stage-header">
                  <strong>{workflowNameById(workflows, run.workflowId)}</strong>
                  <span className={run.status === "failed" ? "danger-badge" : "badge"}>{workflowRunStatusLabel(run.status)}</span>
                </div>
                <div className="subtle">
                  {run.triggerEvent} · {formatDateTimeSeconds(run.startedAt)} · {run.durationMs ?? 0}ms
                </div>
              </div>
            ))}
            {relatedRuns.length === 0 ? <div className="empty-state">暂无运行记录。</div> : null}
          </div>
        </section>
      </div>

      {toast ? (
        <div className={`toast ${toast.intent}`} role="status">
          <span>{toast.message}</span>
          <button className="icon-button" type="button" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      ) : null}
      {deleteCandidate ? (
        <div className="app-dialog-backdrop" role="presentation">
          <div className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-delete-title">
            <h3 id="automation-delete-title">删除工作流</h3>
            <p>确定删除工作流“{deleteCandidate.name}”？运行日志和动作审批会一并清理。</p>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setDeleteCandidate(null)} disabled={isBusy}>
                取消
              </button>
              <button className="danger-button" type="button" onClick={() => { void deleteWorkflow(deleteCandidate); }} disabled={isBusy}>
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AutomationCanvasNode({
  node,
  selected,
  onClick,
  onDragStart,
  onDragOver,
  onDrop
}: {
  node: AutomationNode;
  selected: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const isControl = node.kind === "condition" && isControlCondition(node.condition);
  return (
    <div className={`automation-node-stack ${isControl ? "control" : ""}`} onDragOver={onDragOver} onDrop={onDrop}>
      <button
        className={`automation-node ${selected ? "selected" : ""} ${node.kind} ${isControl ? "control" : ""}`}
        type="button"
        draggable={node.kind !== "trigger"}
        onClick={onClick}
        onDragStart={onDragStart}
      >
        <span className="automation-node-icon">{nodeIcon(node.kind)}</span>
        <span>
          <strong>{node.title}</strong>
          <small>{node.subtitle}</small>
        </span>
      </button>
      {isControl ? <AutomationControlMap condition={node.condition} /> : null}
    </div>
  );
}

function AutomationControlMap({ condition }: { condition: WorkflowCondition }) {
  if (condition.type === "if") {
    return (
      <div className="automation-control-map" data-testid="automation-if-branches">
        <AutomationBranchRow tone="true" label="TRUE" value={conditionConfigText(condition.config?.trueLabel, conditionConfigText(condition.config?.branch, "Continue"))} />
        <AutomationBranchRow tone="false" label="FALSE" value={conditionConfigText(condition.config?.falseLabel, "Stop / Skip")} />
      </div>
    );
  }
  if (condition.type === "switch") {
    const cases = switchCasesFromConfig(condition.config?.cases);
    return (
      <div className="automation-control-map" data-testid="automation-switch-branches">
        {(cases.length ? cases : ["case A", "case B"]).slice(0, 4).map((item) => (
          <AutomationBranchRow key={item} tone="switch" label="CASE" value={item} />
        ))}
        <AutomationBranchRow tone="false" label="DEFAULT" value={conditionConfigText(condition.config?.defaultLabel, "Fallback")} />
      </div>
    );
  }
  return (
    <div className="automation-control-map" data-testid="automation-loop-branches">
      <AutomationBranchRow tone="loop" label="ENTRY" value={conditionConfigText(condition.config?.collectionField, condition.field ?? "items")} />
      <AutomationBranchRow tone="true" label="CONTINUE" value={conditionConfigText(condition.config?.continueLabel, "Next item")} />
      <AutomationBranchRow tone="false" label="BREAK" value={conditionConfigText(condition.config?.breakLabel, "Exit loop")} />
      <div className="automation-loop-return">max {conditionConfigText(condition.config?.maxIterations, "50")} iterations</div>
    </div>
  );
}

function AutomationBranchRow({ tone, label, value }: { tone: "true" | "false" | "switch" | "loop"; label: string; value: string }) {
  return (
    <div className="automation-branch-row">
      <span className={`automation-branch-pill ${tone}`}>{label}</span>
      <span className="automation-branch-value">{value}</span>
    </div>
  );
}

function AutomationNodeInspector({
  node,
  draft,
  emailAccounts,
  users,
  onChange,
  onRemove
}: {
  node: AutomationNode;
  draft: AutomationDraft;
  emailAccounts: EmailAccount[];
  users: User[];
  onChange: (draft: AutomationDraft) => void;
  onRemove: (node: AutomationNode) => void;
}) {
  if (node.kind === "trigger") {
    return (
      <aside className="automation-inspector">
        <div className="stage-header">
          <strong>触发器配置</strong>
          <span className="badge">入口</span>
        </div>
        <label>
          <span className="subtle">事件</span>
          <select
            className="select"
            value={draft.trigger.event ?? ""}
            onChange={(event) => {
              const selected = triggerEventOptions.find((option) => option.value === event.target.value) ?? triggerEventOptions[0];
              onChange({
                ...draft,
                trigger: {
                  ...draft.trigger,
                  type: selected.type,
                  event: selected.value,
                  objectKey: selected.objectKey === "email" || selected.objectKey === "tasks" ? undefined : draft.trigger.objectKey
                }
              });
            }}
          >
            {triggerEventOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="subtle">对象</span>
          <select
            className="select"
            value={draft.trigger.objectKey ?? ""}
            onChange={(event) => onChange({ ...draft, trigger: { ...draft.trigger, objectKey: event.target.value || undefined } })}
          >
            <option value="">不限定对象</option>
            <option value="contacts">联系人</option>
            <option value="companies">公司</option>
            <option value="deals">交易</option>
          </select>
        </label>
        {draft.trigger.type === "schedule" ? (
          <label>
            <span className="subtle">每日执行时间</span>
            <input
              className="input"
              value={draft.trigger.schedule?.dailyAt ?? "09:00"}
              onChange={(event) => onChange({ ...draft, trigger: { ...draft.trigger, schedule: { mode: "daily", dailyAt: event.target.value } } })}
            />
          </label>
        ) : null}
      </aside>
    );
  }

  if (node.kind === "condition") {
    const condition = node.condition;
    return (
      <aside className="automation-inspector">
        <div className="stage-header">
          <strong>条件配置</strong>
          <button className="text-button" type="button" onClick={() => onRemove(node)}>删除节点</button>
        </div>
        <label>
          <span className="subtle">字段 / Prompt</span>
          <input className="input" value={condition.type === "ai" ? condition.prompt ?? "" : condition.field ?? ""} onChange={(event) => updateCondition(draft, condition.key, condition.type === "ai" ? { prompt: event.target.value } : { field: event.target.value }, onChange)} />
        </label>
        <label>
          <span className="subtle">类型</span>
          <select className="select" value={condition.type} onChange={(event) => updateCondition(draft, condition.key, { type: event.target.value as WorkflowCondition["type"] }, onChange)}>
            <option value="field">字段条件</option>
            <option value="activity">活动条件</option>
            <option value="email_behavior">邮件行为</option>
            <option value="ai">AI 判断</option>
            <option value="if">IF 条件分支</option>
            <option value="switch">SWITCH 多分支</option>
            <option value="loop">LOOP 循环</option>
          </select>
        </label>
        <label>
          <span className="subtle">操作符</span>
          <select className="select" value={condition.operator ?? "exists"} onChange={(event) => updateCondition(draft, condition.key, { operator: event.target.value as WorkflowCondition["operator"] }, onChange)}>
            <option value="exists">存在</option>
            <option value="not_exists">不存在</option>
            <option value="equals">等于</option>
            <option value="not_equals">不等于</option>
            <option value="contains">包含</option>
            <option value="gt">大于</option>
            <option value="gte">大于等于</option>
            <option value="lt">小于</option>
            <option value="lte">小于等于</option>
          </select>
        </label>
        <label>
          <span className="subtle">期望值</span>
          <input className="input" value={stringifyConfigValue(condition.value)} onChange={(event) => updateCondition(draft, condition.key, { value: event.target.value }, onChange)} />
        </label>
        {condition.type === "if" ? (
          <label>
            <span className="subtle">分支名称</span>
            <input className="input" value={String(condition.config?.branch ?? "")} onChange={(event) => updateConditionConfig(draft, condition.key, "branch", event.target.value, onChange)} />
            <span className="subtle">TRUE / 命中后</span>
            <input className="input" value={String(condition.config?.trueLabel ?? "Continue")} onChange={(event) => updateConditionConfig(draft, condition.key, "trueLabel", event.target.value, onChange)} />
            <span className="subtle">FALSE / 未命中后</span>
            <input className="input" value={String(condition.config?.falseLabel ?? "Stop / Skip")} onChange={(event) => updateConditionConfig(draft, condition.key, "falseLabel", event.target.value, onChange)} />
          </label>
        ) : null}
        {condition.type === "switch" ? (
          <label>
            <span className="subtle">分支值（逗号分隔）</span>
            <textarea className="textarea" value={String(condition.config?.cases ?? "")} onChange={(event) => updateConditionConfig(draft, condition.key, "cases", event.target.value, onChange)} />
          </label>
        ) : null}
        {condition.type === "loop" ? (
          <>
            <label>
              <span className="subtle">循环集合字段</span>
              <input className="input" value={String(condition.config?.collectionField ?? condition.field ?? "items")} onChange={(event) => updateConditionConfig(draft, condition.key, "collectionField", event.target.value, onChange)} />
            </label>
            <label>
              <span className="subtle">最大循环次数</span>
              <input className="input" type="number" min={1} max={500} value={String(condition.config?.maxIterations ?? 50)} onChange={(event) => updateConditionConfig(draft, condition.key, "maxIterations", Number(event.target.value), onChange)} />
              <span className="subtle">CONTINUE / 继续条件说明</span>
              <input className="input" value={String(condition.config?.continueLabel ?? "Next item")} onChange={(event) => updateConditionConfig(draft, condition.key, "continueLabel", event.target.value, onChange)} />
              <span className="subtle">BREAK / 退出条件说明</span>
              <input className="input" value={String(condition.config?.breakLabel ?? "Exit loop")} onChange={(event) => updateConditionConfig(draft, condition.key, "breakLabel", event.target.value, onChange)} />
            </label>
          </>
        ) : null}
      </aside>
    );
  }

  const action = node.action;
  return (
    <aside className="automation-inspector">
      <div className="stage-header">
        <strong>动作配置</strong>
        <button className="text-button" type="button" onClick={() => onRemove(node)}>删除节点</button>
      </div>
      <label>
        <span className="subtle">动作名称</span>
        <input className="input" value={action.name} onChange={(event) => updateAction(draft, action.key, { name: event.target.value }, onChange)} />
      </label>
      <label>
        <span className="subtle">动作类型</span>
        <select className="select" value={action.type} onChange={(event) => updateAction(draft, action.key, { type: event.target.value as WorkflowAction["type"] }, onChange)}>
          <option value="create_activity">创建活动/任务</option>
          <option value="send_email">发送或生成邮件</option>
          <option value="update_stage">修改交易阶段</option>
          <option value="update_record">更新记录</option>
          <option value="notify">通知</option>
          <option value="create_knowledge_article">写入 RAG 知识</option>
        </select>
      </label>
      <label className="settings-toggle">
        <input type="checkbox" checked={Boolean(action.requiresApproval)} onChange={(event) => updateAction(draft, action.key, { requiresApproval: event.target.checked }, onChange)} />
        需要人工审批
      </label>
      {action.type === "send_email" ? (
        <>
          <label>
            <span className="subtle">邮件处理方式</span>
            <select className="select" value={String(action.config.mode ?? "draft")} onChange={(event) => updateActionConfigValue(draft, action.key, "mode", event.target.value, onChange)}>
              <option value="draft">创建草稿</option>
              <option value="queued">加入发送队列</option>
            </select>
          </label>
          <label>
            <span className="subtle">发件账户</span>
            <select className="select" value={String(action.config.accountId ?? "")} onChange={(event) => updateActionConfigValue(draft, action.key, "accountId", event.target.value || undefined, onChange)}>
              <option value="">自动选择可发送账户</option>
              {emailAccounts.filter((account) => account.sendEnabled).map((account) => (
                <option key={account.id} value={account.id}>{account.emailAddress}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="subtle">收件人（逗号分隔，支持模板变量）</span>
            <input className="input" value={joinConfigList(action.config.to)} onChange={(event) => updateActionConfigValue(draft, action.key, "to", splitConfigList(event.target.value), onChange)} placeholder="{{record.email}}, buyer@example.com" />
          </label>
          <label>
            <span className="subtle">CC</span>
            <input className="input" value={joinConfigList(action.config.cc)} onChange={(event) => updateActionConfigValue(draft, action.key, "cc", splitConfigList(event.target.value), onChange)} />
          </label>
          <label>
            <span className="subtle">BCC</span>
            <input className="input" value={joinConfigList(action.config.bcc)} onChange={(event) => updateActionConfigValue(draft, action.key, "bcc", splitConfigList(event.target.value), onChange)} />
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={Boolean(action.config.aiAssisted)} onChange={(event) => updateActionConfigValue(draft, action.key, "aiAssisted", event.target.checked, onChange)} />
            AI 生成/辅助正文
          </label>
        </>
      ) : null}
      <label>
        <span className="subtle">标题 / 主题</span>
        <input className="input" value={String(action.config.title ?? action.config.subject ?? "")} onChange={(event) => updateActionConfig(draft, action.key, action.type === "send_email" ? "subject" : "title", event.target.value, onChange)} />
      </label>
      <label>
        <span className="subtle">内容</span>
        <textarea className="textarea" value={String(action.config.body ?? action.config.bodyText ?? action.config.content ?? "")} onChange={(event) => updateActionConfig(draft, action.key, action.type === "send_email" ? "bodyText" : "body", event.target.value, onChange)} />
      </label>
      {action.type === "send_email" ? (
        <label>
          <span className="subtle">HTML 正文</span>
          <textarea className="textarea" value={String(action.config.bodyHtml ?? "")} onChange={(event) => updateActionConfig(draft, action.key, "bodyHtml", event.target.value, onChange)} />
        </label>
      ) : null}
      {users.length ? <div className="subtle">可用负责人：{users.slice(0, 3).map((user) => user.name).join("、")}</div> : null}
    </aside>
  );
}

function WorkflowGraphCanvas({
  graph,
  selectedNodeId,
  pendingConnection,
  quickAdd,
  onSelectNode,
  onStartConnection,
  onCompleteConnection,
  onOpenQuickAdd,
  onCreateConnectedNode,
  onCancelQuickAdd,
  onDeleteEdge,
  onMoveNode
}: {
  graph: WorkflowGraph;
  selectedNodeId: string;
  pendingConnection: { sourceNodeId: string; sourceHandle: string } | null;
  quickAdd: { x: number; y: number; connection: { sourceNodeId: string; sourceHandle: string } } | null;
  onSelectNode: (nodeId: string) => void;
  onStartConnection: (connection: { sourceNodeId: string; sourceHandle: string } | null) => void;
  onCompleteConnection: (targetNodeId: string, connection?: { sourceNodeId: string; sourceHandle: string }) => void;
  onOpenQuickAdd: (position: WorkflowNode["position"], connection: { sourceNodeId: string; sourceHandle: string }) => void;
  onCreateConnectedNode: (type: WorkflowNodeType, position: WorkflowNode["position"], connection: { sourceNodeId: string; sourceHandle: string }) => void;
  onCancelQuickAdd: () => void;
  onDeleteEdge: (edgeId: string) => void;
  onMoveNode: (nodeId: string, position: WorkflowNode["position"]) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [movingNode, setMovingNode] = useState<{
    nodeId: string;
    offsetX: number;
    offsetY: number;
    pointerId: number;
  } | null>(null);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  useEffect(() => {
    if (!movingNode) return;
    const activeMove = movingNode;
    function handlePointerMove(event: PointerEvent) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      onMoveNode(activeMove.nodeId, {
        x: Math.max(12, Math.round(event.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0) - activeMove.offsetX)),
        y: Math.max(12, Math.round(event.clientY - rect.top + (canvasRef.current?.scrollTop ?? 0) - activeMove.offsetY))
      });
    }
    function handlePointerUp() {
      setMovingNode(null);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [movingNode, onMoveNode]);

  function readConnection(event: DragEvent<HTMLElement>): { sourceNodeId: string; sourceHandle: string } | null {
    const raw = event.dataTransfer.getData("application/x-workflow-connection");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { sourceNodeId?: unknown; sourceHandle?: unknown };
      return typeof parsed.sourceNodeId === "string" && typeof parsed.sourceHandle === "string"
        ? { sourceNodeId: parsed.sourceNodeId, sourceHandle: parsed.sourceHandle }
        : null;
    } catch {
      return null;
    }
  }

  function canvasPoint(event: DragEvent<HTMLElement>): WorkflowNode["position"] {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: Math.max(20, Math.round(event.clientX - (rect?.left ?? 0) + (canvasRef.current?.scrollLeft ?? 0) - 110)),
      y: Math.max(20, Math.round(event.clientY - (rect?.top ?? 0) + (canvasRef.current?.scrollTop ?? 0) - 48))
    };
  }

  function handleCanvasDrop(event: DragEvent<HTMLDivElement>) {
    const connection = readConnection(event);
    if (!connection) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenQuickAdd(canvasPoint(event), connection);
  }

  return (
    <div
      className={`workflow-graph-canvas ${isFullscreen ? "fullscreen" : ""}`}
      data-testid="automation-node-canvas"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-workflow-connection")) event.preventDefault();
      }}
      onDrop={handleCanvasDrop}
      ref={canvasRef}
    >
      <button className="workflow-fullscreen-button icon-button" type="button" onClick={() => setIsFullscreen((current) => !current)}>
        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
      <div className="workflow-graph-stage">
      <svg className="workflow-graph-edges" aria-hidden="true">
        {graph.edges.map((edge) => {
          const source = nodeById.get(edge.sourceNodeId);
          const target = nodeById.get(edge.targetNodeId);
          if (!source || !target) return null;
          const startX = source.position.x + 270;
          const startY = source.position.y + 50 + outputHandleOffset(edge.sourceHandle);
          const endX = target.position.x;
          const endY = target.position.y + 50;
          const midX = Math.round((startX + endX) / 2);
          return (
            <path
              d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
              key={edge.id}
              className="workflow-graph-edge-path"
            />
          );
        })}
      </svg>

      {graph.nodes.map((node) => (
        <div
          className={`workflow-graph-node ${selectedNodeId === node.id ? "selected" : ""} ${node.type}`}
          data-testid={`workflow-node-${node.id}`}
          key={node.id}
          onClick={() => onSelectNode(node.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectNode(node.id);
            }
          }}
          role="button"
          style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)` }}
          tabIndex={0}
        >
          <span
            aria-label="Move node"
            className="workflow-node-drag-handle"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              const target = event.currentTarget.closest(".workflow-graph-node") as HTMLElement | null;
              const rect = target?.getBoundingClientRect();
              setMovingNode({
                nodeId: node.id,
                offsetX: rect ? event.clientX - rect.left : 110,
                offsetY: rect ? event.clientY - rect.top : 42,
                pointerId: event.pointerId
              });
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            title="拖动移动节点"
          >
            ⋮⋮
          </span>
          <span
            className="workflow-node-input"
            data-testid={`workflow-input-${node.id}`}
            onClick={(event) => { event.stopPropagation(); onCompleteConnection(node.id); }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const connection = readConnection(event);
              if (!connection) return;
              event.preventDefault();
              event.stopPropagation();
              onCompleteConnection(node.id, connection);
            }}
          >
            in
          </span>
          <span className="workflow-node-title">{node.label}</span>
          <span className="workflow-node-type">{workflowNodeTypeLabel(node.type)}</span>
          <span className="workflow-node-outputs">
            {defaultGraphOutputHandles(node.type).map((handle) => (
              <span
                className={`workflow-node-output ${pendingConnection?.sourceNodeId === node.id && pendingConnection.sourceHandle === handle ? "active" : ""}`}
                data-testid={`workflow-port-${node.id}-${handle}`}
                key={handle}
                onClick={(event) => {
                  event.stopPropagation();
                  onStartConnection({ sourceNodeId: node.id, sourceHandle: handle });
                }}
              >
                <span className="workflow-node-output-label">out</span>
                <span
                  className="workflow-node-port"
                  draggable
                  onDragStart={(event) => {
                    const connection = { sourceNodeId: node.id, sourceHandle: handle };
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "copyMove";
                    event.dataTransfer.setData("application/x-workflow-connection", JSON.stringify(connection));
                    event.dataTransfer.setData("text/plain", `${node.id}:${handle}`);
                    onStartConnection(connection);
                  }}
                />
                <span className="workflow-node-output-handle">{handle}</span>
              </span>
            ))}
          </span>
        </div>
      ))}

      {quickAdd ? (
        <div className="workflow-quick-add" data-testid="workflow-quick-add" style={{ transform: `translate(${quickAdd.x}px, ${quickAdd.y}px)` }}>
          <div className="stage-header">
            <strong>添加下级节点</strong>
            <button className="icon-button" type="button" onClick={onCancelQuickAdd}>×</button>
          </div>
          {quickAddNodeTypesForHandle(quickAdd.connection.sourceHandle).map((type) => (
            <button
              className="automation-palette-item"
              key={type}
              type="button"
              onClick={() => onCreateConnectedNode(type, { x: quickAdd.x, y: quickAdd.y }, quickAdd.connection)}
            >
              {workflowNodeTypeLabel(type)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="workflow-edge-list">
        <strong>Edges</strong>
        {graph.edges.map((edge) => (
          <button className="workflow-edge-chip" key={edge.id} type="button" onClick={() => onDeleteEdge(edge.id)}>
            {edge.sourceNodeId} / {edge.sourceHandle} → {edge.targetNodeId}
          </button>
        ))}
        {pendingConnection ? <span className="subtle">选择目标节点左侧 in 端口完成连接。</span> : null}
      </div>
      </div>
    </div>
  );
}

function WorkflowGraphInspector({
  node,
  graph,
  emailAccounts,
  users,
  onChange,
  onDelete,
  onGraphChange
}: {
  node: WorkflowNode;
  graph: WorkflowGraph;
  emailAccounts: EmailAccount[];
  users: User[];
  onChange: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  onDelete: (nodeId: string) => void;
  onGraphChange: (graph: WorkflowGraph) => void;
}) {
  const config = node.config;

  function updateConfig(key: string, value: unknown) {
    onChange(node.id, { config: { ...config, [key]: value } });
  }

  function updateStartScope(patch: Partial<WorkflowGraph["scope"]>) {
    const scope = { ...graph.scope, ...patch } as WorkflowGraph["scope"];
    const trigger = graphToLegacyWorkflow({ ...graph, scope }).trigger;
    onGraphChange({
      ...graph,
      scope,
      nodes: graph.nodes.map((candidate) => candidate.id === node.id ? { ...candidate, label: startNodeLabel(scope), config: { ...candidate.config, trigger } } : candidate)
    });
  }

  return (
    <aside className="automation-inspector workflow-graph-inspector">
      <div className="stage-header">
        <strong>{workflowNodeTypeLabel(node.type)}</strong>
        {node.type !== "start" && node.type !== "end" ? (
          <button className="text-button" type="button" onClick={() => onDelete(node.id)}>删除节点</button>
        ) : <span className="badge">固定</span>}
      </div>
      <label>
        <span className="subtle">节点名称</span>
        <input className="input" value={node.label} onChange={(event) => onChange(node.id, { label: event.target.value })} />
      </label>

      {node.type === "start" ? (
        <>
          <label>
            <span className="subtle">Scope</span>
            <select className="select" value={graph.scope.mode} onChange={(event) => updateStartScope({ mode: event.target.value as WorkflowGraph["scope"]["mode"] })}>
              <option value="record">仅此记录</option>
              <option value="object">当前对象</option>
              <option value="global">全局</option>
            </select>
          </label>
          <label>
            <span className="subtle">对象</span>
            <select className="select" value={graph.scope.objectKey ?? ""} onChange={(event) => updateStartScope({ objectKey: event.target.value || undefined })}>
              <option value="">不限定</option>
              <option value="contacts">联系人</option>
              <option value="companies">公司</option>
              <option value="deals">交易</option>
            </select>
          </label>
          {graph.scope.mode === "record" ? <div className="workflow-scope-card">仅此记录：{graph.scope.recordTitle ?? graph.scope.recordId}</div> : null}
        </>
      ) : null}

      {node.type === "if" ? (
        <ConditionFields config={config} onChange={updateConfig} />
      ) : null}

      {node.type === "switch" ? (
        <>
          <ConditionFields config={config} onChange={updateConfig} />
          <label>
            <span className="subtle">Cases（逗号分隔，对应 case:value 输出）</span>
            <textarea className="textarea" value={joinConfigList(config.cases)} onChange={(event) => updateConfig("cases", splitConfigList(event.target.value))} />
          </label>
        </>
      ) : null}

      {node.type === "loop" ? (
        <>
          <label>
            <span className="subtle">循环集合字段</span>
            <input className="input" value={String(config.collectionField ?? config.field ?? "items")} onChange={(event) => updateConfig("collectionField", event.target.value)} />
          </label>
          <label>
            <span className="subtle">最大循环次数</span>
            <input className="input" type="number" min={1} max={100} value={String(config.maxIterations ?? 50)} onChange={(event) => updateConfig("maxIterations", Number(event.target.value))} />
          </label>
        </>
      ) : null}

      {node.type === "send_email" ? (
        <>
          <label>
            <span className="subtle">发件账户</span>
            <select className="select" value={String(config.accountId ?? "")} onChange={(event) => updateConfig("accountId", event.target.value || undefined)}>
              <option value="">自动选择</option>
              {emailAccounts.filter((account) => account.sendEnabled).map((account) => (
                <option key={account.id} value={account.id}>{account.emailAddress}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="subtle">收件人</span>
            <input className="input" value={joinConfigList(config.to)} onChange={(event) => updateConfig("to", splitConfigList(event.target.value))} />
          </label>
          <label>
            <span className="subtle">主题</span>
            <input className="input" value={String(config.subject ?? "")} onChange={(event) => updateConfig("subject", event.target.value)} />
          </label>
          <label>
            <span className="subtle">正文</span>
            <textarea className="textarea" value={String(config.bodyText ?? "")} onChange={(event) => updateConfig("bodyText", event.target.value)} />
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={Boolean(config.requiresApproval ?? true)} onChange={(event) => updateConfig("requiresApproval", event.target.checked)} />
            高风险动作进入审批
          </label>
        </>
      ) : null}

      {node.type === "create_task" || node.type === "notify" ? (
        <>
          <label>
            <span className="subtle">标题</span>
            <input className="input" value={String(config.title ?? "")} onChange={(event) => updateConfig("title", event.target.value)} />
          </label>
          <label>
            <span className="subtle">内容</span>
            <textarea className="textarea" value={String(config.body ?? config.content ?? "")} onChange={(event) => updateConfig(node.type === "notify" ? "content" : "body", event.target.value)} />
          </label>
        </>
      ) : null}

      {node.type === "update_deal" ? (
        <label>
          <span className="subtle">目标阶段 key</span>
          <input className="input" value={String(config.stageKey ?? "")} onChange={(event) => updateConfig("stageKey", event.target.value)} />
        </label>
      ) : null}

      {users.length ? <div className="subtle">可用负责人：{users.slice(0, 3).map((user) => user.name).join("、")}</div> : null}
    </aside>
  );
}

function ConditionFields({ config, onChange }: { config: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  return (
    <>
      <label>
        <span className="subtle">字段</span>
        <input className="input" value={String(config.field ?? "recordId")} onChange={(event) => onChange("field", event.target.value)} />
      </label>
      <label>
        <span className="subtle">操作符</span>
        <select className="select" value={String(config.operator ?? "equals")} onChange={(event) => onChange("operator", event.target.value)}>
          <option value="exists">exists</option>
          <option value="not_exists">not exists</option>
          <option value="equals">equals</option>
          <option value="not_equals">not equals</option>
          <option value="contains">contains</option>
          <option value="gt">gt</option>
          <option value="gte">gte</option>
          <option value="lt">lt</option>
          <option value="lte">lte</option>
        </select>
      </label>
      <label>
        <span className="subtle">值</span>
        <input className="input" value={String(config.value ?? "")} onChange={(event) => onChange("value", event.target.value)} />
      </label>
    </>
  );
}

function createWorkflowDraft(objectKey: AutomationObjectKey): AutomationDraft {
  const normalizedObjectKey = objectKey === "all" || objectKey === "email" || objectKey === "tasks" ? "contacts" : objectKey;
  const parts = createDefaultWorkflowParts(normalizedObjectKey);
  return {
    name: `${automationObjectLabel(objectKey)}自动化`,
    description: "通过可视化工作流编辑器创建的草稿。",
    goal: "自动创建跟进任务，并在高风险动作前进入审批。",
    status: "draft",
    trigger: parts.trigger,
    conditions: parts.conditions,
    actions: parts.actions,
    graph: parts.graph,
    version: 1
  };
}

function createDefaultWorkflowParts(objectKey: string): Pick<AutomationDraft, "trigger" | "conditions" | "actions" | "graph"> {
  const trigger: WorkflowTrigger = { type: "crm_event", event: "record.updated", objectKey };
  const conditions = [{ ...conditionTemplates[0] }];
  const actions = [{ ...actionTemplates[0], config: { ...actionTemplates[0].config } }];
  return { trigger, conditions, actions, graph: legacyWorkflowToGraph({ trigger, conditions, actions }) };
}

function withWorkflowGraph(draft: AutomationDraft, graph: WorkflowGraph): AutomationDraft {
  const legacy = graphToLegacyWorkflow(graph);
  return { ...draft, ...legacy, graph };
}

function createGraphNode(type: WorkflowNodeType, index: number, config: Record<string, unknown> = {}, position?: WorkflowNode["position"]): WorkflowNode {
  return {
    id: `${type}:${Date.now().toString(36)}:${index}`,
    type,
    label: defaultGraphNodeLabel(type),
    position: {
      x: position?.x ?? 60 + (index % 4) * 260,
      y: position?.y ?? 80 + Math.floor(index / 4) * 150
    },
    config: defaultGraphNodeConfig(type, config)
  };
}

function quickAddNodeTypesForHandle(handle: string): WorkflowNodeType[] {
  if (handle === "false" || handle === "break" || handle === "default") return ["notify", "create_task", "end"];
  if (handle.startsWith("case:")) return ["send_email", "create_task", "update_deal", "notify", "end"];
  return ["if", "switch", "loop", "send_email", "create_task", "update_deal", "notify", "end"];
}

function createGraphEdge(sourceNodeId: string, sourceHandle: string, targetNodeId: string): WorkflowEdge {
  return {
    id: `edge:${sourceNodeId}:${sourceHandle}:${targetNodeId}:${Date.now().toString(36)}`,
    sourceNodeId,
    sourceHandle,
    targetNodeId
  };
}

function defaultGraphNodeConfig(type: WorkflowNodeType, config: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(config).length > 0) return config;
  if (type === "if") return { field: "recordId", operator: "equals", value: "" };
  if (type === "switch") return { field: "stageKey", cases: ["new", "qualified"], operator: "exists" };
  if (type === "loop") return { collectionField: "items", maxIterations: 50 };
  if (type === "send_email") return { mode: "draft", to: ["{{record.email}}"], subject: "Follow up {{record.title}}", bodyText: "" };
  if (type === "create_task") return { activityType: "task", title: "Follow up", body: "", dueInDays: 2 };
  if (type === "update_deal") return { stageKey: "" };
  if (type === "notify") return { title: "Workflow notification", content: "" };
  return {};
}

function defaultGraphNodeLabel(type: WorkflowNodeType): string {
  if (type === "start") return "Start";
  if (type === "if") return "IF";
  if (type === "switch") return "SWITCH";
  if (type === "loop") return "LOOP";
  if (type === "send_email") return "Send Email";
  if (type === "create_task") return "Create Task";
  if (type === "update_deal") return "Update Deal";
  if (type === "notify") return "Notify";
  return "End";
}

function workflowNodeTypeLabel(type: WorkflowNodeType): string {
  return defaultGraphNodeLabel(type);
}

function defaultGraphOutputHandles(type: WorkflowNodeType): string[] {
  if (type === "if") return ["true", "false"];
  if (type === "switch") return ["case:new", "case:qualified", "default"];
  if (type === "loop") return ["continue", "break"];
  if (type === "end") return [];
  return ["main"];
}

function outputHandleOffset(handle: string): number {
  if (handle === "false" || handle === "break" || handle === "default") return 22;
  if (handle.startsWith("case:")) return -18;
  return 0;
}

function startNodeLabel(scope: WorkflowGraph["scope"]): string {
  if (scope.mode === "record") return `Start: 仅此记录 ${scope.recordTitle ?? scope.recordId ?? ""}`.trim();
  if (scope.mode === "object") return `Start: ${scope.objectKey ?? "object"}`;
  return "Start: global";
}

function workflowToNodes(workflow: AutomationDraft): AutomationNode[] {
  return [
    {
      id: "trigger",
      kind: "trigger",
      title: triggerLabel(workflow.trigger),
      subtitle: workflow.trigger.objectKey ? `对象：${automationObjectLabel(workflow.trigger.objectKey as AutomationObjectKey)}` : "不限定对象",
      trigger: workflow.trigger
    },
    ...workflow.conditions.map((condition) => ({
      id: `condition:${condition.key}`,
      kind: "condition" as const,
      title: conditionLabel(condition),
      subtitle: condition.type === "ai" ? "AI 判断" : `${condition.field ?? condition.key} ${condition.operator ?? "equals"}`,
      condition
    })),
    ...workflow.actions.map((action) => ({
      id: `action:${action.key}`,
      kind: "action" as const,
      title: action.name,
      subtitle: `${actionTypeLabel(action.type)}${action.requiresApproval ? " · 需审批" : ""}`,
      action
    }))
  ];
}

function workflowTargetKey(workflow: WorkflowDefinition): AutomationObjectKey {
  if (workflow.trigger.type === "email_event" || workflow.trigger.event?.startsWith("email.")) return "email";
  if (workflow.trigger.type === "task_event" || workflow.trigger.event?.startsWith("task.")) return "tasks";
  if (workflow.trigger.objectKey === "contacts" || workflow.trigger.objectKey === "companies" || workflow.trigger.objectKey === "deals") return workflow.trigger.objectKey;
  return "contacts";
}

function isControlCondition(condition: WorkflowCondition): boolean {
  return condition.type === "if" || condition.type === "switch" || condition.type === "loop";
}

function conditionConfigText(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function switchCasesFromConfig(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  if (typeof value === "string") {
    return value.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function workflowTargetRecordId(workflow: Pick<WorkflowDefinition, "trigger" | "conditions" | "graph">): string {
  if (workflow.graph?.scope.mode === "record" && workflow.graph.scope.recordId) return workflow.graph.scope.recordId;
  const configuredTarget = workflow.trigger.config?.targetRecordId;
  if (typeof configuredTarget === "string" && configuredTarget.trim()) return configuredTarget.trim();
  const targetCondition = workflow.conditions.find((condition) => condition.key === "target-record" && condition.field === "recordId");
  return typeof targetCondition?.value === "string" ? targetCondition.value : "";
}

function applyWorkflowRecordScope(draft: AutomationDraft, targetRecord?: CrmRecord): AutomationDraft {
  if (!targetRecord) return draft;
  const baseGraph = draft.graph ?? legacyWorkflowToGraph(draft);
  const graph: WorkflowGraph = {
    ...baseGraph,
    scope: {
      mode: "record",
      objectKey: targetRecord.objectKey,
      recordId: targetRecord.id,
      recordTitle: targetRecord.title
    },
    nodes: baseGraph.nodes.map((node) => node.type === "start"
      ? {
          ...node,
          label: startNodeLabel({ mode: "record", objectKey: targetRecord.objectKey, recordId: targetRecord.id, recordTitle: targetRecord.title }),
          config: {
            ...node.config,
            trigger: {
              ...draft.trigger,
              objectKey: targetRecord.objectKey,
              config: {
                ...(draft.trigger.config ?? {}),
                targetRecordId: targetRecord.id,
                targetRecordTitle: targetRecord.title,
                targetObjectKey: targetRecord.objectKey
              }
            }
          }
        }
      : node)
  };
  const targetCondition: WorkflowCondition = {
    key: "target-record",
    type: "if",
    field: "recordId",
    operator: "equals",
    value: targetRecord.id,
    config: {
      label: `仅当触发记录是 ${targetRecord.title}`,
      branch: "matched",
      trueLabel: "命中此记录",
      falseLabel: "不是此记录，停止"
    }
  };
  const conditions = [targetCondition, ...draft.conditions.filter((condition) => condition.key !== "target-record")];
  return {
    ...draft,
    trigger: {
      ...draft.trigger,
      objectKey: targetRecord.objectKey,
      config: {
        ...(draft.trigger.config ?? {}),
        targetRecordId: targetRecord.id,
        targetRecordTitle: targetRecord.title,
        targetObjectKey: targetRecord.objectKey
      }
    },
    conditions,
    graph
  };
}

function stripWorkflowReadonlyFields(workflow: AutomationDraft) {
  return {
    name: workflow.name,
    description: workflow.description,
    goal: workflow.goal,
    status: workflow.status,
    trigger: workflow.trigger,
    conditions: workflow.conditions,
    actions: workflow.actions,
    graph: workflow.graph,
    version: workflow.version
  };
}

function updateCondition(draft: AutomationDraft, key: string, patch: Partial<WorkflowCondition>, onChange: (draft: AutomationDraft) => void) {
  onChange({ ...draft, conditions: draft.conditions.map((condition) => (condition.key === key ? { ...condition, ...patch } : condition)) });
}

function updateConditionConfig(draft: AutomationDraft, key: string, configKey: string, value: unknown, onChange: (draft: AutomationDraft) => void) {
  onChange({
    ...draft,
    conditions: draft.conditions.map((condition) => (
      condition.key === key ? { ...condition, config: { ...(condition.config ?? {}), [configKey]: value } } : condition
    ))
  });
}

function updateAction(draft: AutomationDraft, key: string, patch: Partial<WorkflowAction>, onChange: (draft: AutomationDraft) => void) {
  onChange({ ...draft, actions: draft.actions.map((action) => (action.key === key ? { ...action, ...patch } : action)) });
}

function updateActionConfig(draft: AutomationDraft, key: string, configKey: string, value: string, onChange: (draft: AutomationDraft) => void) {
  updateActionConfigValue(draft, key, configKey, value, onChange);
}

function updateActionConfigValue(draft: AutomationDraft, key: string, configKey: string, value: unknown, onChange: (draft: AutomationDraft) => void) {
  onChange({
    ...draft,
    actions: draft.actions.map((action) => (action.key === key ? { ...action, config: { ...action.config, [configKey]: value } } : action))
  });
}

function splitConfigList(value: string): string[] {
  return value.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
}

function joinConfigList(value: unknown): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(", ") : "";
}

function reorderByKey<T extends { key: string }>(items: T[], sourceKey: string, targetKey: string): T[] {
  const sourceIndex = items.findIndex((item) => item.key === sourceKey);
  const targetIndex = items.findIndex((item) => item.key === targetKey);
  if (sourceIndex === -1 || targetIndex === -1) return items;
  const next = [...items];
  const [source] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  return next;
}

function uniqueNodeKey(baseKey: string, existingKeys: string[]): string {
  if (!existingKeys.includes(baseKey)) return baseKey;
  let index = 2;
  while (existingKeys.includes(`${baseKey}-${index}`)) index += 1;
  return `${baseKey}-${index}`;
}

function nodeIcon(kind: AutomationNodeKind) {
  if (kind === "trigger") return <GitBranch size={17} />;
  if (kind === "condition") return <ShieldCheck size={17} />;
  return <Send size={17} />;
}

function workflowNameById(workflows: WorkflowDefinition[], workflowId: string): string {
  return workflows.find((workflow) => workflow.id === workflowId)?.name ?? workflowId;
}

function triggerLabel(trigger: WorkflowTrigger): string {
  return triggerEventOptions.find((option) => option.value === trigger.event)?.label ?? trigger.event ?? "手动触发";
}

function conditionLabel(condition: WorkflowCondition): string {
  if (condition.type === "if") return "IF 条件分支";
  if (condition.type === "switch") return "SWITCH 多分支";
  if (condition.type === "loop") return "LOOP 循环";
  if (condition.type === "ai") return "AI 条件判断";
  if (condition.type === "email_behavior") return "邮件行为条件";
  if (condition.type === "activity") return "活动条件";
  return "字段条件";
}

function actionTypeLabel(type: WorkflowAction["type"]): string {
  return {
    create_activity: "创建活动",
    send_email: "邮件动作",
    update_stage: "修改阶段",
    update_record: "更新记录",
    notify: "通知",
    create_knowledge_article: "RAG 知识"
  }[type];
}

function workflowStatusLabel(status: WorkflowDefinition["status"]): string {
  return { draft: "草稿", active: "启用", disabled: "停用", archived: "归档" }[status];
}

function workflowRunStatusLabel(status: WorkflowRun["status"]): string {
  return { running: "运行中", completed: "完成", failed: "失败", skipped: "跳过", approval_required: "待审批" }[status];
}

function automationObjectLabel(key: AutomationObjectKey | string): string {
  return automationObjects.find((item) => item.key === key)?.label ?? key;
}

function stringifyConfigValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function fetchAutomationJson<T = unknown>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error?.message === "string" ? payload.error.message : "请求失败";
    throw new Error(message);
  }
  return (payload?.data ?? payload) as T;
}


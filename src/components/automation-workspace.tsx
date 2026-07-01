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
  WorkflowRun,
  WorkflowTrigger
} from "@/lib/crm/types";
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
  const [deleteCandidate, setDeleteCandidate] = useState<WorkflowDefinition | null>(null);

  const filteredWorkflows = useMemo(() => workflows.filter((workflow) => activeObjectKey === "all" || workflowTargetKey(workflow) === activeObjectKey), [activeObjectKey, workflows]);
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId);
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

  useEffect(() => {
    if (initializedFromUrl.current) return;
    initializedFromUrl.current = true;
    const objectKey = searchParams.get("objectKey");
    const recordId = searchParams.get("recordId");
    if ((objectKey === "contacts" || objectKey === "companies" || objectKey === "deals") && recordId) {
      setActiveObjectKey(objectKey);
      setTargetRecordId(recordId);
      setSelectedWorkflowId("");
      setDraft(createWorkflowDraft(objectKey));
    }
  }, [searchParams]);

  function showToast(intent: "success" | "error" | "info", message: string) {
    setToast({ intent, message });
    window.setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 3200);
  }

  function selectWorkflow(workflow: WorkflowDefinition) {
    setSelectedWorkflowId(workflow.id);
    setDraft(workflow);
    setSelectedNodeId("trigger");
  }

  function createNewWorkflow(objectKey: AutomationObjectKey = activeObjectKey === "all" ? "contacts" : activeObjectKey) {
    setSelectedWorkflowId("");
    setDraft(createWorkflowDraft(objectKey));
    setTargetRecordId("");
    setSelectedNodeId("trigger");
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
      setDraft(result.workflow);
      setSelectedNodeId("trigger");
      showToast("success", `已生成草稿：${result.workflow.name}`);
    });
  }

  async function saveDraft() {
    if (!draft.name.trim() || !draft.goal.trim()) {
      showToast("error", "请填写工作流名称和目标");
      return;
    }
    await runAutomationAction(async () => {
      const payload = stripWorkflowReadonlyFields(draft);
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
    const condition = { ...template, key: uniqueNodeKey(template.key, draft.conditions.map((item) => item.key)) };
    setDraft((current) => ({ ...current, conditions: [...current.conditions, condition] }));
    setSelectedNodeId(`condition:${condition.key}`);
  }

  function addAction(template = actionTemplates[0]) {
    const action = { ...template, key: uniqueNodeKey(template.key, draft.actions.map((item) => item.key)), config: { ...template.config } };
    setDraft((current) => ({ ...current, actions: [...current.actions, action] }));
    setSelectedNodeId(`action:${action.key}`);
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

            <div className="automation-canvas" data-testid="automation-node-canvas">
              {nodes.map((node, index) => (
                <div className="automation-node-wrap" key={node.id}>
                  <button
                    className={`automation-node ${selectedNodeId === node.id ? "selected" : ""} ${node.kind}`}
                    draggable={node.kind !== "trigger"}
                    type="button"
                    onClick={() => setSelectedNodeId(node.id)}
                    onDragStart={() => setDraggedNodeId(node.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleNodeDrop(event, node.id)}
                  >
                    <span className="automation-node-icon">{nodeIcon(node.kind)}</span>
                    <span>
                      <strong>{node.title}</strong>
                      <small>{node.subtitle}</small>
                    </span>
                  </button>
                  {index < nodes.length - 1 ? (
                    <div className="automation-node-edge">
                      <ChevronRight size={18} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <AutomationNodeInspector
              node={selectedNode}
              draft={draft}
              emailAccounts={emailAccounts}
              users={users}
              onChange={setDraft}
              onRemove={removeNode}
            />
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

function createWorkflowDraft(objectKey: AutomationObjectKey): AutomationDraft {
  const normalizedObjectKey = objectKey === "all" || objectKey === "email" || objectKey === "tasks" ? "contacts" : objectKey;
  return {
    name: `${automationObjectLabel(objectKey)}自动化`,
    description: "通过可视化工作流编辑器创建的草稿。",
    goal: "自动创建跟进任务，并在高风险动作前进入审批。",
    status: "draft",
    trigger: { type: "crm_event", event: "record.updated", objectKey: normalizedObjectKey },
    conditions: [{ ...conditionTemplates[0] }],
    actions: [{ ...actionTemplates[0], config: { ...actionTemplates[0].config } }],
    version: 1
  };
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

function stripWorkflowReadonlyFields(workflow: AutomationDraft) {
  return {
    name: workflow.name,
    description: workflow.description,
    goal: workflow.goal,
    status: workflow.status,
    trigger: workflow.trigger,
    conditions: workflow.conditions,
    actions: workflow.actions,
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


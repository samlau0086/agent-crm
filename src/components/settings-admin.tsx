"use client";

import { CheckCircle2, ClipboardList, Download, GitBranch, LayoutList, Link2, Plus, RefreshCw, Save, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { permissionCatalog } from "@/lib/auth/permissions";
import { getCurrencyDefinitions, normalizeCurrencyCode } from "@/lib/crm/currencies";
import { formatAuditAction } from "@/lib/crm/audit-labels";
import { buildImportJobObservability } from "@/lib/crm/import-observability";
import type { ApiKey, AuditLog, CreatedApiKey, CreatedWebhookEndpoint, CrmPoolSettings, CrmRecord, CsvImportJob, EmailAccount, FieldDefinition, ImportJobQueueSummary, NotificationChannel, NotificationChannelType, ObjectDefinition, Permission, Pipeline, RecordChangeRequest, RelationDefinition, Role, SavedView, Team, User, WebhookDelivery, WebhookDeliveryStatus, WebhookEndpoint, WebhookEvent } from "@/lib/crm/types";
import type { BackupFile, BackupRunResult } from "@/lib/ops/backups";

interface SettingsAdminProps {
  role: Role;
  objects: ObjectDefinition[];
  fields: FieldDefinition[];
  relations: RelationDefinition[];
  pipelines: Pipeline[];
  savedViews: SavedView[];
  records: CrmRecord[];
  roles: Role[];
  users: User[];
  teams: Team[];
  apiKeys: ApiKey[];
  webhooks: WebhookEndpoint[];
  notificationChannels: NotificationChannel[];
  emailAccounts: EmailAccount[];
  auditLogs: AuditLog[];
  backupFiles: BackupFile[];
  importJobQueueSummary?: ImportJobQueueSummary;
  poolSettings: CrmPoolSettings;
  recordChangeRequests: RecordChangeRequest[];
}

type ObjectDraft = {
  key: string;
  label: string;
  pluralLabel: string;
  description: string;
};

type FieldDraft = {
  objectKey: string;
  key: string;
  label: string;
  type: FieldDefinition["type"];
  required: boolean;
  unique: boolean;
  optionsText: string;
  referenceObjectKey: string;
  position: string;
};

type RelationDraft = {
  fromObjectKey: string;
  toObjectKey: string;
  key: string;
  label: string;
  cardinality: RelationDefinition["cardinality"];
};

type PipelineDraft = {
  objectKey: string;
  name: string;
  isDefault: boolean;
  stagesText: string;
};

type ViewDraft = {
  objectKey: string;
  name: string;
  columnsText: string;
  sortField: string;
  sortDirection: "asc" | "desc";
  isDefault: boolean;
  filterField: string;
  filterOperator: "contains" | "equals";
  filterValue: string;
};

type RoleDraft = {
  name: string;
  permissions: Permission[];
};

type UserDraft = {
  email: string;
  name: string;
  roleId: string;
  teamId: string;
  password: string;
  active: boolean;
};

type TeamDraft = {
  name: string;
};

type ApiKeyDraft = {
  name: string;
  permissions: Permission[];
  expiresAt: string;
};

type WebhookDraft = {
  name: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
};

type CurrencyDraft = {
  code: string;
  label: string;
  symbol: string;
  rateToBase: string;
  isBase: boolean;
  active: boolean;
};

type NotificationChannelDraft = {
  name: string;
  type: NotificationChannelType;
  events: WebhookEvent[];
  active: boolean;
  barkEndpoint: string;
  barkDeviceKey: string;
  webhookUrl: string;
  recipients: string;
  accountId: string;
};
type PoolSettingsDraft = {
  enabled: boolean;
  privateLimit: string;
  autoReclaimEnabled: boolean;
  autoReclaimDays: string;
};
type ToastState = { intent: "success" | "error" | "info"; message: string };
type ConfirmDialogState = { title: string; message: string; confirmLabel?: string; danger?: boolean };

const baseWebhookEventOptions: WebhookEvent[] = ["record.created", "record.updated", "record.deleted", "activity.created", "import.completed", "import.failed", "webhook.test"];
const emailWebhookEventOptions: WebhookEvent[] = ["email.message.created", "email.thread.updated", "email.thread.deleted"];

const fieldTypes: FieldDefinition["type"][] = [
  "text",
  "textarea",
  "number",
  "currency",
  "date",
  "select",
  "boolean",
  "user",
  "reference"
];

type SettingsTabKey = "access" | "crm" | "pool" | "integrations" | "operations";

const settingsTabs: Array<{ key: SettingsTabKey; label: string; description: string }> = [
  { key: "access", label: "成员权限", description: "用户、团队、角色与权限矩阵" },
  { key: "crm", label: "CRM 配置", description: "对象、字段、关系、管道、视图与货币" },
  { key: "integrations", label: "集成接口", description: "API Key、Webhook 与外部系统连接" },
  { key: "operations", label: "运维审计", description: "导入队列、备份与审计日志" }
];

export function SettingsAdmin(props: SettingsAdminProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [isPending, startTransition] = useTransition();
  const [webhookActionKey, setWebhookActionKey] = useState("");
  const [reviewingRecordChangeRequestId, setReviewingRecordChangeRequestId] = useState("");
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTabKey>("access");
  const [selectedObjectId, setSelectedObjectId] = useState("");
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [selectedRelationId, setSelectedRelationId] = useState("");
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [selectedViewId, setSelectedViewId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [objectDraft, setObjectDraft] = useState<ObjectDraft>(emptyObjectDraft());
  const [fieldDraft, setFieldDraft] = useState<FieldDraft>(emptyFieldDraft(props.objects[0]?.key ?? ""));
  const [relationDraft, setRelationDraft] = useState<RelationDraft>(emptyRelationDraft(props.objects[0]?.key ?? ""));
  const [pipelineDraft, setPipelineDraft] = useState<PipelineDraft>(emptyPipelineDraft(props.objects[0]?.key ?? ""));
  const [viewDraft, setViewDraft] = useState<ViewDraft>(emptyViewDraft(props.objects[0]?.key ?? ""));
  const [roleDraft, setRoleDraft] = useState<RoleDraft>(emptyRoleDraft());
  const [userDraft, setUserDraft] = useState<UserDraft>(emptyUserDraft(props.roles[0]?.id ?? "", props.teams[0]?.id ?? ""));
  const [passwordSetupLink, setPasswordSetupLink] = useState<string | null>(null);
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(emptyTeamDraft());
  const [apiKeyDraft, setApiKeyDraft] = useState<ApiKeyDraft>(emptyApiKeyDraft());
  const [createdApiKeyToken, setCreatedApiKeyToken] = useState<string | null>(null);
  const [webhookDraft, setWebhookDraft] = useState<WebhookDraft>(emptyWebhookDraft());
  const [selectedWebhookEditId, setSelectedWebhookEditId] = useState("");
  const [recordChangeRequests, setRecordChangeRequests] = useState<RecordChangeRequest[]>(props.recordChangeRequests);
  const [selectedNotificationChannelId, setSelectedNotificationChannelId] = useState("");
  const [notificationChannelDraft, setNotificationChannelDraft] = useState<NotificationChannelDraft>(emptyNotificationChannelDraft());
  const [poolSettingsDraft, setPoolSettingsDraft] = useState<PoolSettingsDraft>(() => ({
    enabled: props.poolSettings.enabled,
    privateLimit: String(props.poolSettings.privateLimit),
    autoReclaimEnabled: props.poolSettings.autoReclaimEnabled,
    autoReclaimDays: String(props.poolSettings.autoReclaimDays)
  }));
  const [selectedCurrencyId, setSelectedCurrencyId] = useState("");
  const [currencyDraft, setCurrencyDraft] = useState<CurrencyDraft>(emptyCurrencyDraft());
  const [paymentTermOptionsText, setPaymentTermOptionsText] = useState("");
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string | null>(null);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>(props.backupFiles);
  const [webhookDeliveryWebhookId, setWebhookDeliveryWebhookId] = useState(props.webhooks[0]?.id ?? "");
  const [webhookDeliveryStatusFilter, setWebhookDeliveryStatusFilter] = useState<"" | WebhookDeliveryStatus>("");
  const [webhookDeliveryEventFilter, setWebhookDeliveryEventFilter] = useState<"" | WebhookEvent>("");
  const [auditActionFilter, setAuditActionFilter] = useState<"" | AuditLog["action"]>("");
  const [auditEntityFilter, setAuditEntityFilter] = useState("");
  const [auditObjectFilter, setAuditObjectFilter] = useState("");
  const [auditActorFilter, setAuditActorFilter] = useState("");
  const [auditQuery, setAuditQuery] = useState("");

  const canManage = props.role.permissions.includes("crm.admin");
  const selectedObject = props.objects.find((object) => object.id === selectedObjectId);
  const selectedField = props.fields.find((field) => field.id === selectedFieldId);
  const selectedRelation = props.relations.find((relation) => relation.id === selectedRelationId);
  const selectedPipeline = props.pipelines.find((pipeline) => pipeline.id === selectedPipelineId);
  const selectedView = props.savedViews.find((view) => view.id === selectedViewId);
  const selectedRole = props.roles.find((role) => role.id === selectedRoleId);
  const selectedUser = props.users.find((user) => user.id === selectedUserId);
  const selectedTeam = props.teams.find((team) => team.id === selectedTeamId);
  const selectedNotificationChannel = props.notificationChannels.find((channel) => channel.id === selectedNotificationChannelId);
  const selectedWebhookEdit = props.webhooks.find((webhook) => webhook.id === selectedWebhookEditId);
  const currencyRecords = useMemo(() => props.records.filter((record) => record.objectKey === "currencies"), [props.records]);
  const selectedCurrency = currencyRecords.find((currency) => currency.id === selectedCurrencyId);
  const objectFields = useMemo(
    () => props.fields.filter((field) => field.objectKey === fieldDraft.objectKey).sort((a, b) => a.position - b.position),
    [fieldDraft.objectKey, props.fields]
  );
  const viewFields = useMemo(
    () => props.fields.filter((field) => field.objectKey === viewDraft.objectKey).sort((a, b) => a.position - b.position),
    [props.fields, viewDraft.objectKey]
  );
  const viewFieldChoices = useMemo(
    () => [{ id: "standard-ownerId", key: "ownerId", label: "负责人", type: "user" as const }, ...viewFields],
    [viewFields]
  );
  const viewFilterField = viewFieldChoices.find((field) => field.key === viewDraft.filterField);
  const filteredAuditLogs = useMemo(() => {
    const query = auditQuery.trim().toLowerCase();
    return props.auditLogs.filter((log) => {
      if (auditActionFilter && log.action !== auditActionFilter) return false;
      if (auditEntityFilter && log.entityType !== auditEntityFilter) return false;
      if (auditObjectFilter && log.objectKey !== auditObjectFilter) return false;
      if (auditActorFilter && log.actorId !== auditActorFilter) return false;
      if (!query) return true;
      return `${log.summary} ${log.entityType} ${log.entityId ?? ""} ${log.objectKey ?? ""}`.toLowerCase().includes(query);
    });
  }, [auditActionFilter, auditActorFilter, auditEntityFilter, auditObjectFilter, auditQuery, props.auditLogs]);
  const auditEntityTypes = useMemo(() => uniqueSorted(props.auditLogs.map((log) => log.entityType)), [props.auditLogs]);
  const auditObjectKeys = useMemo(() => uniqueSorted(props.auditLogs.map((log) => log.objectKey).filter(Boolean) as string[]), [props.auditLogs]);
  const auditExportUrl = useMemo(
    () =>
      buildAuditExportUrl({
        action: auditActionFilter,
        entityType: auditEntityFilter,
        objectKey: auditObjectFilter,
        actorId: auditActorFilter,
        q: auditQuery
      }),
    [auditActionFilter, auditActorFilter, auditEntityFilter, auditObjectFilter, auditQuery]
  );

  useEffect(() => {
    setPoolSettingsDraft({
      enabled: props.poolSettings.enabled,
      privateLimit: String(props.poolSettings.privateLimit),
      autoReclaimEnabled: props.poolSettings.autoReclaimEnabled,
      autoReclaimDays: String(props.poolSettings.autoReclaimDays)
    });
  }, [props.poolSettings]);
  const fieldObject = props.objects.find((object) => object.key === fieldDraft.objectKey);
  const quotePaymentTermField = props.fields.find((field) => field.objectKey === "quotes" && field.key === "paymentTerm");

  function showToast(nextToast: ToastState) {
    setToast(nextToast);
    window.setTimeout(() => {
      setToast((current) => (current?.message === nextToast.message && current.intent === nextToast.intent ? null : current));
    }, 3600);
  }

  function showError(messageText: string) {
    setError(messageText);
    showToast({ intent: "error", message: messageText });
  }

  function requestConfirm(options: ConfirmDialogState): Promise<boolean> {
    setConfirmDialog(options);
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
    });
  }

  function resolveConfirm(confirmed: boolean) {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmDialog(null);
  }

  useEffect(() => {
    setSelectedObjectId((current) => (current && !props.objects.some((object) => object.id === current) ? "" : current));
  }, [props.objects]);

  useEffect(() => {
    setSelectedRoleId((current) => (props.roles.some((role) => role.id === current) ? current : props.roles[0]?.id ?? ""));
  }, [props.roles]);

  useEffect(() => {
    setSelectedUserId((current) => (props.users.some((user) => user.id === current) ? current : props.users[0]?.id ?? ""));
  }, [props.users]);

  useEffect(() => {
    setSelectedTeamId((current) => (props.teams.some((team) => team.id === current) ? current : props.teams[0]?.id ?? ""));
  }, [props.teams]);

  useEffect(() => {
    setPasswordSetupLink(null);
  }, [selectedUserId]);

  useEffect(() => {
    setBackupFiles(props.backupFiles);
  }, [props.backupFiles]);

  useEffect(() => {
    setWebhookDeliveryWebhookId((current) => (props.webhooks.some((webhook) => webhook.id === current) ? current : props.webhooks[0]?.id ?? ""));
  }, [props.webhooks]);

  useEffect(() => {
    setRecordChangeRequests(props.recordChangeRequests);
  }, [props.recordChangeRequests]);

  useEffect(() => {
    setSelectedNotificationChannelId((current) => (props.notificationChannels.some((channel) => channel.id === current) ? current : ""));
  }, [props.notificationChannels]);

  useEffect(() => {
    setNotificationChannelDraft(selectedNotificationChannel ? notificationChannelDraftFromChannel(selectedNotificationChannel) : emptyNotificationChannelDraft());
  }, [selectedNotificationChannel]);

  useEffect(() => {
    setSelectedCurrencyId((current) => (currencyRecords.some((currency) => currency.id === current) ? current : currencyRecords[0]?.id ?? ""));
  }, [currencyRecords]);

  useEffect(() => {
    setCurrencyDraft(selectedCurrency ? currencyDraftFromRecord(selectedCurrency) : emptyCurrencyDraft());
  }, [selectedCurrency]);

  useEffect(() => {
    setPaymentTermOptionsText(quotePaymentTermField ? formatFieldOptions(quotePaymentTermField) : "");
  }, [quotePaymentTermField]);

  useEffect(() => {
    if (!canManage || !webhookDeliveryWebhookId) {
      setWebhookDeliveries([]);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "50" });
    if (webhookDeliveryStatusFilter) params.set("status", webhookDeliveryStatusFilter);
    if (webhookDeliveryEventFilter) params.set("event", webhookDeliveryEventFilter);

    fetch(`/api/webhooks/${webhookDeliveryWebhookId}/deliveries?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Failed to load webhook deliveries");
        }
        return response.json() as Promise<WebhookDelivery[]>;
      })
      .then(setWebhookDeliveries)
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load webhook deliveries");
      });

    return () => controller.abort();
  }, [canManage, webhookDeliveryEventFilter, webhookDeliveryStatusFilter, webhookDeliveryWebhookId]);

  useEffect(() => {
    if (!selectedObject) {
      setObjectDraft(emptyObjectDraft());
      return;
    }
    setObjectDraft({
      key: selectedObject.key,
      label: selectedObject.label,
      pluralLabel: selectedObject.pluralLabel,
      description: selectedObject.description ?? ""
    });
  }, [selectedObject]);

  useEffect(() => {
    setFieldDraft((current) => {
      if (!selectedField) {
        return emptyFieldDraft(selectedObject?.key ?? current.objectKey ?? props.objects[0]?.key ?? "");
      }
      return {
        objectKey: selectedField.objectKey,
        key: selectedField.key,
        label: selectedField.label,
        type: selectedField.type,
        required: selectedField.required,
        unique: selectedField.unique,
        optionsText: formatFieldOptions(selectedField),
        referenceObjectKey: selectedField.options?.[0]?.value ?? "",
        position: String(selectedField.position)
      };
    });
  }, [props.objects, selectedField, selectedObject?.key]);

  useEffect(() => {
    setRelationDraft(
      selectedRelation
        ? {
            fromObjectKey: selectedRelation.fromObjectKey,
            toObjectKey: selectedRelation.toObjectKey,
            key: selectedRelation.key,
            label: selectedRelation.label,
            cardinality: selectedRelation.cardinality
          }
        : emptyRelationDraft(props.objects[0]?.key ?? "")
    );
  }, [props.objects, selectedRelation]);

  useEffect(() => {
    setPipelineDraft(
      selectedPipeline
        ? {
            objectKey: selectedPipeline.objectKey,
            name: selectedPipeline.name,
            isDefault: selectedPipeline.isDefault,
            stagesText: formatStages(selectedPipeline.stages)
          }
        : emptyPipelineDraft(props.objects[0]?.key ?? "")
    );
  }, [props.objects, selectedPipeline]);

  useEffect(() => {
    if (selectedView) {
      setViewDraft(formatViewDraft(selectedView));
    }
  }, [selectedView]);

  useEffect(() => {
    setRoleDraft(selectedRole ? { name: selectedRole.name, permissions: selectedRole.permissions } : emptyRoleDraft());
  }, [selectedRole]);

  useEffect(() => {
    setUserDraft(
      selectedUser
        ? {
            email: selectedUser.email,
            name: selectedUser.name,
            roleId: selectedUser.roleId,
            teamId: selectedUser.teamId ?? "",
            password: "",
            active: selectedUser.active
          }
        : emptyUserDraft(props.roles[0]?.id ?? "", props.teams[0]?.id ?? "")
    );
  }, [props.roles, props.teams, selectedUser]);

  useEffect(() => {
    setTeamDraft(selectedTeam ? { name: selectedTeam.name } : emptyTeamDraft());
  }, [selectedTeam]);

  function resetObjectForm() {
    setSelectedObjectId("");
    setObjectDraft(emptyObjectDraft());
  }

  function resetFieldForm() {
    setSelectedFieldId("");
    setFieldDraft(emptyFieldDraft(selectedObject?.key ?? props.objects[0]?.key ?? ""));
  }

  function resetRelationForm() {
    setSelectedRelationId("");
    setRelationDraft(emptyRelationDraft(props.objects[0]?.key ?? ""));
  }

  function resetPipelineForm() {
    setSelectedPipelineId("");
    setPipelineDraft(emptyPipelineDraft(props.objects[0]?.key ?? ""));
  }

  function resetViewForm() {
    setSelectedViewId("");
    setViewDraft(emptyViewDraft(props.objects[0]?.key ?? ""));
  }

  function resetRoleForm() {
    setSelectedRoleId("");
    setRoleDraft(emptyRoleDraft());
  }

  function resetUserForm() {
    setSelectedUserId("");
    setUserDraft(emptyUserDraft(props.roles[0]?.id ?? "", props.teams[0]?.id ?? ""));
    setPasswordSetupLink(null);
  }

  function resetTeamForm() {
    setSelectedTeamId("");
    setTeamDraft(emptyTeamDraft());
  }

  function resetApiKeyForm() {
    setApiKeyDraft(emptyApiKeyDraft());
    setCreatedApiKeyToken(null);
  }

  function resetWebhookForm() {
    setWebhookDraft(emptyWebhookDraft());
    setSelectedWebhookEditId("");
    setCreatedWebhookSecret(null);
  }

  function resetNotificationChannelForm() {
    setSelectedNotificationChannelId("");
    setNotificationChannelDraft(emptyNotificationChannelDraft());
  }

  function resetCurrencyForm() {
    setSelectedCurrencyId("");
    setCurrencyDraft(emptyCurrencyDraft());
  }

  function runAction(action: () => Promise<void>) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (actionError) {
        showError(actionError instanceof Error ? actionError.message : "操作失败");
      }
    });
  }

  async function runWebhookAction(actionKey: string, action: () => Promise<void>) {
    setMessage(null);
    setError(null);
    setWebhookActionKey(actionKey);
    try {
      await action();
      router.refresh();
    } catch (actionError) {
      showError(actionError instanceof Error ? actionError.message : "Webhook 操作失败");
    } finally {
      setWebhookActionKey("");
    }
  }

  async function saveObject() {
    if (selectedObject) {
      await fetchJson(`/api/object-definitions/${selectedObject.id}`, {
        method: "PATCH",
        body: {
          label: objectDraft.label.trim(),
          pluralLabel: objectDraft.pluralLabel.trim(),
          description: objectDraft.description.trim() || undefined
        }
      });
      setMessage(`已更新对象 ${objectDraft.label.trim()}`);
      return;
    }

    await fetchJson("/api/object-definitions", {
      method: "POST",
      body: {
        key: objectDraft.key.trim(),
        label: objectDraft.label.trim(),
        pluralLabel: objectDraft.pluralLabel.trim(),
        description: objectDraft.description.trim() || undefined
      }
    });
    setMessage(`已创建对象 ${objectDraft.label.trim()}`);
    resetObjectForm();
  }

  async function deleteObject() {
    if (!selectedObject) return;
    if (!(await requestConfirm({ title: "删除对象", message: `确定删除对象“${selectedObject.label}”？这会删除该对象的字段、关系、管道和视图配置。`, confirmLabel: "删除", danger: true }))) return;
    await fetchJson(`/api/object-definitions/${selectedObject.id}`, { method: "DELETE" });
    setMessage(`已删除对象 ${selectedObject.label}`);
    resetObjectForm();
  }

  async function saveField() {
    const options = parseFieldOptions(fieldDraft, props.objects);
    const payload = {
      objectKey: fieldDraft.objectKey,
      key: fieldDraft.key.trim(),
      label: fieldDraft.label.trim(),
      type: fieldDraft.type,
      required: fieldDraft.required,
      unique: fieldDraft.unique,
      options,
      position: Number(fieldDraft.position) || undefined
    };

    if (selectedField) {
      await fetchJson(`/api/field-definitions/${selectedField.id}`, {
        method: "PATCH",
        body: {
          label: payload.label,
          required: payload.required,
          unique: payload.unique,
          options: payload.options,
          position: payload.position
        }
      });
      setMessage(`已更新字段 ${payload.label}`);
      return;
    }

    await fetchJson("/api/field-definitions", { method: "POST", body: payload });
    setMessage(`已创建字段 ${payload.label}`);
    resetFieldForm();
  }

  async function deleteField() {
    if (!selectedField) return;
    if (!(await requestConfirm({ title: "删除字段", message: `确定删除字段“${selectedField.label}”？`, confirmLabel: "删除", danger: true }))) return;
    await fetchJson(`/api/field-definitions/${selectedField.id}`, { method: "DELETE" });
    setMessage(`已删除字段 ${selectedField.label}`);
    resetFieldForm();
  }

  async function saveRelation() {
    const payload = {
      fromObjectKey: relationDraft.fromObjectKey,
      toObjectKey: relationDraft.toObjectKey,
      key: relationDraft.key.trim(),
      label: relationDraft.label.trim(),
      cardinality: relationDraft.cardinality
    };

    if (selectedRelation) {
      await fetchJson(`/api/relation-definitions/${selectedRelation.id}`, { method: "PATCH", body: payload });
      setMessage(`已更新关系 ${payload.label}`);
      return;
    }

    await fetchJson("/api/relation-definitions", { method: "POST", body: payload });
    setMessage(`已创建关系 ${payload.label}`);
    resetRelationForm();
  }

  async function deleteRelation() {
    if (!selectedRelation) return;
    if (!(await requestConfirm({ title: "删除关系", message: `确定删除关系“${selectedRelation.label}”？`, confirmLabel: "删除", danger: true }))) return;
    await fetchJson(`/api/relation-definitions/${selectedRelation.id}`, { method: "DELETE" });
    setMessage(`已删除关系 ${selectedRelation.label}`);
    resetRelationForm();
  }

  async function savePipeline() {
    const payload = {
      objectKey: pipelineDraft.objectKey,
      name: pipelineDraft.name.trim(),
      isDefault: pipelineDraft.isDefault,
      stages: parseStages(pipelineDraft.stagesText)
    };

    if (selectedPipeline) {
      await fetchJson(`/api/pipelines/${selectedPipeline.id}`, { method: "PATCH", body: payload });
      setMessage(`已更新管道 ${payload.name}`);
      return;
    }

    await fetchJson("/api/pipelines", { method: "POST", body: payload });
    setMessage(`已创建管道 ${payload.name}`);
    resetPipelineForm();
  }

  async function deletePipeline() {
    if (!selectedPipeline) return;
    if (!(await requestConfirm({ title: "删除管道", message: `确定删除管道“${selectedPipeline.name}”？`, confirmLabel: "删除", danger: true }))) return;
    await fetchJson(`/api/pipelines/${selectedPipeline.id}`, { method: "DELETE" });
    setMessage(`已删除管道 ${selectedPipeline.name}`);
    resetPipelineForm();
  }

  async function saveView() {
    const payload = {
      objectKey: viewDraft.objectKey,
      name: viewDraft.name.trim(),
      columns: viewDraft.columnsText
        .split(",")
        .map((column) => column.trim())
        .filter(Boolean),
      filters:
        viewDraft.filterField && viewDraft.filterValue.trim()
          ? [{ field: viewDraft.filterField, operator: viewDraft.filterOperator, value: viewDraft.filterValue.trim() }]
          : undefined,
      sort: viewDraft.sortField ? { field: viewDraft.sortField, direction: viewDraft.sortDirection } : undefined,
      isDefault: viewDraft.isDefault
    };

    if (selectedView) {
      await fetchJson(`/api/saved-views/${selectedView.id}`, { method: "PATCH", body: payload });
      setMessage(`已更新视图 ${payload.name}`);
      return;
    }

    await fetchJson("/api/saved-views", { method: "POST", body: payload });
    setMessage(`已创建视图 ${payload.name}`);
    resetViewForm();
  }

  async function deleteView() {
    if (!selectedView) return;
    if (!(await requestConfirm({ title: "删除视图", message: `确定删除视图“${selectedView.name}”？`, confirmLabel: "删除", danger: true }))) return;
    await fetchJson(`/api/saved-views/${selectedView.id}`, { method: "DELETE" });
    setMessage(`已删除视图 ${selectedView.name}`);
    resetViewForm();
  }

  async function saveRole() {
    const payload = {
      name: roleDraft.name.trim(),
      permissions: roleDraft.permissions
    };

    if (selectedRole) {
      await fetchJson(`/api/roles/${selectedRole.id}`, { method: "PATCH", body: payload });
      setMessage(`已更新角色 ${payload.name}`);
      return;
    }

    await fetchJson("/api/roles", { method: "POST", body: payload });
    setMessage(`已创建角色 ${payload.name}`);
    resetRoleForm();
  }

  async function deleteRole() {
    if (!selectedRole) return;
    if (!(await requestConfirm({ title: "删除角色", message: `确定删除角色“${selectedRole.name}”？`, confirmLabel: "删除", danger: true }))) return;
    await fetchJson(`/api/roles/${selectedRole.id}`, { method: "DELETE" });
    setMessage(`已删除角色 ${selectedRole.name}`);
    resetRoleForm();
  }

  function toggleRolePermission(permission: Permission, enabled: boolean) {
    setRoleDraft((current) => ({
      ...current,
      permissions: enabled
        ? Array.from(new Set([...current.permissions, permission]))
        : current.permissions.filter((candidate) => candidate !== permission)
    }));
  }

  async function saveUser() {
    if (
      selectedUser?.active &&
      !userDraft.active &&
      !(await requestConfirm({ title: "停用用户", message: `确定停用用户“${selectedUser.email}”？该用户会立即失去访问权限。`, confirmLabel: "停用", danger: true }))
    ) {
      return;
    }

    const payload = {
      email: userDraft.email.trim(),
      name: userDraft.name.trim(),
      roleId: userDraft.roleId,
      teamId: userDraft.teamId || undefined,
      active: userDraft.active,
      ...(userDraft.password.trim() ? { password: userDraft.password.trim() } : {})
    };

    if (selectedUser) {
      await fetchJson(`/api/users/${selectedUser.id}`, { method: "PATCH", body: payload });
      setMessage(`已更新用户 ${payload.email}`);
      return;
    }

    await fetchJson("/api/users", {
      method: "POST",
      body: {
        ...payload,
        password: userDraft.password.trim()
      }
    });
    setMessage(`已创建用户 ${payload.email}`);
    resetUserForm();
  }

  async function generatePasswordSetupLink() {
    if (!selectedUser) return;
    const result = await fetchJson<{ url: string; expiresAt: string }>(`/api/users/${selectedUser.id}/password-link`, {
      method: "POST",
      body: { purpose: "reset" }
    });
    setPasswordSetupLink(result.url);
    setMessage(`已生成 ${selectedUser.email} 的一次性密码设置链接`);
  }

  async function saveTeam() {
    const payload = {
      name: teamDraft.name.trim()
    };

    if (selectedTeam) {
      await fetchJson(`/api/teams/${selectedTeam.id}`, { method: "PATCH", body: payload });
      setMessage(`已更新团队 ${payload.name}`);
      return;
    }

    await fetchJson("/api/teams", { method: "POST", body: payload });
    setMessage(`已创建团队 ${payload.name}`);
    resetTeamForm();
  }

  async function deleteTeam() {
    if (!selectedTeam) return;
    if (!(await requestConfirm({ title: "删除团队", message: `确定删除团队“${selectedTeam.name}”？`, confirmLabel: "删除", danger: true }))) return;
    await fetchJson(`/api/teams/${selectedTeam.id}`, { method: "DELETE" });
    setMessage(`已删除团队 ${selectedTeam.name}`);
    resetTeamForm();
  }

  function toggleApiKeyPermission(permission: Permission, enabled: boolean) {
    setApiKeyDraft((current) => ({
      ...current,
      permissions: enabled
        ? Array.from(new Set([...current.permissions, permission]))
        : current.permissions.filter((candidate) => candidate !== permission)
    }));
  }

  async function createApiKey() {
    const result = await fetchJson<CreatedApiKey>("/api/api-keys", {
      method: "POST",
      body: {
        name: apiKeyDraft.name.trim(),
        permissions: apiKeyDraft.permissions,
        expiresAt: apiKeyDraft.expiresAt || undefined
      }
    });
    setCreatedApiKeyToken(result.token);
    setMessage(`Created API key ${result.apiKey.name}. Copy the token now; it will not be shown again.`);
    setApiKeyDraft(emptyApiKeyDraft());
  }

  async function revokeApiKey(apiKey: ApiKey) {
    if (!(await requestConfirm({ title: "撤销 API Key", message: `确定撤销 API Key“${apiKey.name}”？撤销后使用该 token 的集成会立即失效。`, confirmLabel: "撤销", danger: true }))) return;
    await fetchJson(`/api/api-keys/${apiKey.id}`, { method: "PATCH", body: { action: "revoke" } });
    setMessage(`Revoked API key ${apiKey.name}`);
    setCreatedApiKeyToken(null);
  }

  function toggleWebhookEvent(event: WebhookEvent, enabled: boolean) {
    setWebhookDraft((current) => ({
      ...current,
      events: enabled ? Array.from(new Set([...current.events, event])) : current.events.filter((candidate) => candidate !== event)
    }));
  }

  function editWebhook(webhook: WebhookEndpoint) {
    setSelectedWebhookEditId(webhook.id);
    setWebhookDraft({
      name: webhook.name,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active
    });
    setCreatedWebhookSecret(null);
  }

  async function saveWebhook() {
    if (selectedWebhookEditId) {
      await fetchJson<WebhookEndpoint>(`/api/webhooks/${selectedWebhookEditId}`, {
        method: "PATCH",
        body: webhookDraft
      });
      setMessage(`Webhook 已更新：${webhookDraft.name}`);
      router.refresh();
      return;
    }
    const result = await fetchJson<CreatedWebhookEndpoint>("/api/webhooks", {
      method: "POST",
      body: webhookDraft
    });
    setCreatedWebhookSecret(result.secret);
    setMessage(`Created webhook ${result.webhook.name}. Copy the signing secret now; it will not be shown again.`);
    setWebhookDraft(emptyWebhookDraft());
    router.refresh();
  }

  async function deleteWebhook(webhook: WebhookEndpoint) {
    if (!(await requestConfirm({ title: "删除 Webhook", message: `确定删除 Webhook“${webhook.name}”？已有投递记录也会被清理。`, confirmLabel: "删除", danger: true }))) return;
    await fetchJson(`/api/webhooks/${webhook.id}`, { method: "DELETE" });
    if (selectedWebhookEditId === webhook.id) {
      resetWebhookForm();
    }
    setMessage(`Webhook 已删除：${webhook.name}`);
    router.refresh();
  }

  async function toggleWebhook(webhook: WebhookEndpoint) {
    if (webhook.active && !(await requestConfirm({ title: "停用 Webhook", message: `确定停用 Webhook“${webhook.name}”？相关集成将不再收到事件。`, confirmLabel: "停用", danger: true }))) return;
    await fetchJson(`/api/webhooks/${webhook.id}`, { method: "PATCH", body: { active: !webhook.active } });
    setMessage(`${webhook.active ? "Disabled" : "Enabled"} webhook ${webhook.name}`);
    router.refresh();
  }

  async function testWebhook(webhook: WebhookEndpoint) {
    const delivery = await fetchJson<WebhookDelivery>(`/api/webhooks/${webhook.id}/test`, { method: "POST" });
    setWebhookDeliveryWebhookId(webhook.id);
    setWebhookDeliveries((current) => [delivery, ...current.filter((candidate) => candidate.id !== delivery.id)].slice(0, 20));
    setMessage(`Webhook test ${delivery.status}: ${delivery.responseStatus ?? delivery.errorMessage ?? "no response"}`);
  }
  async function handleSaveWebhook() {
    await runWebhookAction(selectedWebhookEditId ? `save:${selectedWebhookEditId}` : "create", async () => {
      if (selectedWebhookEditId) {
        await fetchJson<WebhookEndpoint>(`/api/webhooks/${selectedWebhookEditId}`, {
          method: "PATCH",
          body: webhookDraft
        });
        setMessage(`Webhook 已更新：${webhookDraft.name}`);
        return;
      }
      const result = await fetchJson<CreatedWebhookEndpoint>("/api/webhooks", {
        method: "POST",
        body: webhookDraft
      });
      setCreatedWebhookSecret(result.secret);
      setMessage(`Created webhook ${result.webhook.name}. Copy the signing secret now; it will not be shown again.`);
      setWebhookDraft(emptyWebhookDraft());
    });
  }

  async function handleDeleteWebhook(webhook: WebhookEndpoint) {
    if (!(await requestConfirm({ title: "删除 Webhook", message: `确定删除 Webhook“${webhook.name}”？已有投递记录也会被清理。`, confirmLabel: "删除", danger: true }))) return;
    await runWebhookAction(`delete:${webhook.id}`, async () => {
      await fetchJson(`/api/webhooks/${webhook.id}`, { method: "DELETE" });
      if (selectedWebhookEditId === webhook.id) {
        resetWebhookForm();
      }
      setMessage(`Webhook 已删除：${webhook.name}`);
    });
  }

  async function handleToggleWebhook(webhook: WebhookEndpoint) {
    if (webhook.active && !(await requestConfirm({ title: "停用 Webhook", message: `确定停用 Webhook“${webhook.name}”？相关集成将不再收到事件。`, confirmLabel: "停用", danger: true }))) return;
    await runWebhookAction(`toggle:${webhook.id}`, async () => {
      await fetchJson(`/api/webhooks/${webhook.id}`, { method: "PATCH", body: { active: !webhook.active } });
      setMessage(`${webhook.active ? "Disabled" : "Enabled"} webhook ${webhook.name}`);
    });
  }

  async function handleTestWebhook(webhook: WebhookEndpoint) {
    await runWebhookAction(`test:${webhook.id}`, async () => {
      const delivery = await fetchJson<WebhookDelivery>(`/api/webhooks/${webhook.id}/test`, { method: "POST" });
      setWebhookDeliveryWebhookId(webhook.id);
      setWebhookDeliveries((current) => [delivery, ...current.filter((candidate) => candidate.id !== delivery.id)].slice(0, 20));
      setMessage(`Webhook test ${delivery.status}: ${delivery.responseStatus ?? delivery.errorMessage ?? "no response"}`);
    });
  }

  async function reviewRecordChangeRequest(request: RecordChangeRequest, decision: "approve" | "reject") {
    const actionLabel = request.action === "delete" ? "\u5220\u9664" : "\u4fee\u6539";
    const confirmed = await requestConfirm(
      decision === "reject"
        ? {
            title: "\u62d2\u7edd\u5ba1\u6279",
            message: `\u786e\u5b9a\u62d2\u7edd\u201c${request.recordTitle}\u201d\u7684${actionLabel}\u7533\u8bf7\uff1f`,
            confirmLabel: "\u62d2\u7edd",
            danger: true
          }
        : {
            title: "\u901a\u8fc7\u5ba1\u6279",
            message:
              request.action === "delete"
                ? `\u786e\u5b9a\u901a\u8fc7\u201c${request.recordTitle}\u201d\u7684\u5220\u9664\u7533\u8bf7\uff1f\u901a\u8fc7\u540e\u8bb0\u5f55\u4f1a\u88ab\u6b63\u5f0f\u5220\u9664\u3002`
                : `\u786e\u5b9a\u901a\u8fc7\u201c${request.recordTitle}\u201d\u7684\u4fee\u6539\u7533\u8bf7\uff1f`,
            confirmLabel: "\u901a\u8fc7"
          }
    );
    if (!confirmed) return;
    setMessage(null);
    setError(null);
    setReviewingRecordChangeRequestId(request.id);
    try {
      const updated = await fetchJson<RecordChangeRequest>(`/api/record-change-requests/${request.id}`, {
        method: "PATCH",
        body: { decision }
      });
      setRecordChangeRequests((current) => current.map((candidate) => (candidate.id === updated.id ? updated : candidate)).filter((candidate) => candidate.status === "pending"));
      setMessage(decision === "approve" ? "\u5ba1\u6279\u5df2\u901a\u8fc7" : "\u5ba1\u6279\u5df2\u62d2\u7edd");
      router.refresh();
    } catch (actionError) {
      showError(actionError instanceof Error ? actionError.message : "\u5ba1\u6279\u64cd\u4f5c\u5931\u8d25");
    } finally {
      setReviewingRecordChangeRequestId("");
    }
  }

  async function retryWebhookDelivery(delivery: WebhookDelivery) {
    const retried = await fetchJson<WebhookDelivery>(`/api/webhooks/${delivery.webhookId}/deliveries/${delivery.id}/retry`, { method: "POST" });
    setWebhookDeliveryWebhookId(delivery.webhookId);
    setWebhookDeliveries((current) => [retried, ...current.filter((candidate) => candidate.id !== retried.id)].slice(0, 50));
    setMessage(`Webhook retry ${retried.status}: ${retried.responseStatus ?? retried.errorMessage ?? "no response"}`);
  }

  function toggleNotificationChannelEvent(event: WebhookEvent, enabled: boolean) {
    setNotificationChannelDraft((current) => ({
      ...current,
      events: enabled ? Array.from(new Set([...current.events, event])) : current.events.filter((candidate) => candidate !== event)
    }));
  }

  async function saveNotificationChannel() {
    const payload = notificationChannelPayload(notificationChannelDraft);
    if (selectedNotificationChannel) {
      await fetchJson(`/api/notification-channels/${selectedNotificationChannel.id}`, { method: "PATCH", body: payload });
      setMessage(`已更新通知渠道 ${payload.name}`);
      return;
    }
    await fetchJson("/api/notification-channels", { method: "POST", body: payload });
    setMessage(`已创建通知渠道 ${payload.name}`);
    setNotificationChannelDraft(emptyNotificationChannelDraft());
  }

  async function deleteNotificationChannel() {
    if (!selectedNotificationChannel) return;
    if (!(await requestConfirm({ title: "删除通知渠道", message: `确定删除通知渠道“${selectedNotificationChannel.name}”？`, confirmLabel: "删除", danger: true }))) return;
    await fetchJson(`/api/notification-channels/${selectedNotificationChannel.id}`, { method: "DELETE" });
    setMessage(`已删除通知渠道 ${selectedNotificationChannel.name}`);
    setSelectedNotificationChannelId("");
    setNotificationChannelDraft(emptyNotificationChannelDraft());
  }

  async function saveCurrency() {
    const code = normalizeCurrencyCode(currencyDraft.code);
    const label = currencyDraft.label.trim();
    const rateToBase = currencyDraft.isBase ? 1 : Number(currencyDraft.rateToBase);
    if (!code || !label || !Number.isFinite(rateToBase) || rateToBase <= 0) {
      throw new Error("币种代码、名称和汇率必须有效");
    }

    if (currencyDraft.isBase) {
      await Promise.all(
        currencyRecords
          .filter((currency) => currency.id !== selectedCurrency?.id && currency.data.isBase === true)
          .map((currency) =>
            fetchJson(`/api/records/currencies/${currency.id}`, {
              method: "PATCH",
              body: { data: { ...currency.data, isBase: false, rateToBase: Number(currency.data.rateToBase) || 1 } }
            })
          )
      );
    }

    const data = {
      code,
      label,
      symbol: currencyDraft.symbol.trim(),
      rateToBase,
      isBase: currencyDraft.isBase,
      active: currencyDraft.active
    };

    if (selectedCurrency) {
      await fetchJson(`/api/records/currencies/${selectedCurrency.id}`, {
        method: "PATCH",
        body: { title: `${code} · ${label}`, data }
      });
      setMessage(`已更新币种 ${code}`);
      return;
    }

    await fetchJson("/api/records/currencies", {
      method: "POST",
      body: { title: `${code} · ${label}`, data }
    });
    setMessage(`已创建币种 ${code}`);
    resetCurrencyForm();
  }

  async function savePaymentTermOptions() {
    if (!quotePaymentTermField) {
      throw new Error("未找到报价 Payment term 字段");
    }
    const options = parseSelectOptionsText(paymentTermOptionsText);
    if (!options.length) {
      throw new Error("Payment term 至少需要一个可选项");
    }
    await fetchJson(`/api/field-definitions/${quotePaymentTermField.id}`, {
      method: "PATCH",
      body: {
        label: quotePaymentTermField.label,
        required: quotePaymentTermField.required,
        unique: quotePaymentTermField.unique,
        options,
        position: quotePaymentTermField.position
      }
    });
    setMessage("Payment term 选项已更新");
  }

  async function deleteCurrency() {
    if (!selectedCurrency) return;
    if (selectedCurrency.data.isBase === true) {
      throw new Error("不能删除基准币种，请先指定其他基准币种");
    }
    if (!(await requestConfirm({ title: "删除币种", message: `确定删除币种“${selectedCurrency.title}”？已有产品或报价引用该币种时会保留原代码。`, confirmLabel: "删除", danger: true }))) return;
    await fetchJson(`/api/records/currencies/${selectedCurrency.id}`, { method: "DELETE" });
    setMessage(`已删除币种 ${selectedCurrency.title}`);
    resetCurrencyForm();
  }

  async function createBackup() {
    const result = await fetchJson<BackupRunResult>("/api/backups", { method: "POST" });
    const files = await fetchJson<BackupFile[]>("/api/backups", { method: "GET" });
    setBackupFiles(files);
    setMessage(result.backup ? `Created backup ${result.backup.name}` : "Backup command completed");
  }

  async function savePoolSettings() {
    const privateLimit = Number.parseInt(poolSettingsDraft.privateLimit, 10);
    const autoReclaimDays = Number.parseInt(poolSettingsDraft.autoReclaimDays, 10);
    if (!Number.isFinite(privateLimit) || privateLimit < 1) {
      throw new Error("私海上限必须大于 0");
    }
    if (!Number.isFinite(autoReclaimDays) || autoReclaimDays < 1) {
      throw new Error("自动回收天数必须大于 0");
    }
    await fetchJson<CrmPoolSettings>("/api/pool-settings", {
      method: "PATCH",
      body: {
        enabled: poolSettingsDraft.enabled,
        privateLimit,
        autoReclaimEnabled: poolSettingsDraft.autoReclaimEnabled,
        autoReclaimDays
      }
    });
    setMessage("公海规则已保存");
  }

  if (!canManage) {
    return (
      <section className="settings-panel">
        <h2 className="page-title">管理员设置</h2>
        <div className="empty-state">当前账号没有 crm.admin 权限，不能配置对象、字段、关系、管道和视图。</div>
      </section>
    );
  }

  return (
    <div className="settings-stack">
      <section className="settings-tabs-shell" aria-label="设置分类">
        <div className="settings-tab-list" role="tablist" aria-label="设置分类">
          {[...settingsTabs.slice(0, 2), { key: "pool" as SettingsTabKey, label: "公海规则", description: "联系人和公司的领取、释放、私海上限与自动回收" }, ...settingsTabs.slice(2)].map((tab) => (
            <button
              key={tab.key}
              className={`settings-tab-button ${activeSettingsTab === tab.key ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeSettingsTab === tab.key}
              onClick={() => setActiveSettingsTab(tab.key)}
            >
              <strong>{tab.label}</strong>
              <span>{tab.description}</span>
            </button>
          ))}
        </div>
      </section>

      {activeSettingsTab === "access" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <UserTeamAdminPanel
            users={props.users}
            teams={props.teams}
            roles={props.roles}
            selectedUserId={selectedUserId}
            selectedUser={selectedUser}
            selectedTeamId={selectedTeamId}
            selectedTeam={selectedTeam}
            userDraft={userDraft}
            passwordSetupLink={passwordSetupLink}
            teamDraft={teamDraft}
            isPending={isPending}
            onSelectUser={setSelectedUserId}
            onSelectTeam={setSelectedTeamId}
            onNewUser={resetUserForm}
            onNewTeam={resetTeamForm}
            onUserChange={(patch) => setUserDraft((current) => ({ ...current, ...patch }))}
            onTeamNameChange={(name) => setTeamDraft({ name })}
            onSaveUser={() => runAction(saveUser)}
            onGeneratePasswordLink={() => runAction(generatePasswordSetupLink)}
            onSaveTeam={() => runAction(saveTeam)}
            onDeleteTeam={() => runAction(deleteTeam)}
          />

          <RoleAdminPanel
            roles={props.roles}
            selectedRoleId={selectedRoleId}
            selectedRole={selectedRole}
            roleDraft={roleDraft}
            users={props.users}
            isPending={isPending}
            currentRoleId={props.role.id}
            onSelectRole={setSelectedRoleId}
            onNewRole={resetRoleForm}
            onNameChange={(name) => setRoleDraft((current) => ({ ...current, name }))}
            onTogglePermission={toggleRolePermission}
            onSave={() => runAction(saveRole)}
            onDelete={() => runAction(deleteRole)}
          />

          <PermissionMatrix roles={props.roles} currentRoleId={props.role.id} />
        </div>
      ) : null}

      {activeSettingsTab === "crm" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <CurrencyAdminPanel
            currencies={currencyRecords}
            draft={currencyDraft}
            selectedCurrencyId={selectedCurrencyId}
            selectedCurrency={selectedCurrency}
            isPending={isPending}
            onSelectCurrency={setSelectedCurrencyId}
            onDraftChange={(patch) => setCurrencyDraft((current) => ({ ...current, ...patch }))}
            onNew={resetCurrencyForm}
            onSave={() => runAction(saveCurrency)}
            onDelete={() => runAction(deleteCurrency)}
          />
          <PaymentTermAdminPanel
            field={quotePaymentTermField}
            isPending={isPending}
            optionsText={paymentTermOptionsText}
            onChange={setPaymentTermOptionsText}
            onSave={() => runAction(savePaymentTermOptions)}
          />
        </div>
      ) : null}

      {activeSettingsTab === "pool" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <section className="settings-panel">
            <div className="settings-panel-header">
              <div>
                <h2 className="page-title">公海规则</h2>
                <div className="subtle">首版仅作用于联系人和公司。ownerId 为空表示公海，有负责人表示私海。</div>
              </div>
              <span className="badge">contacts / companies</span>
            </div>
            <div className="form-grid">
              <label>
                <span className="subtle">启用公海/私海</span>
                <select
                  className="select"
                  value={poolSettingsDraft.enabled ? "1" : "0"}
                  onChange={(event) => setPoolSettingsDraft((current) => ({ ...current, enabled: event.target.value === "1" }))}
                >
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </select>
              </label>
              <label>
                <span className="subtle">每人私海上限</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={poolSettingsDraft.privateLimit}
                  onChange={(event) => setPoolSettingsDraft((current) => ({ ...current, privateLimit: event.target.value }))}
                />
              </label>
              <label>
                <span className="subtle">启用自动回收</span>
                <select
                  className="select"
                  value={poolSettingsDraft.autoReclaimEnabled ? "1" : "0"}
                  onChange={(event) => setPoolSettingsDraft((current) => ({ ...current, autoReclaimEnabled: event.target.value === "1" }))}
                >
                  <option value="1">启用</option>
                  <option value="0">停用</option>
                </select>
              </label>
              <label>
                <span className="subtle">未跟进回收天数</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={poolSettingsDraft.autoReclaimDays}
                  onChange={(event) => setPoolSettingsDraft((current) => ({ ...current, autoReclaimDays: event.target.value }))}
                />
              </label>
            </div>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button className="primary-button" type="button" onClick={() => runAction(savePoolSettings)} disabled={isPending}>
                <Save size={16} />
                保存公海规则
              </button>
              <span className="subtle">
                最近回收：
                {props.poolSettings.lastAutoReclaimAt ? `${props.poolSettings.lastAutoReclaimCount} 条 · ${props.poolSettings.lastAutoReclaimAt}` : "尚未执行"}
              </span>
            </div>
          </section>
        </div>
      ) : null}

      {activeSettingsTab === "integrations" ? (
        <div className="settings-tab-panel" role="tabpanel">
          <ApiKeyAdminPanel
            apiKeys={props.apiKeys}
            users={props.users}
            draft={apiKeyDraft}
            createdToken={createdApiKeyToken}
            isPending={isPending}
            onDraftChange={(patch) => setApiKeyDraft((current) => ({ ...current, ...patch }))}
            onTogglePermission={toggleApiKeyPermission}
            onCreate={() => runAction(createApiKey)}
            onRevoke={(apiKey) => runAction(() => revokeApiKey(apiKey))}
            onClearToken={() => setCreatedApiKeyToken(null)}
            onReset={resetApiKeyForm}
          />

          <WebhookAdminPanel
            webhooks={props.webhooks}
            objects={props.objects}
            users={props.users}
            draft={webhookDraft}
            selectedWebhook={selectedWebhookEdit}
            createdSecret={createdWebhookSecret}
            deliveries={webhookDeliveries}
            selectedWebhookId={webhookDeliveryWebhookId}
            statusFilter={webhookDeliveryStatusFilter}
            eventFilter={webhookDeliveryEventFilter}
            isPending={isPending}
            actionKey={webhookActionKey}
            onDraftChange={(patch) => setWebhookDraft((current) => ({ ...current, ...patch }))}
            onToggleEvent={toggleWebhookEvent}
            onCreate={() => { void handleSaveWebhook(); }}
            onEdit={editWebhook}
            onDelete={(webhook) => { void handleDeleteWebhook(webhook); }}
            onToggle={(webhook) => { void handleToggleWebhook(webhook); }}
            onTest={(webhook) => { void handleTestWebhook(webhook); }}
            onRetryDelivery={(delivery) => runAction(() => retryWebhookDelivery(delivery))}
            onSelectDeliveryWebhook={setWebhookDeliveryWebhookId}
            onStatusFilterChange={setWebhookDeliveryStatusFilter}
            onEventFilterChange={setWebhookDeliveryEventFilter}
            onClearSecret={() => setCreatedWebhookSecret(null)}
            onReset={resetWebhookForm}
          />

          <NotificationChannelAdminPanel
            channels={props.notificationChannels}
            emailAccounts={props.emailAccounts}
            users={props.users}
            draft={notificationChannelDraft}
            selectedChannelId={selectedNotificationChannelId}
            selectedChannel={selectedNotificationChannel}
            isPending={isPending}
            onDraftChange={(patch) => setNotificationChannelDraft((current) => ({ ...current, ...patch }))}
            onToggleEvent={toggleNotificationChannelEvent}
            onSelect={setSelectedNotificationChannelId}
            onNew={resetNotificationChannelForm}
            onSave={() => runAction(saveNotificationChannel)}
            onDelete={() => runAction(deleteNotificationChannel)}
          />
        </div>
      ) : null}

      {activeSettingsTab === "crm" ? (
        <div className="settings-grid settings-grid-wide">
          <section className="settings-panel">
          <div className="settings-panel-header">
            <div>
              <h2 className="page-title">对象与字段</h2>
              <div className="subtle">对象定义、自定义字段和字段类型配置</div>
            </div>
            <button className="secondary-button" data-testid="settings-new-object" type="button" onClick={resetObjectForm} disabled={isPending}>
              <Plus size={16} />
              新建对象
            </button>
          </div>

          <div className="settings-editor-grid">
            <div className="settings-list">
              {props.objects.map((object) => (
                <button
                  key={object.id}
                  className={`settings-item settings-select ${selectedObjectId === object.id ? "selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedObjectId(object.id)}
                >
                  <div className="stage-header">
                    <strong>{object.label}</strong>
                    <span className="badge">{object.isSystem ? "系统" : "自定义"}</span>
                  </div>
                  <div className="subtle">{object.key}</div>
                </button>
              ))}
            </div>

            <div className="settings-editor">
              <div className="form-grid">
                <label>
                  <span className="subtle">对象 key</span>
                  <input
                    className="input"
                    data-testid="settings-object-key"
                    value={objectDraft.key}
                    onChange={(event) => setObjectDraft((current) => ({ ...current, key: event.target.value }))}
                    disabled={Boolean(selectedObject)}
                  />
                </label>
                <label>
                  <span className="subtle">单数名称</span>
                  <input
                    className="input"
                    data-testid="settings-object-label"
                    value={objectDraft.label}
                    onChange={(event) => setObjectDraft((current) => ({ ...current, label: event.target.value }))}
                  />
                </label>
                <label>
                  <span className="subtle">复数名称</span>
                  <input
                    className="input"
                    data-testid="settings-object-plural-label"
                    value={objectDraft.pluralLabel}
                    onChange={(event) => setObjectDraft((current) => ({ ...current, pluralLabel: event.target.value }))}
                  />
                </label>
                <label className="wide">
                  <span className="subtle">描述</span>
                  <textarea
                    className="textarea"
                    data-testid="settings-object-description"
                    value={objectDraft.description}
                    onChange={(event) => setObjectDraft((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
              </div>

              <div className="toolbar" style={{ marginTop: 12 }}>
                <button
                  className="primary-button"
                  data-testid="settings-save-object"
                  type="button"
                  onClick={() => runAction(saveObject)}
                  disabled={isPending || !objectDraft.label.trim() || !objectDraft.pluralLabel.trim() || !objectDraft.key.trim()}
                >
                  <Save size={16} />
                  {selectedObject ? "保存对象" : "创建对象"}
                </button>
                {selectedObject && !selectedObject.isSystem && (
                  <button className="danger-button" type="button" onClick={() => runAction(deleteObject)} disabled={isPending}>
                    <Trash2 size={16} />
                    删除对象
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="settings-divider" />

          <div className="settings-panel-header">
            <div>
              <h3 className="page-title" style={{ fontSize: 18 }}>
                字段配置
              </h3>
              <div className="subtle">{fieldObject?.label ?? "对象"} 的属性字段和类型约束</div>
            </div>
            <button className="secondary-button" data-testid="settings-new-field" type="button" onClick={resetFieldForm} disabled={isPending}>
              <Plus size={16} />
              新建字段
            </button>
          </div>

          <div className="settings-editor-grid">
            <div className="settings-list">
              {objectFields.map((field) => (
                <button
                  key={field.id}
                  className={`settings-item settings-select ${selectedFieldId === field.id ? "selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedFieldId(field.id)}
                >
                  <div className="stage-header">
                    <strong>{field.label}</strong>
                    <span className="badge">{field.type}</span>
                  </div>
                  <div className="subtle">
                    {field.key} · {field.required ? "必填" : "可选"}
                  </div>
                </button>
              ))}
            </div>

            <div className="settings-editor">
              <div className="form-grid">
                <label>
                  <span className="subtle">对象</span>
                  <select
                    className="select"
                    data-testid="settings-field-object"
                    value={fieldDraft.objectKey}
                    onChange={(event) => setFieldDraft((current) => ({ ...current, objectKey: event.target.value }))}
                    disabled={Boolean(selectedField)}
                  >
                    {props.objects.map((object) => (
                      <option key={object.id} value={object.key}>
                        {object.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="subtle">字段 key</span>
                  <input
                    className="input"
                    data-testid="settings-field-key"
                    value={fieldDraft.key}
                    onChange={(event) => setFieldDraft((current) => ({ ...current, key: event.target.value }))}
                    disabled={Boolean(selectedField)}
                  />
                </label>
                <label>
                  <span className="subtle">字段名称</span>
                  <input
                    className="input"
                    data-testid="settings-field-label"
                    value={fieldDraft.label}
                    onChange={(event) => setFieldDraft((current) => ({ ...current, label: event.target.value }))}
                  />
                </label>
                <label>
                  <span className="subtle">字段类型</span>
                  <select
                    className="select"
                    data-testid="settings-field-type"
                    value={fieldDraft.type}
                    onChange={(event) =>
                      setFieldDraft((current) => ({ ...current, type: event.target.value as FieldDefinition["type"] }))
                    }
                    disabled={Boolean(selectedField)}
                  >
                    {fieldTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="subtle">位置</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={fieldDraft.position}
                    onChange={(event) => setFieldDraft((current) => ({ ...current, position: event.target.value }))}
                  />
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={fieldDraft.required}
                    onChange={(event) => setFieldDraft((current) => ({ ...current, required: event.target.checked }))}
                  />
                  <span>必填</span>
                </label>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={fieldDraft.unique}
                    onChange={(event) => setFieldDraft((current) => ({ ...current, unique: event.target.checked }))}
                  />
                  <span>唯一</span>
                </label>
                {fieldDraft.type === "reference" ? (
                  <label className="wide">
                    <span className="subtle">关联对象</span>
                    <select
                      className="select"
                      data-testid="settings-field-reference-object"
                      value={fieldDraft.referenceObjectKey}
                      onChange={(event) => setFieldDraft((current) => ({ ...current, referenceObjectKey: event.target.value }))}
                    >
                      <option value="">请选择</option>
                      {props.objects.map((object) => (
                        <option key={object.id} value={object.key}>
                          {object.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {fieldDraft.type === "select" ? (
                  <label className="wide">
                    <span className="subtle">枚举选项（每行 `标签:值`）</span>
                    <textarea
                      className="textarea"
                      value={fieldDraft.optionsText}
                      onChange={(event) => setFieldDraft((current) => ({ ...current, optionsText: event.target.value }))}
                    />
                  </label>
                ) : null}
              </div>

              <div className="toolbar" style={{ marginTop: 12 }}>
                <button
                  className="primary-button"
                  data-testid="settings-save-field"
                  type="button"
                  onClick={() => runAction(saveField)}
                  disabled={isPending || !fieldDraft.objectKey || !fieldDraft.key.trim() || !fieldDraft.label.trim()}
                >
                  <Save size={16} />
                  {selectedField ? "保存字段" : "创建字段"}
                </button>
                {selectedField && !selectedField.isSystem && (
                  <button className="danger-button" type="button" onClick={() => runAction(deleteField)} disabled={isPending}>
                    <Trash2 size={16} />
                    删除字段
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-header">
            <div>
              <h2 className="page-title">关系定义</h2>
              <div className="subtle">对象之间的一对多、多对多关系</div>
            </div>
            <button className="secondary-button" type="button" onClick={resetRelationForm} disabled={isPending}>
              <Plus size={16} />
              新建关系
            </button>
          </div>

          <div className="settings-editor-grid">
            <div className="settings-list">
              {props.relations.map((relation) => (
                <button
                  key={relation.id}
                  className={`settings-item settings-select ${selectedRelationId === relation.id ? "selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedRelationId(relation.id)}
                >
                  <div className="stage-header">
                    <strong>{relation.label}</strong>
                    <span className="badge">{relation.cardinality}</span>
                  </div>
                  <div className="subtle">
                    {relation.fromObjectKey} → {relation.toObjectKey}
                  </div>
                </button>
              ))}
            </div>

            <div className="settings-editor">
              <div className="form-grid">
                <label>
                  <span className="subtle">来源对象</span>
                  <select
                    className="select"
                    value={relationDraft.fromObjectKey}
                    onChange={(event) => setRelationDraft((current) => ({ ...current, fromObjectKey: event.target.value }))}
                  >
                    {props.objects.map((object) => (
                      <option key={object.id} value={object.key}>
                        {object.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="subtle">目标对象</span>
                  <select
                    className="select"
                    value={relationDraft.toObjectKey}
                    onChange={(event) => setRelationDraft((current) => ({ ...current, toObjectKey: event.target.value }))}
                  >
                    {props.objects.map((object) => (
                      <option key={object.id} value={object.key}>
                        {object.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="subtle">关系 key</span>
                  <input
                    className="input"
                    value={relationDraft.key}
                    onChange={(event) => setRelationDraft((current) => ({ ...current, key: event.target.value }))}
                  />
                </label>
                <label>
                  <span className="subtle">关系名称</span>
                  <input
                    className="input"
                    value={relationDraft.label}
                    onChange={(event) => setRelationDraft((current) => ({ ...current, label: event.target.value }))}
                  />
                </label>
                <label className="wide">
                  <span className="subtle">基数</span>
                  <select
                    className="select"
                    value={relationDraft.cardinality}
                    onChange={(event) =>
                      setRelationDraft((current) => ({
                        ...current,
                        cardinality: event.target.value as RelationDefinition["cardinality"]
                      }))
                    }
                  >
                    <option value="one-to-one">one-to-one</option>
                    <option value="one-to-many">one-to-many</option>
                    <option value="many-to-many">many-to-many</option>
                  </select>
                </label>
              </div>

              <div className="toolbar" style={{ marginTop: 12 }}>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => runAction(saveRelation)}
                  disabled={
                    isPending ||
                    !relationDraft.fromObjectKey ||
                    !relationDraft.toObjectKey ||
                    !relationDraft.key.trim() ||
                    !relationDraft.label.trim()
                  }
                >
                  <Save size={16} />
                  {selectedRelation ? "保存关系" : "创建关系"}
                </button>
                {selectedRelation && (
                  <button className="danger-button" type="button" onClick={() => runAction(deleteRelation)} disabled={isPending}>
                    <Trash2 size={16} />
                    删除关系
                  </button>
                )}
              </div>
            </div>
          </div>
          </section>
        </div>
      ) : null}

      {activeSettingsTab === "crm" ? (
        <div className="settings-grid settings-grid-wide">
          <section className="settings-panel">
          <div className="settings-panel-header">
            <div>
              <h2 className="page-title">销售管道</h2>
              <div className="subtle">管道名称、默认管道和阶段配置</div>
            </div>
            <button className="secondary-button" type="button" onClick={resetPipelineForm} disabled={isPending}>
              <GitBranch size={16} />
              新建管道
            </button>
          </div>

          <div className="settings-editor-grid">
            <div className="settings-list">
              {props.pipelines.map((pipeline) => (
                <button
                  key={pipeline.id}
                  className={`settings-item settings-select ${selectedPipelineId === pipeline.id ? "selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedPipelineId(pipeline.id)}
                >
                  <div className="stage-header">
                    <strong>{pipeline.name}</strong>
                    {pipeline.isDefault ? <span className="badge">默认</span> : null}
                  </div>
                  <div className="subtle">{pipeline.objectKey}</div>
                  <div className="tabs" style={{ marginTop: 10 }}>
                    {pipeline.stages.map((stage) => (
                      <span className="tab" key={stage.key}>
                        {stage.label}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>

            <div className="settings-editor">
              <div className="form-grid">
                <label>
                  <span className="subtle">对象</span>
                  <select
                    className="select"
                    value={pipelineDraft.objectKey}
                    onChange={(event) => setPipelineDraft((current) => ({ ...current, objectKey: event.target.value }))}
                  >
                    {props.objects.map((object) => (
                      <option key={object.id} value={object.key}>
                        {object.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="subtle">管道名称</span>
                  <input
                    className="input"
                    value={pipelineDraft.name}
                    onChange={(event) => setPipelineDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="wide settings-toggle">
                  <input
                    type="checkbox"
                    checked={pipelineDraft.isDefault}
                    onChange={(event) => setPipelineDraft((current) => ({ ...current, isDefault: event.target.checked }))}
                  />
                  <span>设为默认管道</span>
                </label>
                <label className="wide">
                  <span className="subtle">阶段配置（每行 `key|名称|概率|颜色`）</span>
                  <textarea
                    className="textarea"
                    value={pipelineDraft.stagesText}
                    onChange={(event) => setPipelineDraft((current) => ({ ...current, stagesText: event.target.value }))}
                  />
                </label>
              </div>

              <div className="toolbar" style={{ marginTop: 12 }}>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => runAction(savePipeline)}
                  disabled={isPending || !pipelineDraft.objectKey || !pipelineDraft.name.trim() || !pipelineDraft.stagesText.trim()}
                >
                  <Save size={16} />
                  {selectedPipeline ? "保存管道" : "创建管道"}
                </button>
                {selectedPipeline && (
                  <button className="danger-button" type="button" onClick={() => runAction(deletePipeline)} disabled={isPending}>
                    <Trash2 size={16} />
                    删除管道
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-header">
            <div>
              <h2 className="page-title">列表视图</h2>
              <div className="subtle">默认列、排序和基础过滤条件</div>
            </div>
            <button className="secondary-button" type="button" data-testid="settings-new-view" onClick={resetViewForm} disabled={isPending}>
              <LayoutList size={16} />
              新建视图
            </button>
          </div>

          <div className="settings-editor-grid">
            <div className="settings-list">
              {props.savedViews.map((view) => (
                <button
                  key={view.id}
                  className={`settings-item settings-select ${selectedViewId === view.id ? "selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedViewId(view.id)}
                >
                  <div className="stage-header">
                    <strong>{view.name}</strong>
                    {view.isDefault ? <span className="badge">默认</span> : null}
                  </div>
                  <div className="subtle">{view.objectKey}</div>
                  <div className="tabs" style={{ marginTop: 10 }}>
                    {view.columns.map((column) => (
                      <span className="tab" key={column}>
                        {column}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>

            <div className="settings-editor">
              <div className="form-grid">
                <label>
                  <span className="subtle">对象</span>
                  <select
                    className="select"
                    data-testid="settings-view-object"
                    value={viewDraft.objectKey}
                    onChange={(event) => setViewDraft((current) => ({ ...current, objectKey: event.target.value, sortField: "", filterField: "", filterValue: "" }))}
                  >
                    {props.objects.map((object) => (
                      <option key={object.id} value={object.key}>
                        {object.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="subtle">视图名称</span>
                  <input
                    className="input"
                    data-testid="settings-view-name"
                    value={viewDraft.name}
                    onChange={(event) => setViewDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="wide">
                  <span className="subtle">显示列（逗号分隔）</span>
                  <input
                    className="input"
                    data-testid="settings-view-columns"
                    value={viewDraft.columnsText}
                    onChange={(event) => setViewDraft((current) => ({ ...current, columnsText: event.target.value }))}
                  />
                </label>
                <label>
                  <span className="subtle">排序字段</span>
                  <select
                    className="select"
                    value={viewDraft.sortField}
                    onChange={(event) => setViewDraft((current) => ({ ...current, sortField: event.target.value }))}
                  >
                    <option value="">不排序</option>
                    {viewFieldChoices.map((field) => (
                      <option key={field.id} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="subtle">排序方向</span>
                  <select
                    className="select"
                    value={viewDraft.sortDirection}
                    onChange={(event) =>
                      setViewDraft((current) => ({ ...current, sortDirection: event.target.value as "asc" | "desc" }))
                    }
                  >
                    <option value="asc">asc</option>
                    <option value="desc">desc</option>
                  </select>
                </label>
                <label className="wide settings-toggle">
                  <input
                    type="checkbox"
                    checked={viewDraft.isDefault}
                    onChange={(event) => setViewDraft((current) => ({ ...current, isDefault: event.target.checked }))}
                  />
                  <span>设为默认视图</span>
                </label>
                <label>
                  <span className="subtle">过滤字段</span>
                  <select
                    className="select"
                    data-testid="settings-view-filter-field"
                    value={viewDraft.filterField}
                    onChange={(event) => setViewDraft((current) => ({ ...current, filterField: event.target.value, filterValue: "" }))}
                  >
                    <option value="">无过滤</option>
                    {viewFieldChoices.map((field) => (
                      <option key={field.id} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="subtle">过滤操作符</span>
                  <select
                    className="select"
                    value={viewDraft.filterOperator}
                    onChange={(event) =>
                      setViewDraft((current) => ({
                        ...current,
                        filterOperator: event.target.value as "contains" | "equals"
                      }))
                    }
                  >
                    <option value="contains">contains</option>
                    <option value="equals">equals</option>
                  </select>
                </label>
                {viewDraft.filterField === "ownerId" ? (
                  <div className="wide">
                    <SettingsOwnerFilterInput
                      users={props.users}
                      value={viewDraft.filterValue}
                      onChange={(filterValue) => setViewDraft((current) => ({ ...current, filterValue, filterOperator: "equals" }))}
                    />
                  </div>
                ) : viewFilterField?.type === "reference" ? (
                  <div className="wide">
                    <SettingsReferenceFilterInput
                      field={viewFilterField}
                      records={props.records}
                      value={viewDraft.filterValue}
                      onChange={(filterValue) => setViewDraft((current) => ({ ...current, filterValue, filterOperator: "equals" }))}
                    />
                  </div>
                ) : null}
                <label className="wide" style={{ display: viewDraft.filterField === "ownerId" || viewFilterField?.type === "reference" ? "none" : undefined }}>
                  <span className="subtle">过滤值</span>
                  <input
                    className="input"
                    data-testid={viewDraft.filterField === "ownerId" || viewFilterField?.type === "reference" ? undefined : "settings-view-filter-value"}
                    value={viewDraft.filterValue}
                    onChange={(event) => setViewDraft((current) => ({ ...current, filterValue: event.target.value }))}
                  />
                </label>
              </div>

              <div className="toolbar" style={{ marginTop: 12 }}>
                <button
                  className="primary-button"
                  type="button"
                  data-testid="settings-save-view"
                  onClick={() => runAction(saveView)}
                  disabled={isPending || !viewDraft.objectKey || !viewDraft.name.trim() || !viewDraft.columnsText.trim()}
                >
                  <Save size={16} />
                  {selectedView ? "保存视图" : "创建视图"}
                </button>
                {selectedView && (
                  <button className="danger-button" type="button" onClick={() => runAction(deleteView)} disabled={isPending}>
                    <Trash2 size={16} />
                    删除视图
                  </button>
                )}
              </div>
            </div>
          </div>
          </section>
        </div>
      ) : null}

      {activeSettingsTab === "operations" ? (
        <>
          {props.importJobQueueSummary ? (
            <ImportQueueMonitor summary={props.importJobQueueSummary} users={props.users} />
          ) : null}

          <RecordChangeRequestAdminPanel
            fields={props.fields}
            objects={props.objects}
            records={props.records}
            requests={recordChangeRequests}
            users={props.users}
            reviewingRequestId={reviewingRecordChangeRequestId}
            onApprove={(request) => { void reviewRecordChangeRequest(request, "approve"); }}
            onReject={(request) => { void reviewRecordChangeRequest(request, "reject"); }}
          />

          <BackupOperationsPanel backups={backupFiles} isPending={isPending} onCreate={() => runAction(createBackup)} />

          <section className="settings-panel audit-panel">
        <div className="settings-panel-header">
          <div>
            <h2 className="page-title">审计日志</h2>
            <div className="subtle">最近关键写操作</div>
          </div>
          <div className="toolbar compact-toolbar">
            <a className="secondary-button" data-testid="settings-audit-export" href={auditExportUrl} download="audit-logs-export.csv">
              <Download size={16} />
              导出
            </a>
            <span className="badge">{filteredAuditLogs.length} / {props.auditLogs.length}</span>
          </div>
        </div>

        <div className="form-grid" style={{ marginBottom: 12 }}>
          <label>
            <span className="subtle">动作</span>
            <select className="select" data-testid="settings-audit-action-filter" value={auditActionFilter} onChange={(event) => setAuditActionFilter(event.target.value as "" | AuditLog["action"])}>
              <option value="">全部</option>
              {(["create", "update", "delete", "import", "api_error"] satisfies AuditLog["action"][]).map((action) => (
                <option key={action} value={action}>
                  {formatAuditAction(action)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="subtle">实体</span>
            <select className="select" data-testid="settings-audit-entity-filter" value={auditEntityFilter} onChange={(event) => setAuditEntityFilter(event.target.value)}>
              <option value="">全部</option>
              {auditEntityTypes.map((entityType) => (
                <option key={entityType} value={entityType}>
                  {entityType}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="subtle">对象</span>
            <select className="select" data-testid="settings-audit-object-filter" value={auditObjectFilter} onChange={(event) => setAuditObjectFilter(event.target.value)}>
              <option value="">全部</option>
              {auditObjectKeys.map((objectKey) => (
                <option key={objectKey} value={objectKey}>
                  {objectKey}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="subtle">操作者</span>
            <select className="select" data-testid="settings-audit-actor-filter" value={auditActorFilter} onChange={(event) => setAuditActorFilter(event.target.value)}>
              <option value="">全部</option>
              {props.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            <span className="subtle">关键词</span>
            <input className="input" data-testid="settings-audit-query" value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="搜索摘要、实体或记录 ID" />
          </label>
        </div>

        {filteredAuditLogs.length > 0 ? (
          <div className="audit-list">
            {filteredAuditLogs.map((log) => (
              <article className="audit-item" data-testid={`settings-audit-row-${log.id}`} key={log.id}>
                <div className="audit-icon" aria-hidden="true">
                  <ClipboardList size={16} />
                </div>
                <div className="audit-body">
                  <div className="stage-header">
                    <strong>{log.summary}</strong>
                    <span className="badge">{formatAuditAction(log.action)}</span>
                  </div>
                  <div className="subtle">
                    {log.entityType}
                    {log.objectKey ? ` · ${log.objectKey}` : ""}
                    {log.entityId ? ` · ${log.entityId}` : ""}
                  </div>
                  {log.details ? <code className="audit-details">{formatAuditDetails(log.details)}</code> : null}
                </div>
                <time className="subtle audit-time" dateTime={log.createdAt}>
                  {formatAuditTime(log.createdAt)}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">暂无审计日志</div>
        )}
          </section>
        </>
      ) : null}
      <ToastViewport
        toast={toast ?? (error ? { intent: "error", message: error } : message ? { intent: "success", message } : null)}
        onDismiss={() => {
          setToast(null);
          setMessage(null);
          setError(null);
        }}
      />
      <ConfirmDialog
        state={confirmDialog}
        onCancel={() => resolveConfirm(false)}
        onConfirm={() => resolveConfirm(true)}
      />
    </div>
  );
}

function ToastViewport({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) {
    return null;
  }
  return (
    <div className={`toast toast-${toast.intent}`} role="status" aria-live="polite">
      <span>{toast.message}</span>
      <button className="icon-button" aria-label="关闭提示" type="button" onClick={onDismiss}>
        <XCircle size={16} />
      </button>
    </div>
  );
}

function ConfirmDialog({
  state,
  onCancel,
  onConfirm
}: {
  state: ConfirmDialogState | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!state) {
    return null;
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={state.title}>
      <div className="modal-panel app-dialog">
        <h2 className="page-title" style={{ fontSize: 18 }}>{state.title}</h2>
        <p>{state.message}</p>
        <div className="toolbar" style={{ justifyContent: "flex-end" }}>
          <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
          <button className={state.danger ? "danger-button" : "primary-button"} type="button" onClick={onConfirm}>
            {state.confirmLabel ?? "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserTeamAdminPanel({
  users,
  teams,
  roles,
  selectedUserId,
  selectedUser,
  selectedTeamId,
  selectedTeam,
  userDraft,
  passwordSetupLink,
  teamDraft,
  isPending,
  onSelectUser,
  onSelectTeam,
  onNewUser,
  onNewTeam,
  onUserChange,
  onTeamNameChange,
  onSaveUser,
  onGeneratePasswordLink,
  onSaveTeam,
  onDeleteTeam
}: {
  users: User[];
  teams: Team[];
  roles: Role[];
  selectedUserId: string;
  selectedUser?: User;
  selectedTeamId: string;
  selectedTeam?: Team;
  userDraft: UserDraft;
  passwordSetupLink: string | null;
  teamDraft: TeamDraft;
  isPending: boolean;
  onSelectUser: (userId: string) => void;
  onSelectTeam: (teamId: string) => void;
  onNewUser: () => void;
  onNewTeam: () => void;
  onUserChange: (patch: Partial<UserDraft>) => void;
  onTeamNameChange: (name: string) => void;
  onSaveUser: () => void;
  onGeneratePasswordLink: () => void;
  onSaveTeam: () => void;
  onDeleteTeam: () => void;
}) {
  const assignedTeamUsers = selectedTeam ? users.filter((user) => user.teamId === selectedTeam.id) : [];

  return (
    <div className="settings-grid settings-grid-wide">
      <section className="settings-panel">
        <div className="settings-panel-header">
          <div>
            <h2 className="page-title">用户管理</h2>
            <div className="subtle">创建账号、分配角色和团队。修改密码留空时不会变更现有密码。</div>
          </div>
          <button className="secondary-button" data-testid="settings-new-user" type="button" onClick={onNewUser} disabled={isPending}>
            <Plus size={16} />
            新建用户
          </button>
        </div>

        <div className="settings-editor-grid">
          <div className="settings-list">
            {users.map((user) => (
              <button
                key={user.id}
                className={`settings-item settings-select ${selectedUserId === user.id ? "selected" : ""}`}
                data-testid={`settings-user-row-${user.id}`}
                type="button"
                onClick={() => onSelectUser(user.id)}
              >
                <div className="stage-header">
                  <strong>{user.name}</strong>
                  <span className={`badge ${user.active ? "" : "danger-badge"}`}>
                    {user.active ? roles.find((role) => role.id === user.roleId)?.name ?? "未分配" : "已停用"}
                  </span>
                </div>
                <div className="subtle">
                  {user.email} · {teams.find((team) => team.id === user.teamId)?.name ?? "无团队"}
                </div>
              </button>
            ))}
          </div>

          <div className="settings-editor">
            <div className="form-grid">
              <label>
                <span className="subtle">邮箱</span>
                <input
                  className="input"
                  data-testid="settings-user-email"
                  value={userDraft.email}
                  onChange={(event) => onUserChange({ email: event.target.value })}
                />
              </label>
              <label>
                <span className="subtle">姓名</span>
                <input
                  className="input"
                  data-testid="settings-user-name"
                  value={userDraft.name}
                  onChange={(event) => onUserChange({ name: event.target.value })}
                />
              </label>
              <label>
                <span className="subtle">角色</span>
                <select
                  className="select"
                  data-testid="settings-user-role"
                  value={userDraft.roleId}
                  onChange={(event) => onUserChange({ roleId: event.target.value })}
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="subtle">团队</span>
                <select
                  className="select"
                  data-testid="settings-user-team"
                  value={userDraft.teamId}
                  onChange={(event) => onUserChange({ teamId: event.target.value })}
                >
                  <option value="">无团队</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide">
                <span className="subtle">{selectedUser ? "重置密码" : "初始密码"}</span>
                <input
                  className="input"
                  data-testid="settings-user-password"
                  type="password"
                  value={userDraft.password}
                  onChange={(event) => onUserChange({ password: event.target.value })}
                />
              </label>
              <label className="wide settings-toggle">
                <input
                  data-testid="settings-user-active"
                  type="checkbox"
                  checked={userDraft.active}
                  onChange={(event) => onUserChange({ active: event.target.checked })}
                />
                <span>启用账号</span>
              </label>
            </div>

            <div className="toolbar" style={{ marginTop: 12 }}>
              <button
                className="primary-button"
                data-testid="settings-save-user"
                type="button"
                onClick={onSaveUser}
                disabled={
                  isPending ||
                  !userDraft.email.trim() ||
                  !userDraft.name.trim() ||
                  !userDraft.roleId ||
                  (!selectedUser && userDraft.password.trim().length < 8)
                }
              >
                <Save size={16} />
                {selectedUser ? "保存用户" : "创建用户"}
              </button>
              {selectedUser ? (
                <button
                  className="secondary-button"
                  data-testid="settings-generate-password-link"
                  type="button"
                  onClick={onGeneratePasswordLink}
                  disabled={isPending || !selectedUser.active}
                  title={!selectedUser.active ? "停用账号不能生成密码设置链接" : undefined}
                >
                  <Link2 size={16} />
                  生成密码设置链接
                </button>
              ) : null}
            </div>
            {passwordSetupLink ? (
              <label className="wide" style={{ display: "grid", gap: 6, marginTop: 12 }}>
                <span className="subtle">一次性链接</span>
                <input
                  className="input"
                  data-testid="settings-password-setup-link"
                  readOnly
                  value={passwordSetupLink}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            ) : null}
          </div>
        </div>
      </section>

      <section className="settings-panel">
        <div className="settings-panel-header">
          <div>
            <h2 className="page-title">团队管理</h2>
            <div className="subtle">团队会影响普通销售可见的同队记录范围。</div>
          </div>
          <button className="secondary-button" data-testid="settings-new-team" type="button" onClick={onNewTeam} disabled={isPending}>
            <Plus size={16} />
            新建团队
          </button>
        </div>

        <div className="settings-editor-grid">
          <div className="settings-list">
            {teams.map((team) => {
              const teamUsers = users.filter((user) => user.teamId === team.id);
              return (
                <button
                  key={team.id}
                  className={`settings-item settings-select ${selectedTeamId === team.id ? "selected" : ""}`}
                  type="button"
                  onClick={() => onSelectTeam(team.id)}
                >
                  <div className="stage-header">
                    <strong>{team.name}</strong>
                    <span className="badge">{teamUsers.length} 用户</span>
                  </div>
                  <div className="subtle">{team.id}</div>
                </button>
              );
            })}
          </div>

          <div className="settings-editor">
            <div className="form-grid">
              <label className="wide">
                <span className="subtle">团队名称</span>
                <input
                  className="input"
                  data-testid="settings-team-name"
                  value={teamDraft.name}
                  onChange={(event) => onTeamNameChange(event.target.value)}
                />
              </label>
            </div>

            <div className="toolbar" style={{ marginTop: 12 }}>
              <button
                className="primary-button"
                data-testid="settings-save-team"
                type="button"
                onClick={onSaveTeam}
                disabled={isPending || !teamDraft.name.trim()}
              >
                <Save size={16} />
                {selectedTeam ? "保存团队" : "创建团队"}
              </button>
              {selectedTeam && (
                <button
                  className="danger-button"
                  type="button"
                  onClick={onDeleteTeam}
                  disabled={isPending || assignedTeamUsers.length > 0}
                  title={assignedTeamUsers.length > 0 ? "已有用户使用该团队，不能删除" : undefined}
                >
                  <Trash2 size={16} />
                  删除团队
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function CurrencyAdminPanel({
  currencies,
  draft,
  selectedCurrencyId,
  selectedCurrency,
  isPending,
  onSelectCurrency,
  onDraftChange,
  onNew,
  onSave,
  onDelete
}: {
  currencies: CrmRecord[];
  draft: CurrencyDraft;
  selectedCurrencyId: string;
  selectedCurrency?: CrmRecord;
  isPending: boolean;
  onSelectCurrency: (currencyId: string) => void;
  onDraftChange: (patch: Partial<CurrencyDraft>) => void;
  onNew: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const activeCurrencies = getCurrencyDefinitions(currencies);
  const baseCurrency = activeCurrencies.find((currency) => currency.isBase);

  return (
    <section className="settings-panel" data-testid="settings-currencies">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title">货币与汇率</h2>
          <div className="subtle">配置可用于产品单价和报价换算的币种；汇率含义为 1 单位该币种等于多少基准币种。</div>
        </div>
        <button className="secondary-button" type="button" onClick={onNew} disabled={isPending}>
          <Plus size={16} />
          新建币种
        </button>
      </div>

      <div className="settings-editor-grid">
        <div className="settings-list">
          {currencies.map((currency) => (
            <button
              className={`settings-item settings-select ${selectedCurrencyId === currency.id ? "selected" : ""}`}
              key={currency.id}
              type="button"
              onClick={() => onSelectCurrency(currency.id)}
            >
              <div className="stage-header">
                <strong>{String(currency.data.code ?? currency.title)}</strong>
                <span className={currency.data.active === false ? "danger-badge" : "badge"}>{currency.data.active === false ? "停用" : currency.data.isBase ? "基准" : "启用"}</span>
              </div>
              <div className="subtle">{String(currency.data.label ?? currency.title)} · 汇率 {String(currency.data.rateToBase ?? "-")}</div>
            </button>
          ))}
          {currencies.length === 0 ? <div className="empty-state">还没有币种配置</div> : null}
        </div>

        <div className="settings-editor">
          <div className="form-grid">
            <label>
              <span className="subtle">币种代码</span>
              <input className="input" data-testid="settings-currency-code" value={draft.code} onChange={(event) => onDraftChange({ code: event.target.value.toUpperCase() })} placeholder="CNY" />
            </label>
            <label>
              <span className="subtle">名称</span>
              <input className="input" data-testid="settings-currency-label" value={draft.label} onChange={(event) => onDraftChange({ label: event.target.value })} placeholder="人民币" />
            </label>
            <label>
              <span className="subtle">符号</span>
              <input className="input" data-testid="settings-currency-symbol" value={draft.symbol} onChange={(event) => onDraftChange({ symbol: event.target.value })} placeholder="¥" />
            </label>
            <label>
              <span className="subtle">对基准汇率</span>
              <input
                className="input"
                data-testid="settings-currency-rate"
                min="0.000001"
                step="0.000001"
                type="number"
                value={draft.isBase ? "1" : draft.rateToBase}
                onChange={(event) => onDraftChange({ rateToBase: event.target.value })}
                disabled={draft.isBase}
              />
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={draft.isBase} onChange={(event) => onDraftChange({ isBase: event.target.checked, rateToBase: event.target.checked ? "1" : draft.rateToBase })} />
              设为基准币种
            </label>
            <label className="settings-toggle">
              <input type="checkbox" checked={draft.active} onChange={(event) => onDraftChange({ active: event.target.checked })} />
              启用
            </label>
          </div>

          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="primary-button" data-testid="settings-save-currency" type="button" onClick={onSave} disabled={isPending || !draft.code.trim() || !draft.label.trim()}>
              <Save size={16} />
              {selectedCurrency ? "保存币种" : "创建币种"}
            </button>
            {selectedCurrency ? (
              <button className="danger-button" type="button" onClick={onDelete} disabled={isPending || selectedCurrency.data.isBase === true}>
                <Trash2 size={16} />
                删除币种
              </button>
            ) : null}
          </div>
          <div className="subtle" style={{ marginTop: 10 }}>
            当前基准币种：{baseCurrency ? `${baseCurrency.label} (${baseCurrency.code})` : "未指定"}
          </div>
        </div>
      </div>
    </section>
  );
}

function PaymentTermAdminPanel({
  field,
  isPending,
  optionsText,
  onChange,
  onSave
}: {
  field?: FieldDefinition;
  isPending: boolean;
  optionsText: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <section className="settings-panel" data-testid="settings-payment-terms">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title">Payment term</h2>
          <div className="subtle">配置报价里的付款条件下拉选项。每行一个选项，格式为 label:value。</div>
        </div>
      </div>
      {field ? (
        <>
          <label className="wide">
            <span className="subtle">选项</span>
            <textarea
              className="textarea"
              data-testid="settings-payment-term-options"
              value={optionsText}
              onChange={(event) => onChange(event.target.value)}
              placeholder={"见票即付:due_on_receipt\nNet 30:net_30"}
            />
          </label>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="primary-button" data-testid="settings-save-payment-terms" type="button" onClick={onSave} disabled={isPending || !optionsText.trim()}>
              <Save size={16} />
              保存 Payment term
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">未找到 quotes.paymentTerm 字段，请先在对象字段中恢复该字段。</div>
      )}
    </section>
  );
}

function ApiKeyAdminPanel({
  apiKeys,
  users,
  draft,
  createdToken,
  isPending,
  onDraftChange,
  onTogglePermission,
  onCreate,
  onRevoke,
  onClearToken,
  onReset
}: {
  apiKeys: ApiKey[];
  users: User[];
  draft: ApiKeyDraft;
  createdToken: string | null;
  isPending: boolean;
  onDraftChange: (patch: Partial<ApiKeyDraft>) => void;
  onTogglePermission: (permission: Permission, enabled: boolean) => void;
  onCreate: () => void;
  onRevoke: (apiKey: ApiKey) => void;
  onClearToken: () => void;
  onReset: () => void;
}) {
  const integrationPermissions = permissionCatalog.filter((permission) => permission.key !== "crm.admin");

  return (
    <section className="settings-panel">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title">API Keys</h2>
          <div className="subtle">External integrations authenticate with Bearer tokens scoped by CRM permissions.</div>
        </div>
        <button className="secondary-button" data-testid="settings-new-api-key" type="button" onClick={onReset} disabled={isPending}>
          <Plus size={16} />
          New key
        </button>
      </div>

      {createdToken ? (
        <div className="settings-banner settings-banner-success" style={{ marginTop: 12 }}>
          <div className="stage-header">
            <strong>Copy this token now</strong>
            <button className="secondary-button" type="button" onClick={onClearToken}>
              <XCircle size={15} />
              Hide
            </button>
          </div>
          <code className="audit-details" data-testid="settings-api-key-token" style={{ marginTop: 8 }}>{createdToken}</code>
        </div>
      ) : null}

      <div className="settings-grid settings-grid-wide" style={{ marginTop: 14 }}>
        <div className="settings-card">
          <div className="form-grid">
            <label>
              <span className="subtle">Name</span>
              <input className="input" data-testid="settings-api-key-name" value={draft.name} onChange={(event) => onDraftChange({ name: event.target.value })} placeholder="Data warehouse sync" />
            </label>
            <label>
              <span className="subtle">Expires at</span>
              <input className="input" data-testid="settings-api-key-expires-at" type="datetime-local" value={draft.expiresAt} onChange={(event) => onDraftChange({ expiresAt: event.target.value })} />
            </label>
            <div className="wide permission-picker">
              {integrationPermissions.map((permission) => (
                <label className="permission-option" key={permission.key}>
                  <input
                    data-testid={`settings-api-key-permission-${permission.key}`}
                    type="checkbox"
                    checked={draft.permissions.includes(permission.key)}
                    onChange={(event) => onTogglePermission(permission.key, event.target.checked)}
                  />
                  <span>
                    <strong>{permission.label}</strong>
                    <small>{permission.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <button className="primary-button" data-testid="settings-create-api-key" type="button" onClick={onCreate} disabled={isPending || !draft.name.trim() || draft.permissions.length === 0} style={{ marginTop: 12 }}>
            <Save size={16} />
            Create API key
          </button>
        </div>

        <div className="settings-card">
          <div className="stage-header">
            <strong>Issued keys</strong>
            <span className="badge">{apiKeys.length}</span>
          </div>
          {apiKeys.length > 0 ? (
            <div className="activity-list" style={{ marginTop: 12 }}>
              {apiKeys.map((apiKey) => (
                <article className="activity-item" data-testid={`settings-api-key-row-${apiKey.id}`} key={apiKey.id}>
                  <div className="stage-header">
                    <strong>{apiKey.name}</strong>
                    <span className={apiKey.revokedAt ? "danger-badge" : "badge"}>{apiKey.revokedAt ? "revoked" : "active"}</span>
                  </div>
                  <div className="subtle">
                    {apiKey.tokenPrefix}... · {apiKey.permissions.join(", ")}
                  </div>
                  <div className="subtle">
                    Created {formatAuditTime(apiKey.createdAt)} · {users.find((user) => user.id === apiKey.createdById)?.name ?? "Unknown"}
                  </div>
                  {apiKey.lastUsedAt ? <div className="subtle">Last used {formatAuditTime(apiKey.lastUsedAt)}</div> : null}
                  {apiKey.expiresAt ? <div className="subtle">Expires {formatAuditTime(apiKey.expiresAt)}</div> : null}
                  {!apiKey.revokedAt ? (
                    <button className="danger-button" data-testid={`settings-api-key-revoke-${apiKey.id}`} type="button" onClick={() => onRevoke(apiKey)} disabled={isPending} style={{ marginTop: 10 }}>
                      <XCircle size={15} />
                      Revoke
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ marginTop: 12 }}>No API keys have been issued.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function WebhookAdminPanel({
  webhooks,
  objects,
  users,
  draft,
  selectedWebhook,
  createdSecret,
  deliveries,
  selectedWebhookId,
  statusFilter,
  eventFilter,
  isPending,
  actionKey,
  onDraftChange,
  onToggleEvent,
  onCreate,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  onRetryDelivery,
  onSelectDeliveryWebhook,
  onStatusFilterChange,
  onEventFilterChange,
  onClearSecret,
  onReset
}: {
  webhooks: WebhookEndpoint[];
  objects: ObjectDefinition[];
  users: User[];
  draft: WebhookDraft;
  selectedWebhook?: WebhookEndpoint;
  createdSecret: string | null;
  deliveries: WebhookDelivery[];
  selectedWebhookId: string;
  statusFilter: "" | WebhookDeliveryStatus;
  eventFilter: "" | WebhookEvent;
  isPending: boolean;
  actionKey: string;
  onDraftChange: (patch: Partial<WebhookDraft>) => void;
  onToggleEvent: (event: WebhookEvent, enabled: boolean) => void;
  onCreate: () => void;
  onEdit: (webhook: WebhookEndpoint) => void;
  onDelete: (webhook: WebhookEndpoint) => void;
  onToggle: (webhook: WebhookEndpoint) => void;
  onTest: (webhook: WebhookEndpoint) => void;
  onRetryDelivery: (delivery: WebhookDelivery) => void;
  onSelectDeliveryWebhook: (id: string) => void;
  onStatusFilterChange: (status: "" | WebhookDeliveryStatus) => void;
  onEventFilterChange: (event: "" | WebhookEvent) => void;
  onClearSecret: () => void;
  onReset: () => void;
}) {
  const objectWebhookEventOptions = objects.flatMap((object) => [
    { event: `record.${object.key}.created` as WebhookEvent, label: `${object.label} 创建` },
    { event: `record.${object.key}.updated` as WebhookEvent, label: `${object.label} 更新` },
    { event: `record.${object.key}.deleted` as WebhookEvent, label: `${object.label} 删除` }
  ]);
  const webhookEventGroups: Array<{ title: string; description: string; options: Array<{ event: WebhookEvent; label: string }> }> = [
    {
      title: "通用记录事件",
      description: "订阅全部 CRM 记录，不区分对象类型。",
      options: [
        { event: "record.created", label: "任意记录创建" },
        { event: "record.updated", label: "任意记录更新" },
        { event: "record.deleted", label: "任意记录删除" }
      ]
    },
    {
      title: "对象级记录事件",
      description: "只订阅指定对象，例如联系人、公司、交易、产品、报价。",
      options: objectWebhookEventOptions
    },
    {
      title: "邮件事件",
      description: "订阅邮箱消息和邮件线程变化。",
      options: [
        { event: "email.message.created", label: "邮件消息创建" },
        { event: "email.thread.updated", label: "邮件线程更新" },
        { event: "email.thread.deleted", label: "邮件线程删除" }
      ]
    },
    {
      title: "系统事件",
      description: "导入、活动和测试投递。",
      options: [
        { event: "activity.created", label: "活动创建" },
        { event: "import.completed", label: "导入完成" },
        { event: "import.failed", label: "导入失败" },
        { event: "webhook.test", label: "测试事件" }
      ]
    }
  ];
  const allWebhookEventOptions = webhookEventGroups.flatMap((group) => group.options.map((option) => option.event));
  const webhookBusy = Boolean(actionKey);
  return (
    <section className="settings-panel">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title">Webhooks</h2>
          <div className="subtle">Subscribe external systems to CRM events with signed HTTP POST deliveries.</div>
        </div>
        <button className="secondary-button" data-testid="settings-new-webhook" type="button" onClick={onReset} disabled={isPending}>
          <Plus size={16} />
          New webhook
        </button>
      </div>

      {createdSecret ? (
        <div className="settings-banner settings-banner-success" style={{ marginTop: 12 }}>
          <div className="stage-header">
            <strong>Copy this signing secret now</strong>
            <button className="secondary-button" type="button" onClick={onClearSecret}>
              <XCircle size={15} />
              Hide
            </button>
          </div>
          <code className="audit-details" data-testid="settings-webhook-secret" style={{ marginTop: 8 }}>{createdSecret}</code>
        </div>
      ) : null}

      <div className="settings-grid settings-grid-wide" style={{ marginTop: 14 }}>
        <div className="settings-card">
          <div className="form-grid">
            <label>
              <span className="subtle">Name</span>
              <input className="input" data-testid="settings-webhook-name" value={draft.name} onChange={(event) => onDraftChange({ name: event.target.value })} placeholder="Sales ops webhook" />
            </label>
            <label>
              <span className="subtle">Endpoint URL</span>
              <input className="input" data-testid="settings-webhook-url" value={draft.url} onChange={(event) => onDraftChange({ url: event.target.value })} placeholder="https://example.com/webhooks/crm" />
            </label>
            <label>
              <span className="subtle">Active</span>
              <input data-testid="settings-webhook-active" type="checkbox" checked={draft.active} onChange={(event) => onDraftChange({ active: event.target.checked })} />
            </label>
            <div className="wide webhook-event-groups">
              {webhookEventGroups.map((group) => (
                <div className="webhook-event-group" key={group.title}>
                  <div className="stage-header">
                    <strong>{group.title}</strong>
                    <span className="subtle">{group.description}</span>
                  </div>
                  <div className="permission-picker webhook-event-picker">
                    {group.options.map(({ event, label }) => (
                      <label className="permission-option" key={event}>
                        <input data-testid={`settings-webhook-event-${event}`} type="checkbox" checked={draft.events.includes(event)} onChange={(change) => onToggleEvent(event, change.target.checked)} />
                        <span>
                          <strong>{label}</strong>
                          <small>{event}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button className="primary-button" data-testid="settings-create-webhook" type="button" onClick={onCreate} disabled={isPending || webhookBusy || !draft.name.trim() || !draft.url.trim() || draft.events.length === 0} style={{ marginTop: 12 }}>
            <Save className={actionKey === "create" || actionKey.startsWith("save:") ? "spin-icon" : undefined} size={16} />
            {actionKey === "create" || actionKey.startsWith("save:") ? "Saving..." : selectedWebhook ? "Save webhook" : "Create webhook"}
          </button>
          {selectedWebhook ? (
            <button className="secondary-button" type="button" onClick={onReset} disabled={isPending || webhookBusy} style={{ marginTop: 12, marginLeft: 8 }}>
              <XCircle size={15} />
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="settings-card">
          <div className="stage-header">
            <strong>Subscriptions</strong>
            <span className="badge">{webhooks.length}</span>
          </div>
          {webhooks.length > 0 ? (
            <div className="activity-list" style={{ marginTop: 12 }}>
              {webhooks.map((webhook) => (
                <article className="activity-item" data-testid={`settings-webhook-row-${webhook.id}`} key={webhook.id}>
                  <div className="stage-header">
                    <strong>{webhook.name}</strong>
                    <span className={webhook.active ? "badge" : "danger-badge"}>{webhook.active ? "active" : "inactive"}</span>
                  </div>
                  <div className="subtle">{webhook.url}</div>
                  <div className="subtle">{webhook.events.join(", ")} · {webhook.secretPrefix}...</div>
                  <div className="subtle">
                    Created {formatAuditTime(webhook.createdAt)} · {users.find((user) => user.id === webhook.createdById)?.name ?? "Unknown"}
                  </div>
                  {webhook.lastDeliveredAt ? <div className="subtle">Last delivered {formatAuditTime(webhook.lastDeliveredAt)}</div> : null}
                  <div className="toolbar compact-toolbar" style={{ marginTop: 10 }}>
                    <button className="secondary-button" data-testid={`settings-webhook-edit-${webhook.id}`} type="button" onClick={() => onEdit(webhook)} disabled={isPending || webhookBusy}>
                      <Save size={15} />
                      Edit
                    </button>
                    <button className="secondary-button" data-testid={`settings-webhook-test-${webhook.id}`} type="button" onClick={() => onTest(webhook)} disabled={isPending || webhookBusy || !webhook.active}>
                      <CheckCircle2 className={actionKey === `test:${webhook.id}` ? "spin-icon" : undefined} size={15} />
                      {actionKey === `test:${webhook.id}` ? "Testing..." : "Test"}
                    </button>
                    <button className={webhook.active ? "danger-button" : "secondary-button"} data-testid={`settings-webhook-toggle-${webhook.id}`} type="button" onClick={() => onToggle(webhook)} disabled={isPending || webhookBusy}>
                      <XCircle className={actionKey === `toggle:${webhook.id}` ? "spin-icon" : undefined} size={15} />
                      {actionKey === `toggle:${webhook.id}` ? "Saving..." : webhook.active ? "Disable" : "Enable"}
                    </button>
                    <button className="danger-button" data-testid={`settings-webhook-delete-${webhook.id}`} type="button" onClick={() => onDelete(webhook)} disabled={isPending || webhookBusy}>
                      <Trash2 className={actionKey === `delete:${webhook.id}` ? "spin-icon" : undefined} size={15} />
                      {actionKey === `delete:${webhook.id}` ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ marginTop: 12 }}>No webhook subscriptions yet.</div>
          )}
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 14 }}>
        <div className="stage-header">
          <strong>Recent deliveries</strong>
          <span className="badge">{deliveries.length}</span>
        </div>
        <div className="toolbar compact-toolbar" style={{ marginTop: 12 }}>
          <label>
            <span className="subtle">Webhook</span>
            <select className="input" data-testid="settings-webhook-delivery-select" value={selectedWebhookId} onChange={(event) => onSelectDeliveryWebhook(event.target.value)}>
              {webhooks.map((webhook) => (
                <option key={webhook.id} value={webhook.id}>{webhook.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="subtle">Status</span>
            <select className="input" data-testid="settings-webhook-delivery-status" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as "" | WebhookDeliveryStatus)}>
              <option value="">All statuses</option>
              <option value="pending">pending</option>
              <option value="success">success</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label>
            <span className="subtle">Event</span>
            <select className="input" data-testid="settings-webhook-delivery-event" value={eventFilter} onChange={(event) => onEventFilterChange(event.target.value as "" | WebhookEvent)}>
              <option value="">All events</option>
              {allWebhookEventOptions.map((event) => (
                <option key={event} value={event}>{event}</option>
              ))}
            </select>
          </label>
        </div>
        {selectedWebhookId && deliveries.length > 0 ? (
          <div className="activity-list" style={{ marginTop: 12 }}>
            {deliveries.map((delivery) => (
              <article className="activity-item" data-testid={`settings-webhook-delivery-${delivery.id}`} key={delivery.id}>
                <div className="stage-header">
                  <strong>{delivery.event}</strong>
                  <span className={delivery.status === "success" ? "badge" : "danger-badge"}>{delivery.status}</span>
                </div>
                <div className="subtle">
                  {formatAuditTime(delivery.createdAt)} - HTTP {delivery.responseStatus ?? "n/a"} - attempt {delivery.attempts}
                </div>
                <div className="subtle">{webhooks.find((webhook) => webhook.id === delivery.webhookId)?.name ?? delivery.webhookId}</div>
                {delivery.errorMessage ? <div className="subtle">{delivery.errorMessage}</div> : null}
                {delivery.responseBody ? <code className="audit-details">{delivery.responseBody}</code> : null}
                {delivery.status === "failed" ? (
                  <button className="secondary-button" data-testid={`settings-webhook-delivery-retry-${delivery.id}`} type="button" onClick={() => onRetryDelivery(delivery)} disabled={isPending} style={{ marginTop: 10 }}>
                    <RefreshCw className={isPending ? "spin-icon" : undefined} size={15} />
                    Retry
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state" style={{ marginTop: 12 }}>{selectedWebhookId ? "No deliveries match these filters." : "Create a webhook to inspect deliveries."}</div>
        )}
      </div>
    </section>
  );
}

function NotificationChannelAdminPanel({
  channels,
  emailAccounts,
  draft,
  selectedChannelId,
  selectedChannel,
  isPending,
  onDraftChange,
  onToggleEvent,
  onSelect,
  onNew,
  onSave,
  onDelete
}: {
  channels: NotificationChannel[];
  emailAccounts: EmailAccount[];
  users: User[];
  draft: NotificationChannelDraft;
  selectedChannelId: string;
  selectedChannel?: NotificationChannel;
  isPending: boolean;
  onDraftChange: (patch: Partial<NotificationChannelDraft>) => void;
  onToggleEvent: (event: WebhookEvent, enabled: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <section className="settings-panel">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title">通知渠道</h2>
          <div className="subtle">关键事件可通过 Bark、Webhook 或 Email 提醒；同一类型可配置多条 channel。</div>
        </div>
        <button className="secondary-button" type="button" onClick={onNew} disabled={isPending}>
          <Plus size={16} />
          新建渠道
        </button>
      </div>

      <div className="settings-grid settings-grid-wide" style={{ marginTop: 14 }}>
        <div className="settings-card">
          <div className="form-grid">
            <label>
              <span className="subtle">名称</span>
              <input className="input" data-testid="settings-notification-name" value={draft.name} onChange={(event) => onDraftChange({ name: event.target.value })} />
            </label>
            <label>
              <span className="subtle">类型</span>
              <select className="input" data-testid="settings-notification-type" value={draft.type} onChange={(event) => onDraftChange({ type: event.target.value as NotificationChannelType })}>
                <option value="bark">Bark</option>
                <option value="webhook">Webhook</option>
                <option value="email">Email</option>
              </select>
            </label>
            {draft.type === "bark" ? (
              <>
                <label>
                  <span className="subtle">Bark Endpoint</span>
                  <input className="input" data-testid="settings-notification-bark-endpoint" value={draft.barkEndpoint} onChange={(event) => onDraftChange({ barkEndpoint: event.target.value })} placeholder="https://api.day.app" />
                </label>
                <label>
                  <span className="subtle">Device Key</span>
                  <input className="input" data-testid="settings-notification-bark-key" value={draft.barkDeviceKey} onChange={(event) => onDraftChange({ barkDeviceKey: event.target.value })} />
                </label>
              </>
            ) : null}
            {draft.type === "webhook" ? (
              <label className="wide">
                <span className="subtle">Webhook URL</span>
                <input className="input" data-testid="settings-notification-webhook-url" value={draft.webhookUrl} onChange={(event) => onDraftChange({ webhookUrl: event.target.value })} placeholder="https://example.com/notify" />
              </label>
            ) : null}
            {draft.type === "email" ? (
              <>
                <label className="wide">
                  <span className="subtle">收件人</span>
                  <input className="input" data-testid="settings-notification-email-recipients" value={draft.recipients} onChange={(event) => onDraftChange({ recipients: event.target.value })} placeholder="ops@example.com, sales@example.com" />
                </label>
                <label>
                  <span className="subtle">发件账户</span>
                  <select className="input" data-testid="settings-notification-email-account" value={draft.accountId} onChange={(event) => onDraftChange({ accountId: event.target.value })}>
                    <option value="">自动选择可发件账户</option>
                    {emailAccounts.map((account) => (
                      <option key={account.id} value={account.id}>{account.name} - {account.emailAddress}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className="checkbox-label">
              <input type="checkbox" checked={draft.active} onChange={(event) => onDraftChange({ active: event.target.checked })} />
              启用
            </label>
            <div className="wide permission-picker">
              {[...baseWebhookEventOptions, ...emailWebhookEventOptions].map((event) => (
                <label className="permission-option" key={event}>
                  <input data-testid={`settings-notification-event-${event}`} type="checkbox" checked={draft.events.includes(event)} onChange={(change) => onToggleEvent(event, change.target.checked)} />
                  <span>
                    <strong>{event}</strong>
                    <small>触发 {event}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="primary-button" data-testid="settings-notification-save" type="button" onClick={onSave} disabled={isPending || !draft.name.trim() || draft.events.length === 0}>
              <Save size={16} />
              {selectedChannel ? "保存渠道" : "创建渠道"}
            </button>
            {selectedChannel ? (
              <button className="danger-button" type="button" onClick={onDelete} disabled={isPending}>
                <Trash2 size={16} />
                删除
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-card">
          <div className="stage-header">
            <strong>已配置渠道</strong>
            <span className="badge">{channels.length}</span>
          </div>
          {channels.length ? (
            <div className="activity-list" style={{ marginTop: 12 }}>
              {channels.map((channel) => (
                <button className={`settings-item settings-select ${selectedChannelId === channel.id ? "selected" : ""}`} data-testid={`settings-notification-channel-${channel.id}`} key={channel.id} type="button" onClick={() => onSelect(channel.id)}>
                  <strong>{channel.name}</strong>
                  <span>{notificationChannelTypeLabel(channel.type)} - {channel.events.join(", ")}</span>
                  <span className={channel.active ? "badge" : "danger-badge"}>{channel.active ? "启用" : "停用"}</span>
                  {channel.lastNotifiedAt ? <span className="subtle">最近通知 {formatAuditTime(channel.lastNotifiedAt)}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ marginTop: 12 }}>暂无通知渠道</div>
          )}
        </div>
      </div>
    </section>
  );
}

type RecordReviewRow = {
  key: string;
  label: string;
  oldValue: string;
  newValue: string;
};

function RecordChangeRequestAdminPanel({
  fields,
  objects,
  records,
  requests,
  users,
  reviewingRequestId,
  onApprove,
  onReject
}: {
  fields: FieldDefinition[];
  objects: ObjectDefinition[];
  records: CrmRecord[];
  requests: RecordChangeRequest[];
  users: User[];
  reviewingRequestId: string;
  onApprove: (request: RecordChangeRequest) => void;
  onReject: (request: RecordChangeRequest) => void;
}) {
  return (
    <section className="settings-panel" data-testid="settings-record-change-requests">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title">记录变更审批</h2>
          <div className="subtle">联系人/公司修改，以及联系人、公司、交易、产品、报价删除，需要管理员审核后生效。</div>
        </div>
        <span className="badge">{requests.length}</span>
      </div>
      {requests.length > 0 ? (
        <div className="record-review-list" style={{ marginTop: 12 }}>
          {requests.map((request) => {
            const object = objects.find((item) => item.key === request.objectKey);
            const record = records.find((item) => item.id === request.recordId && item.objectKey === request.objectKey);
            const requestFields = fields.filter((field) => field.objectKey === request.objectKey);
            const reviewRows = buildRecordReviewRows(request, record, requestFields, users);
            const requestedBy = users.find((user) => user.id === request.requestedById);
            return (
              <article className={`record-review-card ${request.action === "delete" ? "delete-review" : "update-review"}`} data-testid={`record-change-request-${request.id}`} key={request.id}>
                <div className="record-review-header">
                  <div>
                    <strong>{request.recordTitle}</strong>
                    <div className="subtle">
                      {object?.label ?? request.objectKey} · {requestedBy?.name ?? request.requestedById} · {formatAuditTime(request.createdAt)}
                    </div>
                  </div>
                  <span className={request.action === "delete" ? "danger-badge" : "badge"}>{request.action === "delete" ? "删除申请" : "修改申请"}</span>
                </div>

                <div className="record-review-reason">
                  <span>申请原因</span>
                  <strong>{request.reason}</strong>
                </div>

                {request.action === "delete" ? (
                  <div className="record-review-delete-note">
                    <strong>将删除此记录</strong>
                    <span>通过后记录会被实质删除。请确认该记录不再需要保留，且相关业务数据已处理。</span>
                  </div>
                ) : null}

                {reviewRows.length > 0 ? (
                  <div className="record-review-diff-table" data-testid={`record-change-diff-${request.id}`}>
                    <div className="record-review-diff-head">
                      <span>字段</span>
                      <span>当前值</span>
                      <span>{request.action === "delete" ? "记录值" : "申请值"}</span>
                    </div>
                    {reviewRows.map((row) => (
                      <div className="record-review-diff-row" key={`${request.id}-${row.key}`}>
                        <strong>{row.label}</strong>
                        <span className="record-review-value old-value">{row.oldValue || "空"}</span>
                        <span className="record-review-value new-value">{row.newValue || "空"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact-empty">{request.action === "delete" ? "未找到可展示的记录字段。" : "此申请没有可展示的字段差异。"}</div>
                )}

                <div className="toolbar compact-toolbar" style={{ marginTop: 10 }}>
                  <button className="primary-button" data-testid={`record-change-approve-${request.id}`} type="button" onClick={() => onApprove(request)} disabled={Boolean(reviewingRequestId)}>
                    <CheckCircle2 size={15} />
                    {reviewingRequestId === request.id ? "\u5904\u7406\u4e2d" : "\u901a\u8fc7"}
                  </button>
                  <button className="danger-button" data-testid={`record-change-reject-${request.id}`} type="button" onClick={() => onReject(request)} disabled={Boolean(reviewingRequestId)}>
                    <XCircle size={15} />
                    {"\u62d2\u7edd"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 12 }}>暂无待审批的记录变更。</div>
      )}
    </section>
  );
}

function buildRecordReviewRows(request: RecordChangeRequest, record: CrmRecord | undefined, fields: FieldDefinition[], users: User[]): RecordReviewRow[] {
  const rows: RecordReviewRow[] = [];
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));

  if (request.action === "delete") {
    if (!record) {
      return rows;
    }
    rows.push({ key: "title", label: "名称", oldValue: record.title, newValue: record.title });
    if (record.ownerId) {
      rows.push({ key: "ownerId", label: "负责人", oldValue: formatRecordReviewOwner(record.ownerId, users), newValue: formatRecordReviewOwner(record.ownerId, users) });
    }
    for (const field of fields) {
      if (!(field.key in record.data)) {
        continue;
      }
      rows.push({
        key: field.key,
        label: field.label,
        oldValue: formatRecordReviewValue(field, record.data[field.key], users),
        newValue: formatRecordReviewValue(field, record.data[field.key], users)
      });
    }
    return rows;
  }

  const patch = request.patch ?? {};
  if ("title" in patch) {
    rows.push({
      key: "title",
      label: "名称",
      oldValue: record?.title ?? "",
      newValue: formatRecordReviewValue(undefined, patch.title, users)
    });
  }
  if ("stageKey" in patch) {
    rows.push({
      key: "stageKey",
      label: "阶段",
      oldValue: record?.stageKey ?? "",
      newValue: formatRecordReviewValue(undefined, patch.stageKey, users)
    });
  }
  if ("ownerId" in patch) {
    rows.push({
      key: "ownerId",
      label: "负责人",
      oldValue: formatRecordReviewOwner(record?.ownerId, users),
      newValue: formatRecordReviewOwner(typeof patch.ownerId === "string" ? patch.ownerId : undefined, users)
    });
  }

  const patchData = isRecordReviewObject(patch.data) ? patch.data : {};
  const dataKeys = uniqueSorted(Object.keys(patchData));
  for (const key of dataKeys) {
    const field = fieldByKey.get(key);
    const oldValue = record?.data[key];
    const newValue = patchData[key];
    if (recordReviewValueKey(oldValue) === recordReviewValueKey(newValue)) {
      continue;
    }
    rows.push({
      key,
      label: field?.label ?? fieldLabelFromKey(key),
      oldValue: formatRecordReviewValue(field, oldValue, users),
      newValue: formatRecordReviewValue(field, newValue, users)
    });
  }

  return rows;
}

function isRecordReviewObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordReviewValueKey(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatRecordReviewOwner(ownerId: string | undefined, users: User[]): string {
  if (!ownerId) {
    return "公海";
  }
  const user = users.find((item) => item.id === ownerId);
  return user ? `${user.name} · ${user.email}` : ownerId;
}

function formatRecordReviewValue(field: FieldDefinition | undefined, value: unknown, users: User[]): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (field?.key === "contactMethods") {
    return formatContactMethodsForReview(value);
  }
  if (field?.type === "user") {
    return formatRecordReviewOwner(typeof value === "string" ? value : undefined, users);
  }
  if (field?.type === "boolean") {
    return value === true || value === "true" ? "是" : "否";
  }
  if (field?.type === "select") {
    const optionValue = String(value);
    return field.options?.find((option) => option.value === optionValue)?.label ?? optionValue;
  }
  if (field?.type === "date" && typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatRecordReviewNestedValue(item)).join("\n");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function formatContactMethodsForReview(value: unknown): string {
  if (!Array.isArray(value)) {
    return formatRecordReviewNestedValue(value);
  }
  return value
    .map((item) => {
      if (!isRecordReviewObject(item)) {
        return formatRecordReviewNestedValue(item);
      }
      const type = typeof item.type === "string" ? contactMethodReviewLabels[item.type] ?? fieldLabelFromKey(item.type) : "联系方式";
      const methodValue = typeof item.value === "string" ? item.value : "";
      const label = typeof item.label === "string" && item.label.trim() ? ` · ${item.label.trim()}` : "";
      const primary = item.primary === true ? "（主）" : "";
      return `${type}: ${methodValue}${label}${primary}`;
    })
    .filter(Boolean)
    .join("\n");
}

function formatRecordReviewNestedValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "空";
  }
  if (isRecordReviewObject(value)) {
    const parts = Object.entries(value)
      .filter(([, itemValue]) => itemValue !== undefined && itemValue !== null && itemValue !== "")
      .map(([key, itemValue]) => `${fieldLabelFromKey(key)}: ${formatRecordReviewNestedValue(itemValue)}`);
    return parts.length > 0 ? parts.join("；") : "空";
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatRecordReviewNestedValue(item)).join("\n");
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  return String(value);
}

const contactMethodReviewLabels: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  mobile: "Mob",
  phone: "Tel",
  social: "社媒",
  other: "其他"
};

function fieldLabelFromKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^./, (value) => value.toUpperCase());
}

function BackupOperationsPanel({ backups, isPending, onCreate }: { backups: BackupFile[]; isPending: boolean; onCreate: () => void }) {
  return (
    <section className="settings-panel audit-panel">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title">数据库备份</h2>
          <div className="subtle">使用现有 Docker Compose pg_dump 脚本创建私有化部署备份</div>
        </div>
        <button className="primary-button" data-testid="settings-create-backup" type="button" onClick={onCreate} disabled={isPending}>
          <Download size={16} />
          创建备份
        </button>
      </div>

      {backups.length > 0 ? (
        <div className="activity-list" style={{ marginTop: 12 }}>
          {backups.slice(0, 8).map((backup) => (
            <article className="activity-item" data-testid={`settings-backup-row-${backup.name}`} key={backup.path}>
              <div className="stage-header">
                <strong>{backup.name}</strong>
                <span className="badge">{formatBytes(backup.sizeBytes)}</span>
              </div>
              <div className="subtle">{formatAuditTime(backup.createdAt)}</div>
              <code className="audit-details">{backup.path}</code>
              <a className="secondary-button" data-testid={`settings-backup-download-${backup.name}`} href={`/api/backups/${encodeURIComponent(backup.name)}/download`} download={backup.name} style={{ marginTop: 10 }}>
                <Download size={15} />
                下载备份
              </a>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 12 }}>No backup files found in the configured backup directory.</div>
      )}
    </section>
  );
}

function SettingsReferenceFilterInput({
  field,
  records,
  value,
  onChange
}: {
  field: FieldDefinition;
  records: CrmRecord[];
  value: string;
  onChange: (value: string) => void;
}) {
  const referencedObjectKey = field.options?.[0]?.value;
  const [search, setSearch] = useState("");
  const [remoteRecords, setRemoteRecords] = useState<CrmRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const candidates = useMemo(
    () =>
      mergeRecords(
        records.filter((record) => record.objectKey === referencedObjectKey),
        remoteRecords.filter((record) => record.objectKey === referencedObjectKey)
      ),
    [records, referencedObjectKey, remoteRecords]
  );

  useEffect(() => {
    if (!referencedObjectKey || search.trim().length < 2) {
      setIsSearching(false);
      setSearchError(null);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsSearching(true);
      setSearchError(null);
      fetchJson<{ records: CrmRecord[] }>(`/api/records/${referencedObjectKey}?q=${encodeURIComponent(search.trim())}&page=1&pageSize=20`, {
        method: "GET",
        signal: controller.signal
      })
        .then((result) => setRemoteRecords((current) => mergeRecords(current, result.records)))
        .catch((fetchError) => {
          if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
            return;
          }
          setSearchError(fetchError instanceof Error ? fetchError.message : "引用记录搜索失败");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSearching(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [referencedObjectKey, search]);

  useEffect(() => {
    if (!referencedObjectKey || !value || candidates.some((candidate) => candidate.id === value)) {
      return undefined;
    }

    const controller = new AbortController();
    fetchJson<CrmRecord>(`/api/records/${referencedObjectKey}/${value}`, { method: "GET", signal: controller.signal })
      .then((record) => setRemoteRecords((current) => mergeRecords(current, [record])))
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
          return;
        }
        setSearchError(fetchError instanceof Error ? fetchError.message : "引用记录加载失败");
      });

    return () => controller.abort();
  }, [candidates, referencedObjectKey, value]);

  return (
    <label>
      <span className="subtle">{field.label}</span>
      <input
        className="input"
        data-testid="settings-view-filter-value-search"
        disabled={!referencedObjectKey}
        placeholder="搜索引用记录"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        style={{ marginBottom: 8 }}
      />
      <select
        className="select"
        data-testid="settings-view-filter-value"
        disabled={!referencedObjectKey}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{isSearching ? "搜索中..." : "请选择"}</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.title}
          </option>
        ))}
      </select>
      {searchError ? <span className="subtle">{searchError}</span> : null}
    </label>
  );
}

function SettingsOwnerFilterInput({
  users,
  value,
  onChange
}: {
  users: User[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="subtle">负责人</span>
      <select className="select" data-testid="settings-view-filter-value" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} · {user.email}
          </option>
        ))}
      </select>
    </label>
  );
}

function mergeRecords(...groups: CrmRecord[][]): CrmRecord[] {
  return [...new Map(groups.flat().map((record) => [record.id, record])).values()];
}

function ImportQueueMonitor({ summary, users }: { summary: ImportJobQueueSummary; users: User[] }) {
  const statusTiles = [
    { label: "Queued", value: summary.queued },
    { label: "Processing", value: summary.processing },
    { label: "Completed", value: summary.completed },
    { label: "Failed", value: summary.failed },
    { label: "Cancelled", value: summary.cancelled },
    { label: "Dead letter", value: summary.deadLettered }
  ];

  return (
    <section className="settings-panel audit-panel">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title">导入队列</h2>
          <div className="subtle">CSV import worker health</div>
        </div>
        <span className={summary.failed > 0 || summary.deadLettered > 0 ? "danger-badge" : "badge"}>{summary.total} jobs</span>
      </div>

      <div className="metric-grid" style={{ marginTop: 12 }}>
        {statusTiles.map((item) => (
          <div className="metric-card" key={item.label}>
            <div className="subtle">{item.label}</div>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <div className="settings-grid" style={{ marginTop: 16 }}>
        <QueueJobList title="Recent jobs" jobs={summary.recentJobs} users={users} />
        <QueueJobList title="Recent failures" jobs={summary.recentFailures} users={users} emptyMessage="No failed import jobs" />
      </div>
    </section>
  );
}

function QueueJobList({
  title,
  jobs,
  users,
  emptyMessage = "No import jobs"
}: {
  title: string;
  jobs: CsvImportJob[];
  users: User[];
  emptyMessage?: string;
}) {
  return (
    <div className="settings-card">
      <div className="stage-header">
        <strong>{title}</strong>
        <span className="badge">{jobs.length}</span>
      </div>
      {jobs.length > 0 ? (
        <div className="activity-list" style={{ marginTop: 12 }}>
          {jobs.map((job) => (
            <article className="activity-item" key={job.id}>
              <div className="stage-header">
                <strong>{job.objectKey}</strong>
                <span className={job.status === "failed" ? "danger-badge" : "badge"}>{job.status}</span>
              </div>
              <div className="subtle">
                {job.createdCount} created · {job.result?.updated?.length ?? 0} updated · {job.errorCount} failed · {job.totalRows} rows · {job.strategy}
              </div>
              <div className="subtle">
                {formatAuditTime(job.createdAt)} · {users.find((user) => user.id === job.requestedById)?.name ?? "System"}
              </div>
              {job.errorMessage ? <div className="subtle">{job.errorMessage}</div> : null}
              {job.result?.errors[0] ? <div className="subtle">{job.result.errors[0]}</div> : null}
              <ImportJobDetails job={job} />
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 12 }}>{emptyMessage}</div>
      )}
    </div>
  );
}

function ImportJobDetails({ job }: { job: CsvImportJob }) {
  const details = buildImportJobObservability(job);

  if (!job.preview && !job.result && details.mappingEntries.length === 0 && !details.presetName) {
    return null;
  }

  return (
    <details className="activity-item" style={{ marginTop: 10 }}>
      <summary>Import details</summary>
      {details.presetName ? <div className="subtle" style={{ marginTop: 8 }}>Preset: {details.presetName}</div> : null}
      {details.headers.length > 0 ? <div className="subtle" style={{ marginTop: 8 }}>Headers: {details.headers.join(", ")}</div> : null}
      {details.mappingEntries.length > 0 ? (
        <div className="subtle">Mapping: {details.mappingEntries.map((entry) => `${entry.header} -> ${entry.target}`).join(", ")}</div>
      ) : null}
      {details.unmappedHeaders.length > 0 ? <div className="subtle">Unmapped headers: {details.unmappedHeaders.join(", ")}</div> : null}
      {details.issueBuckets.length > 0 ? (
        <div className="subtle">Issue distribution: {details.issueBuckets.map((bucket) => `${formatImportIssueBucket(bucket.label)} ${bucket.count}`).join(", ")}</div>
      ) : null}
      <div className="metric-grid" style={{ marginTop: 10 }}>
        <div className="metric-card">
          <div className="subtle">Created</div>
          <strong>{details.createdSamples.length}</strong>
        </div>
        <div className="metric-card">
          <div className="subtle">Updated</div>
          <strong>{details.updatedSamples.length}</strong>
        </div>
        <div className="metric-card">
          <div className="subtle">Conflicts</div>
          <strong>{details.conflictSamples.length}</strong>
        </div>
        <div className="metric-card">
          <div className="subtle">Errors</div>
          <strong>{details.errorSamples.length}</strong>
        </div>
      </div>
      {details.createdSamples.slice(0, 3).map((record) => (
        <div className="subtle" key={`created-${record.id}`}>Created: {record.title}</div>
      ))}
      {details.updatedSamples.slice(0, 3).map((record) => (
        <div className="subtle" key={`updated-${record.id}`}>Updated: {record.title}</div>
      ))}
      {details.conflictSamples.slice(0, 3).map((conflict) => (
        <div className="subtle" key={`conflict-${conflict.rowNumber}-${conflict.fieldKey}`}>
          Conflict: row {conflict.rowNumber} {conflict.fieldLabel} matches {conflict.existingRecordTitle}
        </div>
      ))}
      {details.errorSamples.slice(0, 3).map((item) => (
        <div className="subtle" key={item}>Error: {item}</div>
      ))}
      {details.errorSamples.length + details.conflictSamples.length > 0 ? (
        <a className="secondary-button" href={`/api/imports/jobs/${job.id}/issues`} download={`import-${job.id}-issues.csv`} style={{ marginTop: 10 }}>
          <Download size={15} />
          Download issue rows
        </a>
      ) : null}
    </details>
  );
}

function formatImportIssueBucket(label: string): string {
  if (label === "validation") return "validation";
  if (label === "conflict") return "conflict";
  if (label === "job_error") return "job error";
  if (label === "aborted") return "aborted";
  return label;
}

function RoleAdminPanel({
  roles,
  users,
  selectedRoleId,
  selectedRole,
  roleDraft,
  isPending,
  currentRoleId,
  onSelectRole,
  onNewRole,
  onNameChange,
  onTogglePermission,
  onSave,
  onDelete
}: {
  roles: Role[];
  users: User[];
  selectedRoleId: string;
  selectedRole?: Role;
  roleDraft: RoleDraft;
  isPending: boolean;
  currentRoleId: string;
  onSelectRole: (roleId: string) => void;
  onNewRole: () => void;
  onNameChange: (name: string) => void;
  onTogglePermission: (permission: Permission, enabled: boolean) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const assignedUsers = selectedRole ? users.filter((user) => user.roleId === selectedRole.id) : [];

  return (
    <section className="settings-panel">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title">角色配置</h2>
          <div className="subtle">为私有化团队配置可复用角色。已分配给用户的角色不能直接删除。</div>
        </div>
        <button className="secondary-button" data-testid="settings-new-role" type="button" onClick={onNewRole} disabled={isPending}>
          <Plus size={16} />
          新建角色
        </button>
      </div>

      <div className="settings-editor-grid">
        <div className="settings-list">
          {roles.map((role) => {
            const roleUsers = users.filter((user) => user.roleId === role.id);
            return (
              <button
                key={role.id}
                className={`settings-item settings-select ${selectedRoleId === role.id ? "selected" : ""}`}
                type="button"
                onClick={() => onSelectRole(role.id)}
              >
                <div className="stage-header">
                  <strong>{role.name}</strong>
                  {role.id === currentRoleId ? <span className="badge">当前</span> : null}
                </div>
                <div className="subtle">
                  {role.permissions.length} 项权限 · {roleUsers.length} 个用户
                </div>
              </button>
            );
          })}
        </div>

        <div className="settings-editor">
          <div className="form-grid">
            <label className="wide">
              <span className="subtle">角色名称</span>
              <input
                className="input"
                data-testid="settings-role-name"
                value={roleDraft.name}
                onChange={(event) => onNameChange(event.target.value)}
              />
            </label>
            <div className="wide permission-picker">
              {permissionCatalog.map((permission) => (
                <label className="permission-option" key={permission.key}>
                  <input
                    data-testid={`settings-role-permission-${permission.key}`}
                    type="checkbox"
                    checked={roleDraft.permissions.includes(permission.key)}
                    onChange={(event) => onTogglePermission(permission.key, event.target.checked)}
                  />
                  <span>
                    <strong>{permission.label}</strong>
                    <small>{permission.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="toolbar" style={{ marginTop: 12 }}>
            <button
              className="primary-button"
              data-testid="settings-save-role"
              type="button"
              onClick={onSave}
              disabled={isPending || !roleDraft.name.trim() || roleDraft.permissions.length === 0}
            >
              <Save size={16} />
              {selectedRole ? "保存角色" : "创建角色"}
            </button>
            {selectedRole && (
              <button
                className="danger-button"
                type="button"
                onClick={onDelete}
                disabled={isPending || assignedUsers.length > 0}
                title={assignedUsers.length > 0 ? "已有用户使用该角色，不能删除" : undefined}
              >
                <Trash2 size={16} />
                删除角色
              </button>
            )}
            {selectedRole ? <span className="subtle">{assignedUsers.length} 个用户正在使用</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function PermissionMatrix({ roles, currentRoleId }: { roles: Role[]; currentRoleId: string }) {
  return (
    <section className="settings-panel permission-panel">
      <div className="settings-panel-header">
        <div>
          <h2 className="page-title">权限矩阵</h2>
          <div className="subtle">按角色查看当前 RBAC 能力边界，后续角色编辑会沿用这份权限目录。</div>
        </div>
        <span className="badge">
          <ShieldCheck size={14} />
          {roles.length} 个角色
        </span>
      </div>

      <div className="permission-table-shell">
        <table className="permission-table">
          <thead>
            <tr>
              <th>权限</th>
              {roles.map((role) => (
                <th key={role.id}>
                  {role.name}
                  {role.id === currentRoleId ? <span className="permission-current">当前</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissionCatalog.map((permission) => (
              <tr key={permission.key}>
                <td>
                  <div className="permission-name">
                    <strong>{permission.label}</strong>
                    <span className={`permission-risk permission-risk-${permission.risk}`}>{permission.risk}</span>
                  </div>
                  <div className="subtle">{permission.description}</div>
                  <code className="permission-key">{permission.key}</code>
                </td>
                {roles.map((role) => {
                  const enabled = role.permissions.includes(permission.key);
                  return (
                    <td key={`${role.id}-${permission.key}`} className="permission-state-cell">
                      <span className={`permission-state ${enabled ? "permission-state-on" : "permission-state-off"}`}>
                        {enabled ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                        {enabled ? "已启用" : "未启用"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function emptyObjectDraft(): ObjectDraft {
  return { key: "", label: "", pluralLabel: "", description: "" };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function formatAuditTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatAuditDetails(details: Record<string, unknown>): string {
  const text = JSON.stringify(details);
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function emptyFieldDraft(objectKey: string): FieldDraft {
  return {
    objectKey,
    key: "",
    label: "",
    type: "text",
    required: false,
    unique: false,
    optionsText: "",
    referenceObjectKey: "",
    position: ""
  };
}

function emptyRelationDraft(objectKey: string): RelationDraft {
  return {
    fromObjectKey: objectKey,
    toObjectKey: objectKey,
    key: "",
    label: "",
    cardinality: "one-to-many"
  };
}

function emptyPipelineDraft(objectKey: string): PipelineDraft {
  return {
    objectKey,
    name: "",
    isDefault: false,
    stagesText: "new|新阶段|0.1|#2563eb"
  };
}

function emptyViewDraft(objectKey: string): ViewDraft {
  return {
    objectKey,
    name: "",
    columnsText: "title",
    sortField: "",
    sortDirection: "asc",
    isDefault: false,
    filterField: "",
    filterOperator: "contains",
    filterValue: ""
  };
}

function emptyRoleDraft(): RoleDraft {
  return {
    name: "",
    permissions: ["crm.read"]
  };
}

function emptyUserDraft(roleId: string, teamId: string): UserDraft {
  return {
    email: "",
    name: "",
    roleId,
    teamId,
    password: "",
    active: true
  };
}

function emptyTeamDraft(): TeamDraft {
  return { name: "" };
}

function emptyApiKeyDraft(): ApiKeyDraft {
  return {
    name: "",
    permissions: ["crm.read"],
    expiresAt: ""
  };
}

function emptyWebhookDraft(): WebhookDraft {
  return {
    name: "",
    url: "",
    events: ["webhook.test"],
    active: true
  };
}

function emptyNotificationChannelDraft(): NotificationChannelDraft {
  return {
    name: "",
    type: "bark",
    events: ["record.created", "record.updated", "activity.created"],
    active: true,
    barkEndpoint: "https://api.day.app",
    barkDeviceKey: "",
    webhookUrl: "https://example.com/notify",
    recipients: "",
    accountId: ""
  };
}

function notificationChannelDraftFromChannel(channel: NotificationChannel): NotificationChannelDraft {
  const config = channel.config ?? {};

  return {
    name: channel.name,
    type: channel.type,
    events: channel.events,
    active: channel.active,
    barkEndpoint: typeof config.barkEndpoint === "string" ? config.barkEndpoint : "https://api.day.app",
    barkDeviceKey: typeof config.barkDeviceKey === "string" ? config.barkDeviceKey : "",
    webhookUrl: typeof config.url === "string" ? config.url : "https://example.com/notify",
    recipients: Array.isArray(config.recipients)
      ? config.recipients.filter((item): item is string => typeof item === "string").join(", ")
      : "",
    accountId: typeof config.accountId === "string" ? config.accountId : ""
  };
}

function notificationChannelPayload(draft: NotificationChannelDraft) {
  const config =
    draft.type === "bark"
      ? {
          barkEndpoint: draft.barkEndpoint.trim() || "https://api.day.app",
          barkDeviceKey: draft.barkDeviceKey.trim()
        }
      : draft.type === "webhook"
        ? {
            url: draft.webhookUrl.trim()
          }
        : {
            recipients: draft.recipients
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            ...(draft.accountId ? { accountId: draft.accountId } : {})
          };

  return {
    name: draft.name.trim(),
    type: draft.type,
    events: draft.events,
    active: draft.active,
    config
  };
}

function notificationChannelTypeLabel(type: NotificationChannelType): string {
  if (type === "bark") {
    return "Bark";
  }

  if (type === "webhook") {
    return "Webhook";
  }

  return "Email";
}

function emptyCurrencyDraft(): CurrencyDraft {
  return {
    code: "",
    label: "",
    symbol: "",
    rateToBase: "1",
    isBase: false,
    active: true
  };
}

function currencyDraftFromRecord(record: CrmRecord): CurrencyDraft {
  return {
    code: normalizeCurrencyCode(record.data.code || record.title),
    label: typeof record.data.label === "string" ? record.data.label : record.title,
    symbol: typeof record.data.symbol === "string" ? record.data.symbol : "",
    rateToBase: String(record.data.rateToBase ?? "1"),
    isBase: record.data.isBase === true,
    active: record.data.active !== false
  };
}

function buildAuditExportUrl(query: {
  action?: string;
  entityType?: string;
  objectKey?: string;
  actorId?: string;
  q?: string;
}): string {
  const params = new URLSearchParams({ pageSize: "1000" });
  if (query.action) params.set("action", query.action);
  if (query.entityType?.trim()) params.set("entityType", query.entityType.trim());
  if (query.objectKey?.trim()) params.set("objectKey", query.objectKey.trim());
  if (query.actorId?.trim()) params.set("actorId", query.actorId.trim());
  if (query.q?.trim()) params.set("q", query.q.trim());
  return `/api/audit-logs/export?${params.toString()}`;
}

function formatFieldOptions(field: FieldDefinition): string {
  if (field.type === "reference") {
    return "";
  }
  return (field.options ?? []).map((option) => `${option.label}:${option.value}`).join("\n");
}

function parseFieldOptions(draft: FieldDraft, objects: ObjectDefinition[]) {
  if (draft.type === "reference") {
    const target = objects.find((object) => object.key === draft.referenceObjectKey);
    if (!target) {
      return undefined;
    }
    return [{ label: target.label, value: target.key }];
  }

  if (draft.type !== "select") {
    return undefined;
  }

  return parseSelectOptionsText(draft.optionsText);
}

function parseSelectOptionsText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, value] = line.includes(":") ? line.split(":", 2) : [line, line];
      return { label: label.trim(), value: value.trim() };
    });
}

function formatStages(stages: Pipeline["stages"]): string {
  return stages.map((stage) => `${stage.key}|${stage.label}|${stage.probability}|${stage.color}`).join("\n");
}

function parseStages(text: string): Pipeline["stages"] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [key, label, probability, color] = line.split("|").map((part) => part.trim());
      return {
        key,
        label,
        probability: Number(probability),
        color: color || "#2563eb",
        position: index + 1
      };
    });
}

function formatViewDraft(view: SavedView): ViewDraft {
  return {
    objectKey: view.objectKey,
    name: view.name,
    columnsText: view.columns.join(", "),
    sortField: view.sort?.field ?? "",
    sortDirection: view.sort?.direction ?? "asc",
    isDefault: view.isDefault,
    filterField: view.filters?.[0]?.field ?? "",
    filterOperator: view.filters?.[0]?.operator ?? "contains",
    filterValue: view.filters?.[0]?.value ?? ""
  };
}

async function fetchJson<T = unknown>(
  url: string,
  options: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  }
): Promise<T> {
  const response = await fetch(url, {
    method: options.method,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "请求失败");
  }

  return (await response.json().catch(() => ({}))) as T;
}

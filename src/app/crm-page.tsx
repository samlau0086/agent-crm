import { notFound } from "next/navigation";
import { CrmWorkspace } from "@/components/crm-workspace";
import { requireAppContext } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import type { CrmRecord, FieldDefinition, RelationDefinition } from "@/lib/crm/types";
import { resolveCrmRoute } from "@/lib/crm/navigation";
import { listBackupFiles } from "@/lib/ops/backups";

type CrmPageProps = {
  moduleSegments?: string[];
  searchParams?: Record<string, string | string[] | undefined>;
};

export async function CrmPage({ moduleSegments = [], searchParams = {} }: CrmPageProps) {
  const context = await requireAppContext();
  const repository = getCrmRepository();
  const objects = await repository.listObjectDefinitions(context);
  const fields = await repository.listFieldDefinitions(context);
  const route = resolveCrmRoute(
    moduleSegments,
    objects.map((object) => object.key)
  );

  if (!route) {
    notFound();
  }

  const relations = await repository.listRelationDefinitions(context);
  const pipelines = await repository.listPipelines(context);
  const users = await repository.getUsers(context);
  const teams = await repository.listTeams(context);
  const roles = context.role.permissions.includes("crm.admin") ? await repository.listRoles(context) : [];
  const apiKeys = context.role.permissions.includes("crm.admin") ? await repository.listApiKeys(context) : [];
  const webhooks = context.role.permissions.includes("crm.admin") ? await repository.listWebhooks(context) : [];
  const notificationChannels = context.role.permissions.includes("crm.admin") ? await repository.listNotificationChannels(context) : [];
  const emailAccounts = await repository.listEmailAccounts(context);
  const emailSignatures = await repository.listEmailSignatures(context);
  const emailThreads = await repository.listEmailThreads(context);
  const emailAiSettings = await repository.getEmailAiSettings(context);
  const emailSyncSettings = context.role.permissions.includes("crm.admin") ? await repository.getEmailSyncSettings(context) : undefined;
  const poolSettings = await repository.getPoolSettings(context);
  const smartReminderSettings = await repository.getSmartReminderSettings(context);
  const recordChangeRequests = await repository.listRecordChangeRequests(context, "pending");
  const knowledgeArticles = await repository.listKnowledgeArticles(context);
  const mediaAssets = await repository.listMediaAssets(context);
  const dashboardSummary = await repository.getDashboardSummary(context);
  const auditLogs = context.role.permissions.includes("crm.admin") ? await repository.listAuditLogs(context) : [];
  const backupFiles = context.role.permissions.includes("crm.admin") ? await listBackupFiles() : [];
  const importJobs = context.role.permissions.includes("crm.import") ? await repository.listImportJobs(context) : [];
  const importPresets = context.role.permissions.includes("crm.import") ? await repository.listImportPresets(context) : [];
  const importJobQueueSummary = context.role.permissions.includes("crm.admin") ? await repository.getImportJobQueueSummary(context) : undefined;
  const workflows = context.role.permissions.some((permission) => permission === "workflow.read" || permission === "workflow.write" || permission === "workflow.admin" || permission === "crm.admin")
    ? await repository.listWorkflows(context)
    : [];
  const workflowRuns = workflows.length > 0 ? await repository.listWorkflowRuns(context) : [];
  const workflowApprovals = workflows.length > 0 ? await repository.listWorkflowApprovals(context) : [];
  const views = await repository.listSavedViews(context);
  const initialObjectKey = route.objectKey;
  const initialRecordList = await repository.queryRecords(context, initialObjectKey, { page: 1, pageSize: 50 });
  const routeRecordId = getSingleSearchParam(searchParams.recordId);
  const selectedRecord = routeRecordId
    ? await repository.getRecord(context, initialObjectKey, routeRecordId).catch(() => undefined)
    : undefined;
  const referenceObjectKeys = getReferenceObjectKeys(fields, initialObjectKey);
  getRelationObjectKeys(relations, initialObjectKey).forEach((objectKey) => referenceObjectKeys.add(objectKey));
  for (const objectKey of ["products", "quotes", "currencies"]) {
    if (objects.some((object) => object.key === objectKey)) {
      referenceObjectKeys.add(objectKey);
    }
  }
  const referenceRecordLists = await Promise.all(
    [...referenceObjectKeys].map((objectKey) => repository.queryRecords(context, objectKey, { page: 1, pageSize: 50 }))
  );
  const records = dedupeRecords([
    ...(selectedRecord ? [selectedRecord] : []),
    ...initialRecordList.records,
    ...dashboardSummary.deals,
    ...referenceRecordLists.flatMap((list) => list.records)
  ]);
  const activities = dedupeActivities([...dashboardSummary.openTasks, ...dashboardSummary.recentActivities]);

  return (
    <CrmWorkspace
      contextUser={context.user}
      role={context.role}
      objects={objects}
      fields={fields}
      records={records}
      initialNavKey={route.navKey}
      initialObjectKey={initialObjectKey}
      initialRecordList={initialRecordList}
      dashboardSummary={dashboardSummary}
      pipelines={pipelines}
      relations={relations}
      activities={activities}
      savedViews={views}
      users={users}
      teams={teams}
      roles={roles}
      apiKeys={apiKeys}
      webhooks={webhooks}
      notificationChannels={notificationChannels}
      emailAccounts={emailAccounts}
      emailSignatures={emailSignatures}
      emailThreads={emailThreads}
      emailAiSettings={emailAiSettings}
      emailSyncSettings={emailSyncSettings}
      poolSettings={poolSettings}
      smartReminderSettings={smartReminderSettings}
      recordChangeRequests={recordChangeRequests}
      knowledgeArticles={knowledgeArticles}
      mediaAssets={mediaAssets}
      auditLogs={auditLogs}
      backupFiles={backupFiles}
      importJobs={importJobs}
      importPresets={importPresets}
      importJobQueueSummary={importJobQueueSummary}
      workflows={workflows}
      workflowRuns={workflowRuns}
      workflowApprovals={workflowApprovals}
    />
  );
}

function getSingleSearchParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function getReferenceObjectKeys(fields: FieldDefinition[], objectKey: string): Set<string> {
  return fields.reduce<Set<string>>((keys, field) => {
    if (field.objectKey === objectKey && field.type === "reference") {
      const referencedObjectKey = field.options?.[0]?.value;
      if (referencedObjectKey) {
        keys.add(referencedObjectKey);
      }
    }
    return keys;
  }, new Set());
}

function getRelationObjectKeys(relations: RelationDefinition[], objectKey: string): Set<string> {
  return relations.reduce<Set<string>>((keys, relation) => {
    if (relation.fromObjectKey === objectKey) {
      keys.add(relation.toObjectKey);
    }
    if (relation.toObjectKey === objectKey) {
      keys.add(relation.fromObjectKey);
    }
    return keys;
  }, new Set());
}

function dedupeRecords(records: CrmRecord[]): CrmRecord[] {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function dedupeActivities<T extends { id: string }>(activities: T[]): T[] {
  return [...new Map(activities.map((activity) => [activity.id, activity])).values()];
}

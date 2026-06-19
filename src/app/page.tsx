import { CrmWorkspace } from "@/components/crm-workspace";
import { requireAppContext } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import type { CrmRecord, FieldDefinition } from "@/lib/crm/types";
import { listBackupFiles } from "@/lib/ops/backups";

export const dynamic = "force-dynamic";

export default async function Home() {
  const context = await requireAppContext();
  const repository = getCrmRepository();
  const objects = await repository.listObjectDefinitions(context);
  const fields = await repository.listFieldDefinitions(context);
  const relations = await repository.listRelationDefinitions(context);
  const pipelines = await repository.listPipelines(context);
  const users = await repository.getUsers(context);
  const teams = await repository.listTeams(context);
  const roles = context.role.permissions.includes("crm.admin") ? await repository.listRoles(context) : [];
  const apiKeys = context.role.permissions.includes("crm.admin") ? await repository.listApiKeys(context) : [];
  const webhooks = context.role.permissions.includes("crm.admin") ? await repository.listWebhooks(context) : [];
  const dashboardSummary = await repository.getDashboardSummary(context);
  const auditLogs = context.role.permissions.includes("crm.admin") ? await repository.listAuditLogs(context) : [];
  const backupFiles = context.role.permissions.includes("crm.admin") ? await listBackupFiles() : [];
  const importJobs = context.role.permissions.includes("crm.import") ? await repository.listImportJobs(context) : [];
  const importPresets = context.role.permissions.includes("crm.import") ? await repository.listImportPresets(context) : [];
  const importJobQueueSummary = context.role.permissions.includes("crm.admin") ? await repository.getImportJobQueueSummary(context) : undefined;
  const views = await repository.listSavedViews(context);
  const initialObjectKey = "contacts";
  const initialRecordList = await repository.queryRecords(context, initialObjectKey, { page: 1, pageSize: 50 });
  const referenceObjectKeys = getReferenceObjectKeys(fields, initialObjectKey);
  const referenceRecordLists = await Promise.all(
    [...referenceObjectKeys].map((objectKey) => repository.queryRecords(context, objectKey, { page: 1, pageSize: 50 }))
  );
  const records = dedupeRecords([
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
      auditLogs={auditLogs}
      backupFiles={backupFiles}
      importJobs={importJobs}
      importPresets={importPresets}
      importJobQueueSummary={importJobQueueSummary}
    />
  );
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

function dedupeRecords(records: CrmRecord[]): CrmRecord[] {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function dedupeActivities<T extends { id: string }>(activities: T[]): T[] {
  return [...new Map(activities.map((activity) => [activity.id, activity])).values()];
}

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password.ts";
import { demoCredentials, seedData } from "../src/lib/crm/seed.ts";

const prisma = new PrismaClient();

async function main() {
  await prisma.session.deleteMany();
  await prisma.importJob.deleteMany();
  await prisma.importPreset.deleteMany();
  await prisma.emailMessage.deleteMany();
  await prisma.emailThread.deleteMany();
  await prisma.emailAccount.deleteMany();
  await prisma.knowledgeArticle.deleteMany();
  await prisma.emailAiSettings.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.savedView.deleteMany();
  await prisma.pipeline.deleteMany();
  await prisma.crmRecord.deleteMany();
  await prisma.fieldDefinition.deleteMany();
  await prisma.relationDefinition.deleteMany();
  await prisma.objectDefinition.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.team.deleteMany();
  await prisma.workspace.deleteMany();

  for (const workspace of seedData.workspaces) {
    await prisma.workspace.create({ data: workspace });
  }

  for (const role of seedData.roles) {
    await prisma.role.create({
      data: {
        id: role.id,
        workspaceId: role.workspaceId,
        name: role.name,
        permissions: role.permissions
      }
    });
  }

  for (const team of seedData.teams) {
    await prisma.team.create({ data: team });
  }

  for (const user of seedData.users) {
    const password =
      user.email === demoCredentials.admin.email ? demoCredentials.admin.password : demoCredentials.sales.password;
    await prisma.user.create({
      data: {
        id: user.id,
        workspaceId: user.workspaceId,
        email: user.email,
        name: user.name,
        passwordHash: hashPassword(password),
        roleId: user.roleId,
        teamId: user.teamId,
        active: user.active,
        disabledAt: user.disabledAt ? new Date(user.disabledAt) : null
      }
    });
  }

  const objectIdByKey = new Map<string, string>();
  for (const object of seedData.objectDefinitions) {
    await prisma.objectDefinition.create({
      data: {
        id: object.id,
        workspaceId: object.workspaceId,
        key: object.key,
        label: object.label,
        pluralLabel: object.pluralLabel,
        description: object.description,
        icon: object.icon,
        isSystem: object.isSystem,
        createdAt: new Date(object.createdAt),
        updatedAt: new Date(object.updatedAt)
      }
    });
    objectIdByKey.set(object.key, object.id);
  }

  for (const field of seedData.fieldDefinitions) {
    await prisma.fieldDefinition.create({
      data: {
        id: field.id,
        workspaceId: field.workspaceId,
        objectDefinitionId: objectIdByKey.get(field.objectKey)!,
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        unique: field.unique,
        options: field.options,
        defaultValue: field.defaultValue,
        isSystem: field.isSystem,
        position: field.position
      }
    });
  }

  for (const relation of seedData.relationDefinitions) {
    await prisma.relationDefinition.create({ data: relation });
  }

  for (const record of seedData.records) {
    await prisma.crmRecord.create({
      data: {
        id: record.id,
        workspaceId: record.workspaceId,
        objectKey: record.objectKey,
        title: record.title,
        stageKey: record.stageKey,
        ownerId: record.ownerId,
        data: record.data,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt)
      }
    });
  }

  for (const pipeline of seedData.pipelines) {
    await prisma.pipeline.create({
      data: {
        id: pipeline.id,
        workspaceId: pipeline.workspaceId,
        objectKey: pipeline.objectKey,
        name: pipeline.name,
        isDefault: pipeline.isDefault,
        stages: pipeline.stages
      }
    });
  }

  for (const activity of seedData.activities) {
    await prisma.activity.create({
      data: {
        id: activity.id,
        workspaceId: activity.workspaceId,
        recordId: activity.recordId,
        type: activity.type,
        title: activity.title,
        body: activity.body,
        actorId: activity.actorId,
        dueAt: activity.dueAt ? new Date(activity.dueAt) : undefined,
        completedAt: activity.completedAt ? new Date(activity.completedAt) : undefined,
        createdAt: new Date(activity.createdAt)
      }
    });
  }

  for (const account of seedData.emailAccounts) {
    await prisma.emailAccount.create({
      data: {
        id: account.id,
        workspaceId: account.workspaceId,
        name: account.name,
        emailAddress: account.emailAddress,
        provider: account.provider,
        status: account.status,
        syncEnabled: account.syncEnabled,
        sendEnabled: account.sendEnabled,
        createdById: account.createdById,
        lastSyncedAt: account.lastSyncedAt ? new Date(account.lastSyncedAt) : undefined,
        createdAt: new Date(account.createdAt),
        updatedAt: new Date(account.updatedAt)
      }
    });
  }

  for (const signature of seedData.emailSignatures ?? []) {
    await prisma.emailSignature.create({
      data: {
        id: signature.id,
        workspaceId: signature.workspaceId,
        accountId: signature.accountId,
        name: signature.name,
        bodyText: signature.bodyText,
        bodyHtml: signature.bodyHtml,
        isDefault: signature.isDefault,
        active: signature.active,
        createdById: signature.createdById,
        createdAt: new Date(signature.createdAt),
        updatedAt: new Date(signature.updatedAt)
      }
    });
  }

  for (const article of seedData.knowledgeArticles) {
    await prisma.knowledgeArticle.create({
      data: {
        id: article.id,
        workspaceId: article.workspaceId,
        title: article.title,
        body: article.body,
        tags: article.tags,
        active: article.active,
        createdById: article.createdById,
        createdAt: new Date(article.createdAt),
        updatedAt: new Date(article.updatedAt)
      }
    });
  }

  for (const settings of seedData.emailAiSettings) {
    await prisma.emailAiSettings.create({
      data: {
        workspaceId: settings.workspaceId,
        features: settings.features,
        agents: settings.agents,
        defaultLocale: settings.defaultLocale,
        requireSourceLinks: settings.requireSourceLinks,
        maxHistoryMessages: settings.maxHistoryMessages,
        maxKnowledgeArticles: settings.maxKnowledgeArticles,
        maxContextChars: settings.maxContextChars,
        updatedAt: new Date(settings.updatedAt)
      }
    });
  }

  for (const view of seedData.savedViews) {
    await prisma.savedView.create({
      data: {
        id: view.id,
        workspaceId: view.workspaceId,
        objectDefinitionId: objectIdByKey.get(view.objectKey)!,
        name: view.name,
        columns: view.columns,
        filters: view.filters,
        sort: view.sort,
        isDefault: view.isDefault
      }
    });
  }

  for (const preset of seedData.importPresets) {
    await prisma.importPreset.create({
      data: {
        id: preset.id,
        workspaceId: preset.workspaceId,
        objectKey: preset.objectKey,
        name: preset.name,
        strategy: preset.strategy,
        mapping: preset.mapping,
        createdById: preset.createdById,
        createdAt: new Date(preset.createdAt),
        updatedAt: new Date(preset.updatedAt)
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

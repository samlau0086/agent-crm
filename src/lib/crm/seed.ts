import type { CrmSnapshot } from "@/lib/crm/types";

const now = new Date("2026-06-17T12:00:00.000Z").toISOString();

export const defaultWorkspaceId = "workspace-private";
export const adminUserId = "user-admin";
export const salesUserId = "user-sales";

export const demoCredentials = {
  admin: {
    email: "admin@example.com",
    password: "Admin123!"
  },
  sales: {
    email: "sales@example.com",
    password: "Sales123!"
  }
};

export const seedData: CrmSnapshot = {
  workspaces: [{ id: defaultWorkspaceId, name: "私有化 CRM", slug: "private-crm" }],
  roles: [
    {
      id: "role-admin",
      workspaceId: defaultWorkspaceId,
      name: "管理员",
      permissions: ["crm.read", "crm.write", "crm.import", "crm.admin", "ai.use"]
    },
    {
      id: "role-sales",
      workspaceId: defaultWorkspaceId,
      name: "销售",
      permissions: ["crm.read", "crm.write", "ai.use"]
    }
  ],
  teams: [{ id: "team-sales", workspaceId: defaultWorkspaceId, name: "销售团队" }],
  users: [
    {
      id: adminUserId,
      workspaceId: defaultWorkspaceId,
      email: demoCredentials.admin.email,
      name: "系统管理员",
      roleId: "role-admin",
      teamId: "team-sales",
      active: true
    },
    {
      id: salesUserId,
      workspaceId: defaultWorkspaceId,
      email: demoCredentials.sales.email,
      name: "销售代表",
      roleId: "role-sales",
      teamId: "team-sales",
      active: true
    }
  ],
  objectDefinitions: [
    {
      id: "obj-contact",
      workspaceId: defaultWorkspaceId,
      key: "contacts",
      label: "联系人",
      pluralLabel: "联系人",
      description: "客户联系人和线索",
      icon: "UserRound",
      isSystem: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "obj-company",
      workspaceId: defaultWorkspaceId,
      key: "companies",
      label: "公司",
      pluralLabel: "公司",
      description: "客户公司与目标账户",
      icon: "Building2",
      isSystem: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "obj-deal",
      workspaceId: defaultWorkspaceId,
      key: "deals",
      label: "交易",
      pluralLabel: "交易",
      description: "销售机会与收入预测",
      icon: "BadgeDollarSign",
      isSystem: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "obj-partner",
      workspaceId: defaultWorkspaceId,
      key: "partners",
      label: "渠道伙伴",
      pluralLabel: "渠道伙伴",
      description: "示例自定义对象",
      icon: "Handshake",
      isSystem: false,
      createdAt: now,
      updatedAt: now
    }
  ],
  fieldDefinitions: [
    { id: "field-contact-email", workspaceId: defaultWorkspaceId, objectKey: "contacts", key: "email", label: "邮箱", type: "text", required: true, unique: true, isSystem: true, position: 1 },
    { id: "field-contact-phone", workspaceId: defaultWorkspaceId, objectKey: "contacts", key: "phone", label: "电话", type: "text", required: false, unique: false, isSystem: true, position: 2 },
    { id: "field-contact-company", workspaceId: defaultWorkspaceId, objectKey: "contacts", key: "companyId", label: "公司", type: "reference", required: false, unique: false, options: [{ label: "公司", value: "companies" }], isSystem: true, position: 3 },
    { id: "field-company-domain", workspaceId: defaultWorkspaceId, objectKey: "companies", key: "domain", label: "域名", type: "text", required: true, unique: true, isSystem: true, position: 1 },
    { id: "field-company-industry", workspaceId: defaultWorkspaceId, objectKey: "companies", key: "industry", label: "行业", type: "select", required: false, unique: false, options: [{ label: "软件", value: "software" }, { label: "制造", value: "manufacturing" }, { label: "金融", value: "finance" }], isSystem: true, position: 2 },
    { id: "field-deal-amount", workspaceId: defaultWorkspaceId, objectKey: "deals", key: "amount", label: "金额", type: "currency", required: true, unique: false, isSystem: true, position: 1 },
    { id: "field-deal-close-date", workspaceId: defaultWorkspaceId, objectKey: "deals", key: "closeDate", label: "预计成交日", type: "date", required: false, unique: false, isSystem: true, position: 2 },
    { id: "field-deal-company", workspaceId: defaultWorkspaceId, objectKey: "deals", key: "companyId", label: "关联公司", type: "reference", required: false, unique: false, options: [{ label: "公司", value: "companies" }], isSystem: true, position: 3 },
    { id: "field-partner-tier", workspaceId: defaultWorkspaceId, objectKey: "partners", key: "tier", label: "伙伴等级", type: "select", required: true, unique: false, options: [{ label: "金牌", value: "gold" }, { label: "银牌", value: "silver" }], isSystem: false, position: 1 }
  ],
  relationDefinitions: [
    { id: "rel-company-contacts", workspaceId: defaultWorkspaceId, fromObjectKey: "companies", toObjectKey: "contacts", key: "company_contacts", label: "公司联系人", cardinality: "one-to-many" },
    { id: "rel-company-deals", workspaceId: defaultWorkspaceId, fromObjectKey: "companies", toObjectKey: "deals", key: "company_deals", label: "公司交易", cardinality: "one-to-many" },
    { id: "rel-partner-companies", workspaceId: defaultWorkspaceId, fromObjectKey: "partners", toObjectKey: "companies", key: "partner_companies", label: "伙伴客户", cardinality: "many-to-many" }
  ],
  records: [
    {
      id: "company-acme",
      workspaceId: defaultWorkspaceId,
      objectKey: "companies",
      title: "Acme China",
      ownerId: salesUserId,
      data: { domain: "acme.example", industry: "software", annualRevenue: 12000000 },
      createdAt: now,
      updatedAt: now
    },
    {
      id: "contact-lin",
      workspaceId: defaultWorkspaceId,
      objectKey: "contacts",
      title: "林晓",
      ownerId: salesUserId,
      data: { email: "lin@example.com", phone: "+86 138 0000 0000", companyId: "company-acme" },
      createdAt: now,
      updatedAt: now
    },
    {
      id: "deal-platform",
      workspaceId: defaultWorkspaceId,
      objectKey: "deals",
      title: "Acme 销售平台采购",
      stageKey: "proposal",
      ownerId: salesUserId,
      data: { amount: 280000, closeDate: "2026-07-31", companyId: "company-acme" },
      createdAt: now,
      updatedAt: now
    }
  ],
  pipelines: [
    {
      id: "pipeline-sales",
      workspaceId: defaultWorkspaceId,
      objectKey: "deals",
      name: "默认销售管道",
      isDefault: true,
      stages: [
        { key: "new", label: "新机会", probability: 0.1, position: 1, color: "#6b7280" },
        { key: "qualified", label: "已确认", probability: 0.3, position: 2, color: "#2563eb" },
        { key: "proposal", label: "方案报价", probability: 0.55, position: 3, color: "#7c3aed" },
        { key: "negotiation", label: "商务谈判", probability: 0.75, position: 4, color: "#ea580c" },
        { key: "won", label: "赢单", probability: 1, position: 5, color: "#059669" }
      ]
    }
  ],
  activities: [
    { id: "act-1", workspaceId: defaultWorkspaceId, recordId: "deal-platform", type: "note", title: "客户关注私有化部署", body: "需要 Docker Compose 交付，后续可能接入企业 SSO。", actorId: salesUserId, createdAt: now },
    { id: "act-2", workspaceId: defaultWorkspaceId, recordId: "contact-lin", type: "task", title: "发送报价单", body: "本周五前发送正式报价。", actorId: salesUserId, dueAt: "2026-06-19T10:00:00.000Z", createdAt: now }
  ],
  auditLogs: [],
  importJobs: [],
  importPresets: [],
  apiKeys: [],
  webhooks: [],
  webhookDeliveries: [],
  emailAccounts: [],
  emailThreads: [],
  emailMessages: [],
  knowledgeArticles: [
    {
      id: "knowledge-private-deployment",
      workspaceId: defaultWorkspaceId,
      title: "私有化部署说明",
      body: "默认交付 Docker Compose 部署，包含 web、postgres、redis 和 worker。生产环境需要配置 APP_BASE_URL、数据库备份目录和安全环境变量。",
      tags: ["deployment", "private"],
      active: true,
      createdById: adminUserId,
      createdAt: now,
      updatedAt: now
    }
  ],
  emailAiSettings: [
    {
      workspaceId: defaultWorkspaceId,
      features: {
      draft: true,
      translate: true,
      auto_translate: false,
      context_analysis: true,
      auto_context_analysis: false,
      auto_summarize: true
      },
      defaultLocale: "zh-CN",
      requireSourceLinks: true,
      maxHistoryMessages: 8,
      maxKnowledgeArticles: 5,
      maxContextChars: 8000,
      updatedAt: now
    }
  ],
  savedViews: [
    { id: "view-contacts-default", workspaceId: defaultWorkspaceId, objectKey: "contacts", name: "全部联系人", columns: ["title", "email", "phone", "companyId"], isDefault: true },
    { id: "view-companies-default", workspaceId: defaultWorkspaceId, objectKey: "companies", name: "全部公司", columns: ["title", "domain", "industry"], isDefault: true },
    { id: "view-deals-default", workspaceId: defaultWorkspaceId, objectKey: "deals", name: "销售管道", columns: ["title", "amount", "closeDate", "companyId"], sort: { field: "amount", direction: "desc" }, isDefault: true }
  ]
};

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
      permissions: ["crm.read", "crm.write", "crm.import", "crm.admin", "ai.use", "ai.admin"]
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
      id: "obj-product",
      workspaceId: defaultWorkspaceId,
      key: "products",
      label: "产品",
      pluralLabel: "产品",
      description: "可报价的产品、订阅和服务",
      icon: "Package",
      isSystem: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "obj-quote",
      workspaceId: defaultWorkspaceId,
      key: "quotes",
      label: "报价",
      pluralLabel: "报价",
      description: "关联联系人和公司的销售报价",
      icon: "FileText",
      isSystem: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "obj-currency",
      workspaceId: defaultWorkspaceId,
      key: "currencies",
      label: "货币",
      pluralLabel: "货币",
      description: "报价和产品价格使用的币种与汇率",
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
    { id: "field-contact-email", workspaceId: defaultWorkspaceId, objectKey: "contacts", key: "email", label: "邮箱", type: "text", required: false, unique: true, isSystem: true, position: 1 },
    { id: "field-contact-phone", workspaceId: defaultWorkspaceId, objectKey: "contacts", key: "phone", label: "电话", type: "text", required: false, unique: false, isSystem: true, position: 2 },
    { id: "field-contact-company", workspaceId: defaultWorkspaceId, objectKey: "contacts", key: "companyId", label: "公司", type: "reference", required: false, unique: false, options: [{ label: "公司", value: "companies" }], isSystem: true, position: 3 },
    { id: "field-contact-birthday", workspaceId: defaultWorkspaceId, objectKey: "contacts", key: "birthday", label: "生日", type: "date", required: false, unique: false, isSystem: true, position: 4 },
    { id: "field-contact-gender", workspaceId: defaultWorkspaceId, objectKey: "contacts", key: "gender", label: "性别", type: "select", required: false, unique: false, options: [{ label: "女性", value: "female" }, { label: "男性", value: "male" }, { label: "非二元", value: "non_binary" }, { label: "不透露", value: "not_disclosed" }], isSystem: true, position: 5 },
    { id: "field-contact-address", workspaceId: defaultWorkspaceId, objectKey: "contacts", key: "address", label: "地址", type: "textarea", required: false, unique: false, isSystem: true, position: 6 },
    { id: "field-company-domain", workspaceId: defaultWorkspaceId, objectKey: "companies", key: "domain", label: "域名", type: "text", required: true, unique: true, isSystem: true, position: 1 },
    { id: "field-company-industry", workspaceId: defaultWorkspaceId, objectKey: "companies", key: "industry", label: "行业", type: "select", required: false, unique: false, options: [{ label: "软件", value: "software" }, { label: "制造", value: "manufacturing" }, { label: "金融", value: "finance" }], isSystem: true, position: 2 },
    { id: "field-company-billing-addresses", workspaceId: defaultWorkspaceId, objectKey: "companies", key: "billingAddresses", label: "Billing addresses", type: "textarea", required: false, unique: false, isSystem: true, position: 3 },
    { id: "field-company-shipping-addresses", workspaceId: defaultWorkspaceId, objectKey: "companies", key: "shippingAddresses", label: "Shipping addresses", type: "textarea", required: false, unique: false, isSystem: true, position: 4 },
    { id: "field-deal-amount", workspaceId: defaultWorkspaceId, objectKey: "deals", key: "amount", label: "金额", type: "currency", required: true, unique: false, isSystem: true, position: 1 },
    { id: "field-deal-close-date", workspaceId: defaultWorkspaceId, objectKey: "deals", key: "closeDate", label: "预计成交日", type: "date", required: false, unique: false, isSystem: true, position: 2 },
    { id: "field-deal-company", workspaceId: defaultWorkspaceId, objectKey: "deals", key: "companyId", label: "关联公司", type: "reference", required: false, unique: false, options: [{ label: "公司", value: "companies" }], isSystem: true, position: 3 },
    { id: "field-product-sku", workspaceId: defaultWorkspaceId, objectKey: "products", key: "sku", label: "SKU", type: "text", required: true, unique: true, isSystem: true, position: 1 },
    { id: "field-product-main-image", workspaceId: defaultWorkspaceId, objectKey: "products", key: "mainImageUrl", label: "主图 URL", type: "text", required: false, unique: false, isSystem: true, position: 2 },
    { id: "field-product-unit-price", workspaceId: defaultWorkspaceId, objectKey: "products", key: "unitPrice", label: "单价", type: "currency", required: true, unique: false, isSystem: true, position: 3 },
    { id: "field-product-unit-price-currency", workspaceId: defaultWorkspaceId, objectKey: "products", key: "unitPriceCurrency", label: "单价币种", type: "text", required: true, unique: false, defaultValue: "CNY", isSystem: true, position: 4 },
    { id: "field-product-description", workspaceId: defaultWorkspaceId, objectKey: "products", key: "description", label: "默认描述", type: "textarea", required: false, unique: false, isSystem: true, position: 5 },
    { id: "field-product-billing-cycle", workspaceId: defaultWorkspaceId, objectKey: "products", key: "billingCycle", label: "计费周期", type: "select", required: false, unique: false, options: [{ label: "一次性", value: "one_time" }, { label: "月付", value: "monthly" }, { label: "年付", value: "annual" }], isSystem: true, position: 6 },
    { id: "field-product-active", workspaceId: defaultWorkspaceId, objectKey: "products", key: "active", label: "启用", type: "boolean", required: false, unique: false, defaultValue: true, isSystem: true, position: 7 },
    { id: "field-quote-number", workspaceId: defaultWorkspaceId, objectKey: "quotes", key: "quoteNumber", label: "报价编号", type: "text", required: true, unique: true, isSystem: true, position: 1 },
    { id: "field-quote-company", workspaceId: defaultWorkspaceId, objectKey: "quotes", key: "companyId", label: "关联公司", type: "reference", required: true, unique: false, options: [{ label: "公司", value: "companies" }], isSystem: true, position: 2 },
    { id: "field-quote-contact", workspaceId: defaultWorkspaceId, objectKey: "quotes", key: "contactId", label: "关联联系人", type: "reference", required: true, unique: false, options: [{ label: "联系人", value: "contacts" }], isSystem: true, position: 3 },
    { id: "field-quote-currency", workspaceId: defaultWorkspaceId, objectKey: "quotes", key: "quoteCurrency", label: "报价币种", type: "text", required: true, unique: false, defaultValue: "CNY", isSystem: true, position: 4 },
    { id: "field-quote-payment-term", workspaceId: defaultWorkspaceId, objectKey: "quotes", key: "paymentTerm", label: "Payment term", type: "select", required: true, unique: false, options: [{ label: "见票即付", value: "due_on_receipt" }, { label: "Net 15", value: "net_15" }, { label: "Net 30", value: "net_30" }, { label: "Net 60", value: "net_60" }], defaultValue: "net_30", isSystem: true, position: 5 },
    { id: "field-quote-total-amount", workspaceId: defaultWorkspaceId, objectKey: "quotes", key: "totalAmount", label: "报价金额", type: "currency", required: true, unique: false, isSystem: true, position: 6 },
    { id: "field-quote-status", workspaceId: defaultWorkspaceId, objectKey: "quotes", key: "status", label: "状态", type: "select", required: true, unique: false, options: [{ label: "草稿", value: "draft" }, { label: "已发送", value: "sent" }, { label: "已接受", value: "accepted" }, { label: "已拒绝", value: "declined" }, { label: "已过期", value: "expired" }], defaultValue: "draft", isSystem: true, position: 7 },
    { id: "field-quote-valid-until", workspaceId: defaultWorkspaceId, objectKey: "quotes", key: "validUntil", label: "有效期至", type: "date", required: false, unique: false, isSystem: true, position: 8 },
    { id: "field-currency-code", workspaceId: defaultWorkspaceId, objectKey: "currencies", key: "code", label: "币种代码", type: "text", required: true, unique: true, isSystem: true, position: 1 },
    { id: "field-currency-label", workspaceId: defaultWorkspaceId, objectKey: "currencies", key: "label", label: "名称", type: "text", required: true, unique: false, isSystem: true, position: 2 },
    { id: "field-currency-symbol", workspaceId: defaultWorkspaceId, objectKey: "currencies", key: "symbol", label: "符号", type: "text", required: false, unique: false, isSystem: true, position: 3 },
    { id: "field-currency-rate", workspaceId: defaultWorkspaceId, objectKey: "currencies", key: "rateToBase", label: "对基准汇率", type: "number", required: true, unique: false, defaultValue: 1, isSystem: true, position: 4 },
    { id: "field-currency-base", workspaceId: defaultWorkspaceId, objectKey: "currencies", key: "isBase", label: "基准币种", type: "boolean", required: false, unique: false, defaultValue: false, isSystem: true, position: 5 },
    { id: "field-currency-active", workspaceId: defaultWorkspaceId, objectKey: "currencies", key: "active", label: "启用", type: "boolean", required: false, unique: false, defaultValue: true, isSystem: true, position: 6 },
    { id: "field-partner-tier", workspaceId: defaultWorkspaceId, objectKey: "partners", key: "tier", label: "伙伴等级", type: "select", required: true, unique: false, options: [{ label: "金牌", value: "gold" }, { label: "银牌", value: "silver" }], isSystem: false, position: 1 }
  ],
  relationDefinitions: [
    { id: "rel-company-contacts", workspaceId: defaultWorkspaceId, fromObjectKey: "companies", toObjectKey: "contacts", key: "company_contacts", label: "公司联系人", cardinality: "one-to-many" },
    { id: "rel-company-deals", workspaceId: defaultWorkspaceId, fromObjectKey: "companies", toObjectKey: "deals", key: "company_deals", label: "公司交易", cardinality: "one-to-many" },
    { id: "rel-company-quotes", workspaceId: defaultWorkspaceId, fromObjectKey: "companies", toObjectKey: "quotes", key: "company_quotes", label: "公司报价", cardinality: "one-to-many" },
    { id: "rel-contact-quotes", workspaceId: defaultWorkspaceId, fromObjectKey: "contacts", toObjectKey: "quotes", key: "contact_quotes", label: "联系人报价", cardinality: "one-to-many" },
    { id: "rel-product-quotes", workspaceId: defaultWorkspaceId, fromObjectKey: "products", toObjectKey: "quotes", key: "product_quotes", label: "产品报价", cardinality: "one-to-many" },
    { id: "rel-partner-companies", workspaceId: defaultWorkspaceId, fromObjectKey: "partners", toObjectKey: "companies", key: "partner_companies", label: "伙伴客户", cardinality: "many-to-many" }
  ],
  records: [
    {
      id: "currency-cny",
      workspaceId: defaultWorkspaceId,
      objectKey: "currencies",
      title: "CNY · 人民币",
      ownerId: adminUserId,
      data: { code: "CNY", label: "人民币", symbol: "¥", rateToBase: 1, isBase: true, active: true },
      createdAt: now,
      updatedAt: now
    },
    {
      id: "currency-usd",
      workspaceId: defaultWorkspaceId,
      objectKey: "currencies",
      title: "USD · 美元",
      ownerId: adminUserId,
      data: { code: "USD", label: "美元", symbol: "$", rateToBase: 7.2, isBase: false, active: true },
      createdAt: now,
      updatedAt: now
    },
    {
      id: "currency-eur",
      workspaceId: defaultWorkspaceId,
      objectKey: "currencies",
      title: "EUR · 欧元",
      ownerId: adminUserId,
      data: { code: "EUR", label: "欧元", symbol: "€", rateToBase: 7.8, isBase: false, active: true },
      createdAt: now,
      updatedAt: now
    },
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
    },
    {
      id: "product-ai-sales-standard",
      workspaceId: defaultWorkspaceId,
      objectKey: "products",
      title: "AI 销售助手标准版",
      ownerId: salesUserId,
      data: { sku: "SKU-AI-SALES-STD", mainImageUrl: "https://placehold.co/128x128/e0f2fe/0f172a?text=AI+CRM", unitPrice: 2999, unitPriceCurrency: "CNY", description: "年度订阅，包含销售邮件 AI 辅助、CRM 时间线和基础自动化。", billingCycle: "annual", active: true },
      createdAt: now,
      updatedAt: now
    },
    {
      id: "quote-acme-platform",
      workspaceId: defaultWorkspaceId,
      objectKey: "quotes",
      title: "Acme 年度订阅报价",
      ownerId: salesUserId,
      data: {
        quoteNumber: "Q-2026-001",
        companyId: "company-acme",
        contactId: "contact-lin",
        quoteCurrency: "CNY",
        paymentTerm: "net_30",
        lineItems: [
          {
            id: "line-ai-sales-standard",
            productId: "product-ai-sales-standard",
            productName: "AI 销售助手标准版",
            sku: "SKU-AI-SALES-STD",
            imageUrl: "https://placehold.co/128x128/e0f2fe/0f172a?text=AI+CRM",
            description: "年度订阅，包含销售邮件 AI 辅助、CRM 时间线和基础自动化。",
            quantity: 1,
            unitPrice: 2999,
            currency: "CNY"
          }
        ],
        fees: [{ id: "fee-implementation", name: "实施服务费", description: "首次部署和基础配置", amount: 500, currency: "CNY" }],
        totalAmount: 3499,
        status: "draft",
        validUntil: "2026-07-31"
      },
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
  emailThreadStates: [],
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
      agents: [
        {
          key: "inbound_email_preprocess",
          name: "入站邮件预处理 Agent",
          scenario: "email",
          enabled: true,
          model: "gpt-4.1-mini",
          agentMarkdown: [
            "# Inbound Email Preprocess Agent",
            "",
            "You preprocess newly received customer emails for a private sales CRM.",
            "Use customer background, communication history, and the system knowledge base.",
            "Produce concise, source-grounded summaries and next-context signals.",
            "Do not modify CRM records, deal stages, amounts, contacts, tasks, or mailbox state.",
            "Prefer compact memory that reduces future prompt tokens."
          ].join("\n"),
          maxOutputChars: 4000
        }
      ],
      providerConfig: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        timeoutMs: 10000,
        hasApiKey: Boolean(process.env.AI_API_KEY)
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
    { id: "view-contacts-default", workspaceId: defaultWorkspaceId, objectKey: "contacts", name: "全部联系人", columns: ["title", "email", "phone", "companyId", "birthday", "gender"], isDefault: true },
    { id: "view-companies-default", workspaceId: defaultWorkspaceId, objectKey: "companies", name: "全部公司", columns: ["title", "domain", "industry", "billingAddresses", "shippingAddresses"], isDefault: true },
    { id: "view-deals-default", workspaceId: defaultWorkspaceId, objectKey: "deals", name: "销售管道", columns: ["title", "amount", "closeDate", "companyId"], sort: { field: "amount", direction: "desc" }, isDefault: true },
    { id: "view-products-default", workspaceId: defaultWorkspaceId, objectKey: "products", name: "全部产品", columns: ["title", "mainImageUrl", "sku", "unitPrice", "unitPriceCurrency", "billingCycle", "active"], sort: { field: "title", direction: "asc" }, isDefault: true },
    { id: "view-quotes-default", workspaceId: defaultWorkspaceId, objectKey: "quotes", name: "全部报价", columns: ["title", "quoteNumber", "companyId", "contactId", "quoteCurrency", "paymentTerm", "totalAmount", "status"], sort: { field: "updatedAt", direction: "desc" }, isDefault: true },
    { id: "view-currencies-default", workspaceId: defaultWorkspaceId, objectKey: "currencies", name: "全部货币", columns: ["title", "code", "label", "symbol", "rateToBase", "isBase", "active"], sort: { field: "code", direction: "asc" }, isDefault: true }
  ]
};

import { beforeEach, describe, expect, it } from "vitest";
import { createAiProvider } from "@/lib/ai/provider";
import { CrmStore } from "@/lib/crm/store";

describe("CrmStore", () => {
  let store: CrmStore;

  beforeEach(() => {
    store = new CrmStore();
  });

  it("lets admins create custom objects, fields, and records", () => {
    const context = store.getContext("user-admin");
    const object = store.createObjectDefinition(context, {
      key: "regions",
      label: "Region",
      pluralLabel: "Regions",
      description: "Sales regions",
      icon: "Map"
    });
    const field = store.createFieldDefinition(context, {
      objectKey: object.key,
      key: "code",
      label: "Region code",
      type: "text",
      required: true,
      unique: true
    });
    const record = store.createRecord(context, object.key, { title: "East China", data: { code: "east" } });

    expect(field.objectKey).toBe("regions");
    expect(record.title).toBe("East China");
    expect(store.listRecords(context, "regions")).toHaveLength(1);
  });

  it("prevents sales users from managing metadata", () => {
    const salesContext = store.getContext("user-sales");

    expect(() =>
      store.createObjectDefinition(salesContext, {
        key: "regions",
        label: "Region",
        pluralLabel: "Regions"
      })
    ).toThrow("Missing permission: crm.admin");
  });

  it("imports valid csv rows and reports row-level errors", () => {
    const context = store.getContext("user-admin");
    const result = store.importCsv(context, "contacts", "title,email,phone\nWang Min,wang@example.com,139\nNo Email,,138");

    expect(result.created).toHaveLength(1);
    expect(result.errors[0]).toContain("Email");
  });

  it("keeps AI recommendations read-only and source-backed", async () => {
    const context = store.getContext("user-admin");
    const record = store.getRecord(context, "deals", "deal-platform");
    const activities = store.listActivities(context, record.id);
    const response = await createAiProvider().suggestNextActions({ record, activities });

    expect(response.text).toContain("AI");
    expect(response.sources[0]?.recordId).toBe(record.id);
    expect(store.getRecord(context, "deals", "deal-platform").stageKey).toBe("proposal");
  });
});

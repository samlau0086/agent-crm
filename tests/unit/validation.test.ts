import { describe, expect, it } from "vitest";
import { assertValidFieldDefinition, validateRecordPayload } from "@/lib/crm/validation";
import type { FieldDefinition } from "@/lib/crm/types";

const emailField: FieldDefinition = {
  id: "field-email",
  workspaceId: "workspace-private",
  objectKey: "contacts",
  key: "email",
  label: "Email",
  type: "text",
  required: true,
  unique: true,
  isSystem: true,
  position: 1
};

describe("field validation", () => {
  it("rejects invalid field keys", () => {
    expect(() => assertValidFieldDefinition({ key: "Bad Key", label: "Bad field", type: "text" })).toThrow("key");
  });

  it("requires select options", () => {
    expect(() => assertValidFieldDefinition({ key: "tier", label: "Tier", type: "select" })).toThrow("options");
  });

  it("rejects missing required record values", () => {
    expect(() => validateRecordPayload([emailField], {}, [])).toThrow("Email");
  });

  it("rejects duplicate unique values", () => {
    expect(() =>
      validateRecordPayload([emailField], { email: "lin@example.com" }, [
        {
          id: "contact-1",
          workspaceId: "workspace-private",
          objectKey: "contacts",
          title: "Lin Xiao",
          tags: [],
          tagColors: {},
          data: { email: "lin@example.com" },
          createdAt: "2026-06-17T00:00:00.000Z",
          updatedAt: "2026-06-17T00:00:00.000Z"
        }
      ])
    ).toThrow("Email");
  });
});

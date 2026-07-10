import assert from "node:assert/strict";
import { CrmMcpApiError, CrmMcpClient } from "@/mcp/client";
import { executeCrmMcpTool } from "@/mcp/tools";

export async function runMcpTests(run: (name: string, fn: () => unknown | Promise<unknown>) => Promise<void>): Promise<void> {
  await run("mcp client sends bearer token and query params", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new CrmMcpClient({
      baseUrl: "https://crm.example.com/app/",
      apiKey: "crm_live_test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await client.get("/api/records/contacts", { query: { page: 2, fields: ["email", "phone"], filters: [{ field: "email", operator: "contains", value: "@example.com" }] } });

    assert.deepEqual(result, { ok: true });
    assert.equal(new Headers(requests[0].init.headers).get("authorization"), "Bearer crm_live_test");
    const url = new URL(requests[0].url);
    assert.equal(url.href.startsWith("https://crm.example.com/app/api/records/contacts?"), true);
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.get("fields"), "email,phone");
    assert.equal(url.searchParams.get("filters"), JSON.stringify([{ field: "email", operator: "contains", value: "@example.com" }]));
  });

  await run("mcp client maps crm errors", async () => {
    const client = new CrmMcpClient({
      baseUrl: "https://crm.example.com",
      apiKey: "crm_live_test",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "Missing permission: crm.write", code: "FORBIDDEN", details: { permission: "crm.write" } }), {
          status: 403,
          headers: { "content-type": "application/json" }
        })
    });

    await assert.rejects(() => client.post("/api/records/contacts", { title: "Test", data: {} }), (error) => {
      assert(error instanceof CrmMcpApiError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "FORBIDDEN");
      assert.deepEqual(error.details, { permission: "crm.write" });
      return true;
    });
  });

  await run("mcp record search tool passes pagination and filters", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new CrmMcpClient({
      baseUrl: "https://crm.example.com",
      apiKey: "crm_live_test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ records: [], total: 0 }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await executeCrmMcpTool(
      "crm_search_records",
      {
        objectKey: "contacts",
        q: "lin",
        page: 3,
        pageSize: 25,
        filters: [{ field: "email", operator: "contains", value: "@example.com" }],
        sort: { field: "updatedAt", direction: "desc" },
        fields: ["email", "phone"],
        pool: "all"
      },
      client
    );

    assert.equal(result.isError, undefined);
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, "/api/records/contacts");
    assert.equal(url.searchParams.get("q"), "lin");
    assert.equal(url.searchParams.get("page"), "3");
    assert.equal(url.searchParams.get("pageSize"), "25");
    assert.equal(url.searchParams.get("sortField"), "updatedAt");
    assert.equal(url.searchParams.get("sortDirection"), "desc");
    assert.equal(url.searchParams.get("fields"), "email,phone");
    assert.equal(url.searchParams.get("pool"), "all");
  });

  await run("mcp update record tool preserves approval responses", async () => {
    const client = new CrmMcpClient({
      baseUrl: "https://crm.example.com",
      apiKey: "crm_live_test",
      fetchImpl: async (_url, init) => {
        assert.equal(init?.method, "PATCH");
        assert.deepEqual(JSON.parse(String(init?.body)), { data: { phone: "123" }, changeReason: "Update phone from customer call" });
        return new Response(JSON.stringify({ pendingApproval: true, request: { id: "approval-1" }, record: { id: "contact-1" } }), {
          status: 202,
          headers: { "content-type": "application/json" }
        });
      }
    });

    const result = await executeCrmMcpTool(
      "crm_update_record",
      { objectKey: "contacts", recordId: "contact-1", data: { phone: "123" }, changeReason: "Update phone from customer call" },
      client
    );

    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, { pendingApproval: true, request: { id: "approval-1" }, record: { id: "contact-1" } });
  });

  await run("mcp ai query tool calls crm ai query endpoint", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new CrmMcpClient({
      baseUrl: "https://crm.example.com",
      apiKey: "crm_live_test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ text: "Answer", sources: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await executeCrmMcpTool("crm_ai_query", { question: "Which deals need follow-up?", objectKey: "deals" }, client);

    assert.equal(result.isError, undefined);
    assert.equal(new URL(requests[0].url).pathname, "/api/ai/query");
    assert.equal(requests[0].init.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[0].init.body)), { question: "Which deals need follow-up?", objectKey: "deals" });
  });
}

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

  await run("mcp activity list tool passes task filters", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new CrmMcpClient({
      baseUrl: "https://crm.example.com",
      apiKey: "crm_live_test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await executeCrmMcpTool(
      "crm_list_activities",
      {
        type: "task",
        completed: false,
        archived: false,
        dueFrom: "2026-07-10T00:00:00.000+08:00",
        dueTo: "2026-07-10T23:59:59.999+08:00"
      },
      client
    );

    assert.equal(result.isError, undefined);
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, "/api/activities");
    assert.equal(url.searchParams.get("type"), "task");
    assert.equal(url.searchParams.get("completed"), "false");
    assert.equal(url.searchParams.get("archived"), "false");
    assert.equal(url.searchParams.get("dueFrom"), "2026-07-10T00:00:00.000+08:00");
    assert.equal(url.searchParams.get("dueTo"), "2026-07-10T23:59:59.999+08:00");
  });

  await run("mcp smart reminder tools call reminder endpoints", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new CrmMcpClient({
      baseUrl: "https://crm.example.com",
      apiKey: "crm_live_test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        const requestUrl = new URL(String(url));
        const body = requestUrl.pathname === "/api/smart-reminders" ? [] : { reminders: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const listResult = await executeCrmMcpTool("crm_list_smart_reminders", { status: "open", snoozed: false, kind: "today_best_action" }, client);
    const generateResult = await executeCrmMcpTool("crm_generate_smart_reminders", { force: true, daily: true, confirmRegenerate: true }, client);

    assert.equal(listResult.isError, undefined);
    assert.deepEqual(listResult.structuredContent, {
      reminders: [],
      count: 0,
      emptyState: "No existing generated today-best-action reminders were found. This does not prove there is no work to do. Ask the user whether to regenerate/refresh best actions before calling crm_generate_smart_reminders."
    });
    assert.equal(generateResult.isError, undefined);
    const listUrl = new URL(requests[0].url);
    assert.equal(listUrl.pathname, "/api/smart-reminders");
    assert.equal(listUrl.searchParams.get("status"), "open");
    assert.equal(listUrl.searchParams.get("snoozed"), "false");
    assert.equal(listUrl.searchParams.get("kind"), "today_best_action");
    assert.equal(new URL(requests[1].url).pathname, "/api/smart-reminders/generate");
    assert.equal(requests[1].init.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[1].init.body)), { force: true, daily: true });
  });

  await run("mcp smart reminder regeneration requires explicit confirmation", async () => {
    const client = new CrmMcpClient({
      baseUrl: "https://crm.example.com",
      apiKey: "crm_live_test",
      fetchImpl: async () => new Response(JSON.stringify({ reminders: [] }), { status: 200, headers: { "content-type": "application/json" } })
    });

    const result = await executeCrmMcpTool("crm_generate_smart_reminders", { force: true, daily: true }, client);

    assert.equal(result.isError, true);
    const content = result.content[0];
    assert.equal(content?.type, "text");
    assert.match(content.type === "text" ? content.text : "", /VALIDATION_ERROR/);
  });

  await run("mcp sales daily briefing aggregates salesperson context", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new CrmMcpClient({
      baseUrl: "https://crm.example.com",
      apiKey: "crm_live_test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await executeCrmMcpTool("crm_sales_daily_briefing", { date: "2026-07-10T12:00:00.000Z", timezoneOffsetMinutes: 480 }, client);

    assert.equal(result.isError, undefined);
    assert.equal(requests.length, 4);
    assert.equal(new URL(requests[0].url).pathname, "/api/smart-reminders");
    assert.equal(new URL(requests[1].url).searchParams.get("type"), "task");
    assert.equal(new URL(requests[1].url).searchParams.get("completed"), "false");
    assert.equal(new URL(requests[1].url).searchParams.get("dueFrom"), "2026-07-09T16:00:00.000Z");
    assert.equal(new URL(requests[1].url).searchParams.get("dueTo"), "2026-07-10T15:59:59.999Z");
    assert.equal(new URL(requests[2].url).searchParams.get("dueTo"), "2026-07-09T16:00:00.000Z");
    assert.equal(new URL(requests[3].url).pathname, "/api/email/threads");
  });

  await run("mcp salesperson action tools call write endpoints", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new CrmMcpClient({
      baseUrl: "https://crm.example.com",
      apiKey: "crm_live_test",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    await executeCrmMcpTool("crm_complete_task", { activityId: "task-1" }, client);
    await executeCrmMcpTool("crm_advance_deal_stage", { dealId: "deal-1", stageKey: "won", pipelineOrder: 1 }, client);
    await executeCrmMcpTool("crm_claim_record", { objectKey: "contacts", recordId: "contact-1" }, client);
    await executeCrmMcpTool("crm_release_record", { objectKey: "contacts", recordId: "contact-1" }, client);
    await executeCrmMcpTool("crm_send_email", { accountId: "account-1", to: ["sam@example.com"], subject: "Follow up", bodyText: "Hello Sam", trackingEnabled: true, clientRequestId: "mcp-test-1" }, client);

    assert.equal(new URL(requests[0].url).pathname, "/api/activities/task-1");
    assert.equal(requests[0].init.method, "PATCH");
    assert.equal(typeof JSON.parse(String(requests[0].init.body)).completedAt, "string");
    assert.equal(new URL(requests[1].url).pathname, "/api/records/deals/deal-1/stage");
    assert.deepEqual(JSON.parse(String(requests[1].init.body)), { stageKey: "won", pipelineOrder: 1 });
    assert.equal(new URL(requests[2].url).pathname, "/api/records/contacts/contact-1/claim");
    assert.equal(new URL(requests[3].url).pathname, "/api/records/contacts/contact-1/release");
    assert.equal(new URL(requests[4].url).pathname, "/api/email/send");
    assert.equal(requests[4].init.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[4].init.body)), { accountId: "account-1", to: ["sam@example.com"], subject: "Follow up", bodyText: "Hello Sam", trackingEnabled: true, clientRequestId: "mcp-test-1" });
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

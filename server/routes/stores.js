const { parseRequestBody, sendJson } = require("../http_utils");

// Reports (pages opened in the Browser), Layouts (named view layouts) and the
// per-pane input history, all shared by every device of this deck.
module.exports = () => [
  {
    method: "GET",
    path: "/api/reports",
    auth: "session",
    handler: async (ctx, request, response) => sendJson(response, 200, { reports: await ctx.reportStore.list() })
  },
  {
    method: "POST",
    path: "/api/reports",
    auth: "session",
    handler: async (ctx, request, response) => {
      sendJson(response, 200, { report: await ctx.reportStore.record(await parseRequestBody(request)) });
    }
  },
  {
    method: "POST",
    path: "/api/reports/update",
    auth: "session",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      sendJson(response, 200, { report: await ctx.reportStore.update(String(body.id || ""), body) });
    }
  },
  {
    method: "POST",
    path: "/api/reports/delete",
    auth: "session",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      await ctx.reportStore.remove(String(body.id || ""));
      sendJson(response, 200, { ok: true });
    }
  },
  {
    method: "GET",
    path: "/api/input-history",
    auth: "session",
    handler: async (ctx, request, response, requestUrl) => {
      const params = requestUrl.searchParams;
      const pane = { targetId: params.get("targetId"), socket: params.get("socket") || "", windowId: params.get("windowId") };
      sendJson(response, 200, { entries: await ctx.inputHistoryStore.list(pane) });
    }
  },
  {
    method: "POST",
    path: "/api/input-history",
    auth: "session",
    handler: async (ctx, request, response) => {
      sendJson(response, 200, { entries: await ctx.inputHistoryStore.record(await parseRequestBody(request)) });
    }
  },
  {
    method: "POST",
    path: "/api/input-history/delete",
    auth: "session",
    handler: async (ctx, request, response) => {
      await ctx.inputHistoryStore.clear(await parseRequestBody(request));
      sendJson(response, 200, { ok: true });
    }
  },
  {
    method: "GET",
    path: "/api/layouts",
    auth: "session",
    handler: async (ctx, request, response) => sendJson(response, 200, { layouts: await ctx.layoutStore.list() })
  },
  {
    method: "POST",
    path: "/api/layouts",
    auth: "session",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      const layout = await ctx.layoutStore.upsert(body.layout || body, String(body.expectedUpdatedAt || ""));
      sendJson(response, 200, { layout });
    }
  },
  {
    method: "POST",
    path: "/api/layouts/delete",
    auth: "session",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      await ctx.layoutStore.remove(String(body.id || ""));
      sendJson(response, 200, { ok: true });
    }
  }
];

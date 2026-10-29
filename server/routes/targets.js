const { parseRequestBody, sendJson } = require("../http_utils");

module.exports = () => [
  {
    method: "GET",
    path: "/api/targets",
    auth: "session",
    handler: async (ctx, request, response) => sendJson(response, 200, await ctx.targetStore.read())
  },
  {
    method: "POST",
    path: "/api/targets",
    auth: "session",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      sendJson(response, 200, { target: await ctx.targetStore.upsert(body.target || body, body.id) });
    }
  },
  {
    method: "POST",
    path: "/api/targets/select",
    auth: "session",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      await ctx.targetStore.select(body.targetId);
      sendJson(response, 200, { ok: true });
    }
  },
  {
    method: "POST",
    path: "/api/targets/test",
    auth: "session",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      const target = await ctx.targetStore.resolve(body);
      sendJson(response, 200, await ctx.runHelper(target, "test", { socket: body.socket || "" }, 25000));
    }
  }
];

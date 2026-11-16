const { parseRequestBody, sendJson } = require("../http_utils");

const HOST_STATS_TTL_MS = 30 * 1000;
const hostStatsCache = new Map();

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
    // Memory and disk of the target host for the top bar. Every open page
    // polls once a minute; the cache keeps that to one helper run per target.
    method: "GET",
    path: "/api/host-stats",
    auth: "session",
    handler: async (ctx, request, response, requestUrl) => {
      const target = await ctx.targetStore.resolve({ targetId: requestUrl.searchParams.get("targetId") });
      const cached = hostStatsCache.get(target.id);
      if (cached && Date.now() - cached.at < HOST_STATS_TTL_MS) {
        sendJson(response, 200, cached.data);
        return;
      }
      const data = await ctx.runHelper(target, "host_stats", {}, 15000);
      hostStatsCache.set(target.id, { at: Date.now(), data });
      sendJson(response, 200, data);
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

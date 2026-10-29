const { createProxyUrl } = require("../url_proxy");
const { parseRequestBody, sendBuffer, sendJson } = require("../http_utils");
const {
  browserResourceHeaders,
  decodeFetchedResource,
  proxiedResourceFromRequest,
  serveLocalFileResource,
  transformFetchedResource
} = require("../browser_resources");

module.exports = () => [
  {
    method: "GET",
    path: "/api/url-access-token",
    auth: "session",
    handler: async (ctx, request, response, requestUrl) => {
      const target = await ctx.targetStore.resolve({ targetId: requestUrl.searchParams.get("targetId") });
      const url = requestUrl.searchParams.get("url") || "";
      if (!url) {
        throw new Error("URL is required.");
      }
      sendJson(response, 200, ctx.previewAccess.createToken(target.id, url));
    }
  },
  {
    method: "POST",
    path: "/api/url-preview",
    auth: "session",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      const target = await ctx.targetStore.resolve(body);
      const data = await ctx.runHelper(target, "fetch_url", { url: String(body.url || "") }, 30000);
      sendJson(response, 200, {
        ...data,
        proxyUrl: createProxyUrl(data.finalUrl || data.url || String(body.url || ""), target.id)
      });
    }
  },
  {
    // /p/<target>/<token>/... and the query form /api/url-resource?url=...
    method: "GET",
    match: (requestUrl) => Boolean(proxiedResourceFromRequest(requestUrl)),
    auth: "resource",
    handler: async (ctx, request, response, requestUrl) => {
      const { targetId, url, accessToken } = proxiedResourceFromRequest(requestUrl);
      const target = await ctx.targetStore.resolve({ targetId });
      if (await serveLocalFileResource(request, response, target, url, accessToken)) {
        return;
      }

      const rangeHeader = request.headers.range || "";
      const data = await ctx.runHelper(target, rangeHeader ? "fetch_url_resource" : "fetch_url", { url, range: rangeHeader }, 45000);
      const transformed = rangeHeader
        ? { buffer: decodeFetchedResource(data), contentType: data.contentType || "application/octet-stream" }
        : transformFetchedResource(data, target.id, accessToken);
      const headers = browserResourceHeaders(data, url, { "Accept-Ranges": data.acceptRanges || "bytes" });
      if (data.contentRange) {
        headers["Content-Range"] = data.contentRange;
      }
      sendBuffer(response, Number(data.statusCode || 200), transformed.buffer, transformed.contentType, headers);
    }
  }
];

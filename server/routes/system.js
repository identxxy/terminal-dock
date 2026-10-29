const fsp = require("fs").promises;
const path = require("path");
const { parseRequestBody, sendJson } = require("../http_utils");
const { nowIso } = require("../targets");

// The page's ?debug=1 mode posts fit-decision geometry here; see README.
async function appendClientDebugLog(context, payload, request) {
  const payloadText = JSON.stringify(payload || {});
  const entry = {
    at: nowIso(),
    ip: request.headers["cf-connecting-ip"] || request.socket.remoteAddress || "",
    userAgent: request.headers["user-agent"] || "",
    payload: payloadText.length > 18000 ? { truncated: true, text: payloadText.slice(0, 18000) } : payload
  };
  await fsp.mkdir(path.dirname(context.config.clientDebugLogFile), { recursive: true });
  await fsp.appendFile(context.config.clientDebugLogFile, `${JSON.stringify(entry)}\n`);
}

module.exports = (context) => [
  {
    method: "GET",
    path: "/api/health",
    auth: "none",
    handler: (ctx, request, response) => sendJson(response, 200, { ok: true, host: ctx.config.host, port: ctx.config.port })
  },
  {
    method: "POST",
    path: "/api/client-log",
    auth: "session",
    handler: async (ctx, request, response) => {
      await appendClientDebugLog(ctx, await parseRequestBody(request), request);
      sendJson(response, 200, { ok: true });
    }
  }
];

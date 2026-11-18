const { parseRequestBody, sendJson, sendText } = require("../http_utils");

// Harbor. /harbor/v1/* is the public API for a guest agent (Bearer harbor token,
// never the device cookie); /api/harbor* is the owner's view in the dock.
const MAX_WAIT_SECONDS = 25;

function publicRequest(request) {
  const { id, text, status, reason, reply, createdAt, updatedAt } = request;
  return { id, text, status, reason, reply, createdAt, updatedAt };
}

function guide(record, requests, baseUrl) {
  const scope = record.level === "explain"
    ? `explain the code under: ${record.roots.join(", ")}`
    : `read and discuss the files under: ${record.roots.join(", ")}`;
  return `# Harbor access for ${record.to}

You can send requests to an AI agent (Claude Code) working in someone's
terminal. They gave you this token for a limited time and scope.

- Scope: the agent may ${scope}. It cannot edit files, run commands or browse
  for you; such requests are refused.
- Expires: ${record.expiresAt}
- Requests used: ${requests.length} of ${record.maxRequests}
- ${record.mode === "approve" ? "The owner approves each request before the agent sees it." : "Requests go to the agent as they arrive, one at a time."}
${record.rules ? `\n## Rules\n\n${record.rules}\n` : ""}
## API

Send the token on every call: \`Authorization: Bearer hbt_…\`.

- \`POST ${baseUrl}/requests\` with \`{"text": "…"}\` (plain text, up to 16000
  characters) → \`202 {"request": {"id", "status"}}\`.
- \`GET ${baseUrl}/requests/ID?wait=25\` waits up to 25 s for a change and
  returns the request; repeat until \`status\` is \`replied\`, \`rejected\` or
  \`failed\`. \`reply\` holds the agent's answer, \`reason\` explains a rejection
  or failure.
- \`GET ${baseUrl}/requests\` lists your requests.

Statuses: \`pending_owner\` (waiting for the owner), \`queued\` (waiting for the
agent to be free), \`delivered\` (the agent is working on it), \`replied\`,
\`rejected\`, \`failed\`.

The agent answers one request at a time and may also be busy with its owner's
work, so a request can wait a while. Each request is a new message in the same
conversation: refer back to earlier answers freely, and keep each request
self-contained enough to act on.
`;
}

const ANONYMOUS_GUIDE = `# Harbor

This endpoint gives a guest agent temporary access to an AI agent session.
Send your Harbor token as \`Authorization: Bearer hbt_…\` to \`GET /harbor/v1/\`
for the scope, rules and API of your token.
`;

function apiBase(request) {
  const proto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "http";
  return `${proto}://${request.headers.host}/harbor/v1`;
}

// Maps a td host alias to the dock's tmux target, so the dock can open the pane.
function dockTarget(targets, host) {
  return targets.find((target) => target.backend === "tmux"
    && (host === "local" ? target.transport === "local" : target.transport === "ssh" && target.sshTarget === host)) || null;
}

module.exports = () => [
  {
    method: "GET",
    match: (url) => url.pathname === "/harbor" || url.pathname === "/harbor/" || url.pathname === "/harbor/v1" || url.pathname === "/harbor/v1/",
    auth: "none",
    handler: async (ctx, request, response) => {
      if (!request.headers.authorization) {
        sendText(response, 200, ANONYMOUS_GUIDE, "text/markdown; charset=utf-8");
        return;
      }
      const record = await ctx.harbor.verify(request.headers.authorization);
      const requests = await ctx.harbor.requestsFor(record.id);
      sendText(response, 200, guide(record, requests, apiBase(request)), "text/markdown; charset=utf-8");
    }
  },
  {
    method: "POST",
    path: "/harbor/v1/requests",
    auth: "none",
    handler: async (ctx, request, response) => {
      const record = await ctx.harbor.verify(request.headers.authorization);
      const body = await parseRequestBody(request, { maxBytes: 256 * 1024 });
      const created = await ctx.harbor.submit(record, body.text);
      sendJson(response, 202, { request: publicRequest(created) });
    }
  },
  {
    method: "GET",
    path: "/harbor/v1/requests",
    auth: "none",
    handler: async (ctx, request, response) => {
      const record = await ctx.harbor.verify(request.headers.authorization);
      sendJson(response, 200, { requests: (await ctx.harbor.requestsFor(record.id)).map(publicRequest) });
    }
  },
  {
    method: "GET",
    match: (url) => /^\/harbor\/v1\/requests\/[\w-]+$/.test(url.pathname),
    auth: "none",
    handler: async (ctx, request, response, requestUrl) => {
      const record = await ctx.harbor.verify(request.headers.authorization);
      const id = requestUrl.pathname.split("/").pop();
      if (!id.startsWith(`${record.id}-`)) {
        sendJson(response, 404, { error: `No request ${id}.` });
        return;
      }
      const wait = Math.min(MAX_WAIT_SECONDS, Math.max(0, Number(requestUrl.searchParams.get("wait") || 0)));
      sendJson(response, 200, { request: publicRequest(await ctx.harbor.waitFor(record.id, id, wait * 1000)) });
    }
  },
  {
    method: "GET",
    path: "/api/harbor",
    auth: "session",
    handler: async (ctx, request, response) => {
      const targets = (await ctx.targetStore.read()).targets;
      const tokens = (await ctx.harbor.overview()).map((token) => {
        const target = dockTarget(targets, token.host);
        return { ...token, dock: target ? { targetId: target.id, windowId: Number(String(token.pane).replace("%", "")) } : null };
      });
      sendJson(response, 200, { tokens });
    }
  },
  {
    method: "POST",
    path: "/api/harbor/decide",
    auth: "session",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      await ctx.harbor.decide(String(body.tokenId || ""), String(body.requestId || ""), Boolean(body.approve), body.reason);
      sendJson(response, 200, { ok: true });
    }
  },
  {
    method: "POST",
    path: "/api/harbor/revoke",
    auth: "session",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      sendJson(response, 200, { token: await ctx.harbor.revoke(String(body.tokenId || "")) });
    }
  }
];

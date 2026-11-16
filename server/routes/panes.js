const { normalizeBackend } = require("../helper_runner");
const { backendSupports } = require("../backend_contract");
const { hashText } = require("../response_encoding");
const { handleEventStream } = require("../events");
const { describeScreenDelta, scrollOffsetKey } = require("../screen_cache");
const { MAX_UPLOAD_FILES, UPLOAD_CHUNK_BYTES, createComposerImageText } = require("../image_upload");
const {
  parseCreatePanelKind,
  parseOptionalPositiveInteger,
  parsePositiveInteger,
  parseRequestBody,
  parseScrollLines,
  parseWindowId,
  readRawBody,
  sendJson
} = require("../http_utils");

const HELPER_TIMEOUT_MS = 25000;

// Most pane routes read a JSON body naming the target, socket and pane, run
// one helper action and return its data unchanged. Actions a backend does not
// implement (see server/backend_contract.js) are refused before spawning.
function paneAction(action, buildPayload) {
  return async (ctx, request, response) => {
    const body = await parseRequestBody(request);
    const target = await ctx.targetStore.resolve(body);
    const backend = normalizeBackend(target.backend);
    if (!backendSupports(action, backend)) {
      throw new Error(`${action} is not supported by ${backend} targets.`);
    }
    const payload = { socket: body.socket || "", ...buildPayload(body) };
    sendJson(response, 200, await ctx.runHelper(target, action, payload, HELPER_TIMEOUT_MS));
  };
}

async function getScreen(ctx, request, response, requestUrl) {
  const query = requestUrl.searchParams;
  const target = await ctx.targetStore.resolve({ targetId: query.get("targetId") });
  const windowId = parseWindowId(query.get("windowId"));
  const socket = query.get("socket") || "";
  const extent = query.get("extent") === "all" ? "all" : "screen";
  const offsetKey = scrollOffsetKey(target, socket, windowId);

  const data = await ctx.runHelper(target, "get_screen", {
    socket,
    windowId,
    extent,
    scrollOffset: ctx.scrollOffsets.get(offsetKey) || 0
  }, HELPER_TIMEOUT_MS);

  // Let pollers skip re-downloading a screen they already have.
  const hash = hashText(data?.panes ? JSON.stringify(data.panes) : data?.text);
  const since = query.get("since");
  if (since === hash) {
    sendJson(response, 200, { unchanged: true, hash });
    return;
  }
  if (!data?.panes && typeof data?.text === "string") {
    const cacheKey = `${offsetKey}|${extent}`;
    const cached = ctx.screenCache.get(cacheKey);
    ctx.screenCache.remember(cacheKey, hash, data.text);
    if (since && query.get("delta") === "1" && cached && cached.hash === since) {
      const delta = describeScreenDelta(cached.text, data.text);
      if (delta) {
        const { text, ...rest } = data;
        sendJson(response, 200, { ...rest, delta: true, base: since, hash, drop: delta.drop, keep: delta.keep, tail: delta.tail });
        return;
      }
    }
  }
  sendJson(response, 200, { ...data, hash });
}

async function sendImage(ctx, request, response) {
  const body = await parseRequestBody(request);
  const target = await ctx.targetStore.resolve(body);
  const windowId = parseWindowId(body.windowId);
  const uploadIds = Array.isArray(body.uploadIds) ? body.uploadIds : [];
  if (!uploadIds.length || uploadIds.length > MAX_UPLOAD_FILES) {
    throw new Error(`Send between 1 and ${MAX_UPLOAD_FILES} attachments at a time.`);
  }
  const images = ctx.uploadStore.collect(uploadIds, target.id);
  const text = createComposerImageText({ text: body.text || "", files: images });
  const data = await ctx.runHelper(target, "send_text", {
    socket: body.socket || "",
    windowId,
    text,
    appendNewline: Boolean(body.appendNewline)
  }, HELPER_TIMEOUT_MS);
  ctx.uploadStore.forget(uploadIds);
  sendJson(response, 200, { ...data, image: images[0], images, sentTextLength: text.length + (body.appendNewline ? 1 : 0) });
}

async function startUpload(ctx, request, response) {
  const body = await parseRequestBody(request);
  const target = await ctx.targetStore.resolve(body);
  sendJson(response, 200, await ctx.uploadStore.start(target, body));
}

async function uploadChunk(ctx, request, response, requestUrl) {
  const offset = Number(requestUrl.searchParams.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer.");
  }
  const buffer = await readRawBody(request, UPLOAD_CHUNK_BYTES);
  sendJson(response, 200, await ctx.uploadStore.appendChunk(requestUrl.searchParams.get("uploadId"), offset, buffer));
}

async function cancelUpload(ctx, request, response, requestUrl) {
  await ctx.uploadStore.cancel(requestUrl.searchParams.get("uploadId"));
  sendJson(response, 200, { ok: true });
}

// tmux has no per-viewer viewport, so Screen-mode scrolling keeps an offset per
// pane on the server and the helper captures the matching slice of history.
async function scrollWindow(ctx, request, response) {
  const body = await parseRequestBody(request);
  const target = await ctx.targetStore.resolve(body);
  const windowId = parseWindowId(body.windowId);
  const toEnd = body.toEnd === true;
  const offsetKey = scrollOffsetKey(target, body.socket || "", windowId);
  const data = await ctx.runHelper(target, "scroll_window", {
    socket: body.socket || "",
    windowId,
    lines: toEnd ? 0 : parseScrollLines(body.lines),
    toEnd,
    scrollOffset: ctx.scrollOffsets.get(offsetKey) || 0
  }, HELPER_TIMEOUT_MS);
  if (typeof data.scrollOffset === "number") {
    if (data.scrollOffset > 0) {
      ctx.scrollOffsets.set(offsetKey, data.scrollOffset);
    } else {
      ctx.scrollOffsets.delete(offsetKey);
    }
  }
  sendJson(response, 200, data);
}

module.exports = () => [
  {
    method: "GET",
    path: "/api/sessions",
    auth: "session",
    handler: async (ctx, request, response, requestUrl) => {
      const target = await ctx.targetStore.resolve({ targetId: requestUrl.searchParams.get("targetId") });
      const socket = requestUrl.searchParams.get("socket") || "";
      sendJson(response, 200, await ctx.runHelper(target, "list_sessions", { socket }, HELPER_TIMEOUT_MS));
    }
  },
  { method: "GET", path: "/api/events", auth: "session", handler: handleEventStream },
  { method: "GET", path: "/api/screen", auth: "session", handler: getScreen },
  {
    method: "POST",
    path: "/api/send-text",
    auth: "session",
    handler: paneAction("send_text", (body) => ({
      windowId: parseWindowId(body.windowId),
      text: String(body.text || ""),
      appendNewline: Boolean(body.appendNewline)
    }))
  },
  { method: "POST", path: "/api/uploads", auth: "session", handler: startUpload },
  { method: "PUT", path: "/api/uploads/chunk", auth: "session", handler: uploadChunk },
  { method: "DELETE", path: "/api/uploads", auth: "session", handler: cancelUpload },
  { method: "POST", path: "/api/send-image", auth: "session", handler: sendImage },
  {
    method: "POST",
    path: "/api/send-key",
    auth: "session",
    handler: paneAction("send_key", (body) => {
      // `keys` sends a chord (Ctrl+X Ctrl+S) in one round trip; `repeat` repeats one key.
      const keys = Array.isArray(body.keys)
        ? body.keys.slice(0, 8).map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      return {
        windowId: parseWindowId(body.windowId),
        key: String(body.key || keys[0] || "enter"),
        keys,
        repeat: Math.max(1, Math.min(Number(body.repeat) || 1, 5))
      };
    })
  },
  { method: "POST", path: "/api/scroll-window", auth: "session", handler: scrollWindow },
  {
    method: "POST",
    path: "/api/focus-window",
    auth: "session",
    handler: paneAction("focus_window", (body) => ({ windowId: parseWindowId(body.windowId) }))
  },
  {
    method: "POST",
    path: "/api/toggle-zoom",
    auth: "session",
    handler: paneAction("toggle_zoom", (body) => ({ windowId: parseWindowId(body.windowId) }))
  },
  {
    method: "POST",
    path: "/api/close-panel",
    auth: "session",
    handler: paneAction("close_panel", (body) => {
      const kind = String(body.kind || "");
      if (!["session", "tab", "pane"].includes(kind)) {
        throw new Error("kind must be session, tab, or pane.");
      }
      return { kind, id: parsePositiveInteger(body.id, "id") };
    })
  },
  {
    method: "POST",
    path: "/api/resize-window",
    auth: "session",
    handler: paneAction("resize_window", (body) => ({
      windowId: parseWindowId(body.windowId),
      columns: parsePositiveInteger(body.columns, "columns"),
      rows: parsePositiveInteger(body.rows, "rows"),
      force: body.force === true
    }))
  },
  {
    method: "POST",
    path: "/api/create-panel",
    auth: "session",
    handler: paneAction("create_panel", (body) => ({
      kind: parseCreatePanelKind(body.kind),
      sourceWindowId: parseOptionalPositiveInteger(body.sourceWindowId, "sourceWindowId"),
      tabId: parseOptionalPositiveInteger(body.tabId, "tabId")
    }))
  }
];

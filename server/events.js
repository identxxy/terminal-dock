const { normalizeBackend } = require("./helper_runner");
const { controlClientArgv } = require("./tmux_watcher");
const { parseWindowId } = require("./http_utils");

const MAX_EVENT_SUBSCRIPTIONS = 8;
const EVENT_HEARTBEAT_MS = 20000;

function parseEventSubscriptions(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch (error) {
    throw new Error("subs must be JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("subs must be an array.");
  }
  const seen = new Set();
  const subs = [];
  for (const item of parsed.slice(0, MAX_EVENT_SUBSCRIPTIONS)) {
    const targetId = String(item?.targetId || "");
    const socket = String(item?.socket || "");
    const windowId = parseWindowId(item?.windowId);
    const key = `${targetId}|${socket}|${windowId}`;
    if (targetId && !seen.has(key)) {
      seen.add(key);
      subs.push({ targetId, socket, windowId, key });
    }
  }
  return subs;
}

// Server-sent events: `screen` when a subscribed pane's tmux window changes,
// `tree` when sessions/windows change, `reset` when a watcher dies. Each
// subscription is a deck pane (tmux pane id) on a tmux target.
async function handleEventStream(context, request, response, requestUrl) {
  const { targetStore, runHelper, watcherRegistry } = context;
  const subs = parseEventSubscriptions(requestUrl.searchParams.get("subs"));
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write("retry: 5000\n\n");

  const send = (event, payload) => {
    if (!response.writableEnded) {
      response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  };
  const held = [];
  let closed = false;
  const releaseAll = () => {
    for (const entry of held.splice(0)) {
      entry.watcher.off("change", entry.onChange);
      entry.watcher.off("exit", entry.onExit);
      entry.watcher.release();
    }
  };
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) {
      response.write(": ping\n\n");
    }
  }, EVENT_HEARTBEAT_MS);
  const cleanup = () => {
    closed = true;
    clearInterval(heartbeat);
    releaseAll();
  };
  request.on("close", cleanup);

  const live = [];
  const unsupported = [];
  for (const sub of subs) {
    try {
      const target = await targetStore.resolve({ targetId: sub.targetId });
      if (normalizeBackend(target.backend) !== "tmux") {
        unsupported.push({ key: sub.key, reason: "kitty targets poll" });
        continue;
      }
      const description = await runHelper(target, "describe_window", { socket: sub.socket, windowId: sub.windowId }, 15000);
      if (closed) {
        return;
      }
      const watcherKey = `${target.id}|${description.socket}|${description.sessionId}`;
      const watcher = watcherRegistry.get(watcherKey, () => controlClientArgv(target, description));
      watcher.acquire();
      const onChange = (change) => {
        if (watcher.concerns(change, sub.windowId)) {
          send("screen", { key: sub.key, targetId: sub.targetId, socket: sub.socket, windowId: sub.windowId });
        }
        if (change.structure) {
          send("tree", { key: sub.key, targetId: sub.targetId });
        }
      };
      const onExit = (error) => {
        send("reset", { key: sub.key, reason: error || "tmux control client exited" });
        cleanup();
        response.end();
      };
      watcher.on("change", onChange);
      watcher.on("exit", onExit);
      held.push({ watcher, onChange, onExit });
      live.push({ key: sub.key, targetId: sub.targetId, socket: sub.socket, windowId: sub.windowId, session: description.sessionName });
    } catch (error) {
      unsupported.push({ key: sub.key, reason: error.message });
    }
  }
  if (closed) {
    releaseAll();
    return;
  }
  send("subscribed", { live, unsupported });
}

module.exports = { MAX_EVENT_SUBSCRIPTIONS, handleEventStream, parseEventSubscriptions };

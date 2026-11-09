const fs = require("node:fs");
const fsp = require("node:fs/promises");

// Input history: the text sent to each pane from the composer, kept per pane
// (target, socket, pane id) in one JSON file so every device lists the same
// entries. Each entry remembers the transcript line it was sent at; the page
// uses that as the fallback when the echoed prompt cannot be found by text.
const ENTRIES_PER_PANE = 32;
const MAX_PANES = 200;
const TEXT_MAX = 600;

function paneKey(input) {
  const targetId = String(input?.targetId || "").trim();
  if (!targetId) {
    throw new Error("targetId is required.");
  }
  const windowId = Number(input?.windowId);
  if (!Number.isInteger(windowId) || windowId < 0) {
    throw new Error("windowId must be a non-negative integer.");
  }
  return `${targetId}|${String(input?.socket || "")}|${windowId}`;
}

function normalizeEntry(item) {
  const text = typeof item?.text === "string" ? item.text.slice(0, TEXT_MAX) : "";
  if (!text.trim()) {
    return null;
  }
  // null (no position) must not read back as 0.
  const line = item?.line === null || item?.line === undefined ? NaN : Number(item.line);
  return {
    text,
    at: Number.isFinite(Number(item?.at)) ? Number(item.at) : 0,
    line: Number.isInteger(line) && line >= 0 ? line : null
  };
}

function createInputHistoryStore(filePath) {
  async function read() {
    try {
      await fsp.access(filePath, fs.constants.F_OK);
    } catch (error) {
      return {};
    }
    let parsed = null;
    try {
      parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
    } catch (error) {
      return {};
    }
    const panes = parsed?.panes && typeof parsed.panes === "object" ? parsed.panes : {};
    const history = {};
    for (const [key, list] of Object.entries(panes)) {
      const entries = (Array.isArray(list) ? list : []).map(normalizeEntry).filter(Boolean).slice(-ENTRIES_PER_PANE);
      if (entries.length) {
        history[key] = entries;
      }
    }
    return history;
  }

  async function write(history) {
    // Temp file + rename: a reader never sees a half-written file.
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await fsp.writeFile(tempPath, JSON.stringify({ panes: history }, null, 2));
    await fsp.rename(tempPath, filePath);
  }

  let queue = Promise.resolve();
  function serialized(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  // Panes are kept in order of last use (record() moves a pane's key to the
  // end), so the stalest panes are the first keys.
  function prune(history) {
    const keys = Object.keys(history);
    keys.slice(0, Math.max(0, keys.length - MAX_PANES)).forEach((stale) => {
      delete history[stale];
    });
    return history;
  }

  async function list(input) {
    const key = paneKey(input);
    return (await read())[key] || [];
  }

  async function record(input) {
    const key = paneKey(input);
    const entry = normalizeEntry({ text: input?.text, line: input?.line, at: Date.now() });
    if (!entry) {
      throw new Error("text is required.");
    }
    return serialized(async () => {
      const history = await read();
      const entries = [...(history[key] || []), entry].slice(-ENTRIES_PER_PANE);
      delete history[key];
      history[key] = entries;
      await write(prune(history));
      return history[key];
    });
  }

  async function clear(input) {
    const key = paneKey(input);
    return serialized(async () => {
      const history = await read();
      if (history[key]) {
        delete history[key];
        await write(history);
      }
    });
  }

  return { list, record, clear };
}

module.exports = { ENTRIES_PER_PANE, MAX_PANES, TEXT_MAX, createInputHistoryStore };

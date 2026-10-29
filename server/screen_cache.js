const { splitLines, computeLineDelta } = require("../public/modules/terminal-lines");

function scrollOffsetKey(target, socket, windowId) {
  return `${target.id}|${socket || ""}|${windowId}`;
}

// A delta is only worth sending when the page keeps most of what it has: a
// rewritten screen costs less as a full body than as drop/keep/tail.
function describeScreenDelta(previousText, text) {
  const delta = computeLineDelta(splitLines(previousText), splitLines(text));
  const tailBytes = delta.tail.reduce((sum, line) => sum + line.length + 1, 0);
  if (delta.keep === 0 || tailBytes > text.length * 0.6) {
    return null;
  }
  return delta;
}

// Last text served per pane/extent, so a poller holding that text can get a
// line delta instead of the whole scrollback. Least recently served drops first.
function createScreenCache(limit = 64) {
  const entries = new Map();

  function remember(key, hash, text) {
    entries.delete(key);
    entries.set(key, { hash, text });
    while (entries.size > limit) {
      entries.delete(entries.keys().next().value);
    }
  }

  return { remember, get: (key) => entries.get(key), size: () => entries.size };
}

module.exports = { createScreenCache, describeScreenDelta, scrollOffsetKey };

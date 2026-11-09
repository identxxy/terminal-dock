// Input history: where each prompt sent to a pane shows up in the pane's
// transcript. The entries themselves live on the server (server/input_history.js).
(function attachInputHistory(global) {
  const NEEDLE_MAX = 40;
  const NEEDLE_SHORT = 18;

  function collapse(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  // The first non-empty line, whitespace collapsed, cut to what fits on one
  // terminal row beside the prompt marker.
  function inputNeedle(text, max = NEEDLE_MAX) {
    const first = String(text || "").split("\n").map(collapse).find(Boolean) || "";
    return first.slice(0, max);
  }

  // Walk the entries oldest to newest; each one is searched after the previous
  // hit so repeated prompts ("继续", "y") resolve in order. A shorter needle
  // covers narrow terminals that wrap the echoed prompt early. When the echo is
  // not found, the line the prompt was sent at stands in (it drifts once the
  // scrollback drops lines off the top). -1 means no position at all.
  function locateInputs(lines, entries) {
    const collapsed = (lines || []).map(collapse);
    const hits = [];
    let cursor = 0;
    for (const entry of entries || []) {
      const full = inputNeedle(entry && entry.text);
      const needles = full ? [full] : [];
      if (full.length > NEEDLE_SHORT) {
        needles.push(full.slice(0, NEEDLE_SHORT));
      }
      let found = -1;
      for (const needle of needles) {
        for (let index = cursor; index < collapsed.length; index += 1) {
          if (collapsed[index].includes(needle)) {
            found = index;
            break;
          }
        }
        if (found >= 0) {
          break;
        }
      }
      if (found < 0 && entry && Number.isInteger(entry.line) && entry.line >= cursor && entry.line < collapsed.length) {
        found = entry.line;
      }
      hits.push(found);
      if (found >= 0) {
        cursor = found + 1;
      }
    }
    return hits;
  }

  const api = { inputNeedle, locateInputs };

  global.KRDInputHistory = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);

// The contract between the Node server and a terminal backend in
// server/remote_helper.py. A backend is an action table; every action takes a
// JSON payload and answers with JSON data. This file is the single source of
// truth: docs/backend-protocol.md is generated from it (scripts/backend-protocol.mjs)
// and tests/backend_contract.test.mjs runs every action against the `mock`
// backend and validates the results with validateResult().
//
// Field types: string, int, bool, string[], object, any, plus the named shapes
// below. A trailing "?" marks an optional field.

// Fields the server adds to every payload from the saved target.
const TARGET_PAYLOAD = {
  backend: "string",
  kittyBinary: "string?",
  tmuxBinary: "string?",
  socketPattern: "string?",
  defaultSocket: "string?"
};

// Shapes referenced by name. The session tree keeps kitty's `ls` shape for
// every backend: OS window > tab > window (the UI calls the last level a pane).
const SHAPES = {
  labels: {
    doc: "UI names for the three tree levels and the create buttons.",
    fields: { osWindow: "string", tab: "string", window: "string", createWindow: "string", createTab: "string", createSplit: "string" }
  },
  osWindow: {
    doc: "Top level of the tree (kitty OS window, tmux session).",
    fields: { id: "int", title: "string?", is_focused: "bool", tabs: "tab[]" }
  },
  tab: {
    doc: "Middle level (kitty tab, tmux window).",
    fields: { id: "int", title: "string?", is_focused: "bool", layout: "string?", windows: "window[]" }
  },
  window: {
    doc: "Selectable pane. `id` is what every pane action's `windowId` names; tmux ids start at 0.",
    fields: {
      id: "int", title: "string?", cwd: "string?", is_active: "bool", is_focused: "bool", is_attached: "bool?",
      alternate_on: "bool?", zoomed: "bool?", at_prompt: "bool?", columns: "int?", lines: "int?",
      window_columns: "int?", window_lines: "int?", pane_count: "int?",
      cmdline: "string[]?", foreground_processes: "object[]?"
    }
  },
  windowGeometry: {
    doc: "Size of the tmux window that holds the selected pane (Screen extent only).",
    fields: { columns: "int", rows: "int", zoomed: "bool" }
  },
  layoutPane: {
    doc: "One pane drawn in place inside the window (Screen extent only).",
    fields: { id: "int", left: "int", top: "int", columns: "int", rows: "int", active: "bool", alternate_on: "bool", title: "string", text: "string" }
  },
  fetched: {
    doc: "A fetched URL. `body`/`encoding` are present for text-like content types; the server rewrites HTML and CSS.",
    fields: {
      url: "string", finalUrl: "string", contentType: "string", bodyBase64: "string", byteLength: "int", truncated: "bool",
      fetchedAt: "string?", body: "string?", encoding: "string?", statusCode: "int?", acceptRanges: "string?", contentRange: "string?"
    }
  }
};

const PANE = { socket: "string?", windowId: "int" };

const ACTIONS = {
  test: {
    backends: "all",
    doc: "Connect/Test: discover sockets and count sessions without selecting a pane.",
    payload: { socket: "string?" },
    result: { host: "string", user: "string", socketPattern: "string", sockets: "string[]", selectedSocket: "string", sessionCount: "int", windowCount: "int", checkedAt: "string", backend: "string?", labels: "labels?" }
  },
  list_sessions: {
    backends: "all",
    doc: "The session tree for one socket.",
    payload: { socket: "string?" },
    result: { backend: "string", sockets: "string[]", selectedSocket: "string", tree: "osWindow[]", discoveredAt: "string", labels: "labels?" }
  },
  get_screen: {
    backends: "all",
    doc: "Pane text. `extent` is `screen` (the live viewport, `scrollOffset` lines back) or `all` (viewport plus scrollback). tmux Screen extent also returns the whole window as `window` + `panes`.",
    payload: { ...PANE, extent: "string", scrollOffset: "int?" },
    result: { socket: "string", windowId: "int", text: "string", format: "string", scrollOffset: "int?", window: "windowGeometry?", panes: "layoutPane[]?" }
  },
  scroll_window: {
    backends: "all",
    doc: "Scroll the pane's viewport by `lines` (negative = into history) or to the end, then return the viewport text. tmux keeps the offset in `scrollOffset`; `alternateScreen` says the app scrolled itself.",
    payload: { ...PANE, lines: "int", toEnd: "bool", scrollOffset: "int?" },
    result: { socket: "string", windowId: "int", lines: "int", text: "string", format: "string", scrollOffset: "int?", alternateScreen: "bool?" }
  },
  send_text: {
    backends: "all",
    doc: "Type `text` into the pane verbatim (bracketed paste when the app supports it), then Enter if `appendNewline`.",
    payload: { ...PANE, text: "string", appendNewline: "bool" },
    result: { socket: "string", windowId: "int", sentLength: "int" }
  },
  send_key: {
    backends: "all",
    doc: "Press `keys` as a chord (kitty key names: enter, escape, ctrl+c, ...), or `key` `repeat` times.",
    payload: { ...PANE, key: "string", keys: "string[]", repeat: "int" },
    result: { socket: "string", windowId: "int", key: "string", keys: "string[]", repeat: "int" }
  },
  focus_window: {
    backends: "all",
    doc: "Make the pane the active one in its window/tab.",
    payload: PANE,
    result: { socket: "string", windowId: "int" }
  },
  create_panel: {
    backends: "all",
    doc: "Create a `window` (top level, started at home), a `tab` next to `sourceWindowId`, or a `split` of it inside `tabId`; returns the new pane id.",
    payload: { socket: "string?", kind: "string", sourceWindowId: "int?", tabId: "int?" },
    result: { socket: "string", kind: "string", windowId: "int", sourceWindowId: "int?", tabId: "int?" }
  },
  close_panel: {
    backends: "all",
    doc: "Close a `session` (tmux only), `tab` or `pane` by id.",
    payload: { socket: "string?", kind: "string", id: "int" },
    result: { socket: "string", kind: "string", id: "int" }
  },
  describe_window: {
    backends: ["tmux", "mock"],
    doc: "Where a pane lives, so the server can attach a control-mode watcher to its session for live events.",
    payload: PANE,
    result: { socket: "string", windowId: "int", sessionId: "string", sessionName: "string", tmuxWindowId: "string", paneId: "string", tmuxBinary: "string" }
  },
  resize_window: {
    backends: ["tmux", "mock"],
    doc: "Resize the pane's window to the browser's cell grid. Attached sessions are skipped unless `force`, which pins window-size to manual.",
    payload: { ...PANE, columns: "int", rows: "int", force: "bool" },
    result: { socket: "string", windowId: "int", attached: "bool", columns: "int", rows: "int", requestedColumns: "int", requestedRows: "int", skipped: "bool?", reason: "string?", zoomed: "bool?", paneCount: "int?", manualSize: "bool?" }
  },
  toggle_zoom: {
    backends: ["tmux", "mock"],
    doc: "prefix-z: zoom the pane or unzoom its window.",
    payload: PANE,
    result: { socket: "string", windowId: "int", zoomed: "bool" }
  },
  fetch_url: {
    backends: "shared",
    doc: "Fetch a file://, http:// or https:// URL from the target host for the Browser (whole body, size-capped).",
    payload: { url: "string" },
    result: "fetched"
  },
  fetch_url_resource: {
    backends: "shared",
    doc: "Same with an HTTP `range` header honoured, for media playback.",
    payload: { url: "string", range: "string?" },
    result: "fetched"
  },
  host_stats: {
    backends: "shared",
    doc: "Memory (Linux MemAvailable; macOS total minus app, wired and compressed) and the disk holding the home directory, in bytes.",
    payload: {},
    result: { host: "string", memTotal: "int", memAvailable: "int", diskPath: "string", diskTotal: "int", diskFree: "int", checkedAt: "string" }
  }
};

// Actions every backend must implement; the rest are optional per backend.
const REQUIRED_BACKEND_ACTIONS = Object.keys(ACTIONS).filter((name) => ACTIONS[name].backends === "all");
const SHARED_ACTIONS = Object.keys(ACTIONS).filter((name) => ACTIONS[name].backends === "shared");

// Whether `backend` implements `action` according to the contract.
function backendSupports(action, backend) {
  const backends = ACTIONS[action]?.backends;
  return backends === "all" || backends === "shared" || (Array.isArray(backends) && backends.includes(backend));
}

function parseType(spec) {
  const optional = spec.endsWith("?");
  const base = optional ? spec.slice(0, -1) : spec;
  const list = base.endsWith("[]");
  return { optional, list, type: list ? base.slice(0, -2) : base };
}

function checkValue(value, type, path, problems) {
  if (type === "any") {
    return;
  }
  if (type === "string" || type === "bool") {
    if (typeof value !== (type === "bool" ? "boolean" : "string")) {
      problems.push(`${path}: expected ${type}, got ${JSON.stringify(value)}`);
    }
    return;
  }
  if (type === "int") {
    if (!Number.isInteger(value)) {
      problems.push(`${path}: expected int, got ${JSON.stringify(value)}`);
    }
    return;
  }
  if (type === "object") {
    if (!value || typeof value !== "object") {
      problems.push(`${path}: expected object`);
    }
    return;
  }
  if (SHAPES[type]) {
    checkFields(value, SHAPES[type].fields, path, problems);
    return;
  }
  problems.push(`${path}: unknown contract type ${type}`);
}

function checkFields(value, fields, path, problems) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${path}: expected an object`);
    return;
  }
  for (const [name, spec] of Object.entries(fields)) {
    const { optional, list, type } = parseType(spec);
    const field = value[name];
    const fieldPath = `${path}.${name}`;
    if (field === undefined || field === null) {
      if (!optional) {
        problems.push(`${fieldPath}: missing`);
      }
      continue;
    }
    if (list) {
      if (!Array.isArray(field)) {
        problems.push(`${fieldPath}: expected a list`);
        continue;
      }
      field.forEach((item, index) => checkValue(item, type, `${fieldPath}[${index}]`, problems));
    } else {
      checkValue(field, type, fieldPath, problems);
    }
  }
}

function resultFields(action) {
  const spec = ACTIONS[action]?.result;
  return typeof spec === "string" ? SHAPES[spec].fields : spec;
}

// Problems with a helper result for `action`; empty when it meets the contract.
function validateResult(action, data) {
  const problems = [];
  if (!ACTIONS[action]) {
    return [`unknown action ${action}`];
  }
  checkFields(data, resultFields(action), action, problems);
  return problems;
}

function validatePayload(action, payload) {
  const problems = [];
  if (!ACTIONS[action]) {
    return [`unknown action ${action}`];
  }
  checkFields(payload, { ...ACTIONS[action].payload, ...TARGET_PAYLOAD }, `${action}.payload`, problems);
  return problems;
}

module.exports = {
  ACTIONS,
  REQUIRED_BACKEND_ACTIONS,
  SHAPES,
  SHARED_ACTIONS,
  TARGET_PAYLOAD,
  backendSupports,
  parseType,
  resultFields,
  validatePayload,
  validateResult
};

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const contract = require("../server/backend_contract.js");
const { createHelperInvocation } = require("../server/helper_runner.js");
const HELPER = new URL("../server/remote_helper.py", import.meta.url);
const run = promisify(execFile);

// Run the real Python helper the way the server does, against the mock backend.
async function helper(action, payload = {}, backend = "mock") {
  const source = await readFile(HELPER, "utf8");
  const invocation = createHelperInvocation({ transport: "local", backend }, action, payload, source);
  const child = run(invocation.command, invocation.args, { maxBuffer: 1024 * 1024 });
  child.child.stdin.end(invocation.stdin);
  const { stdout } = await child;
  return JSON.parse(stdout);
}

const PANE = { windowId: 0 };
const SAMPLE_PAYLOADS = {
  test: {},
  list_sessions: {},
  get_screen: { ...PANE, extent: "screen", scrollOffset: 0 },
  scroll_window: { ...PANE, lines: -5, toEnd: false, scrollOffset: 0 },
  send_text: { ...PANE, text: "echo hi", appendNewline: true },
  send_key: { ...PANE, key: "enter", keys: ["ctrl+x", "ctrl+s"], repeat: 1 },
  focus_window: PANE,
  create_panel: { kind: "split", sourceWindowId: 1, tabId: 1 },
  close_panel: { kind: "pane", id: 2 },
  describe_window: PANE,
  resize_window: { ...PANE, columns: 120, rows: 40, force: false },
  toggle_zoom: PANE
};

test("every contract action is covered by a sample payload that the contract accepts", () => {
  const backendActions = Object.keys(contract.ACTIONS).filter((name) => contract.ACTIONS[name].backends !== "shared");
  assert.deepEqual(Object.keys(SAMPLE_PAYLOADS).sort(), backendActions.sort());
  for (const [action, payload] of Object.entries(SAMPLE_PAYLOADS)) {
    assert.deepEqual(contract.validatePayload(action, { ...payload, backend: "mock" }), [], action);
  }
});

test("the mock backend answers every action with a result that meets the contract", async () => {
  for (const [action, payload] of Object.entries(SAMPLE_PAYLOADS)) {
    const reply = await helper(action, payload);
    assert.equal(reply.ok, true, `${action}: ${reply.error}`);
    assert.deepEqual(contract.validateResult(action, reply.data), [], action);
  }
});

test("the mock backend follows the action semantics the server relies on", async () => {
  const all = (await helper("get_screen", { ...PANE, extent: "all" })).data;
  const screen = (await helper("get_screen", { ...PANE, extent: "screen" })).data;
  assert.ok(all.text.split("\n").length > screen.text.split("\n").length, "all extent includes scrollback");
  assert.equal(screen.panes[0].id, 0);
  assert.equal(screen.panes[0].text, screen.text, "the selected pane's layout text is the screen text");

  const back = (await helper("scroll_window", { ...PANE, lines: -5, toEnd: false, scrollOffset: 0 })).data;
  assert.equal(back.scrollOffset, 5);
  const end = (await helper("scroll_window", { ...PANE, lines: 0, toEnd: true, scrollOffset: 5 })).data;
  assert.equal(end.scrollOffset, 0);

  const sent = (await helper("send_text", { ...PANE, text: "héllo", appendNewline: false })).data;
  assert.equal(sent.sentLength, 5);
  const chord = (await helper("send_key", { ...PANE, key: "x", keys: ["ctrl+x", "ctrl+s"], repeat: 3 })).data;
  assert.deepEqual(chord.keys, ["ctrl+x", "ctrl+s"]);
  const repeated = (await helper("send_key", { ...PANE, key: "ctrl+d", keys: [], repeat: 3 })).data;
  assert.deepEqual(repeated.keys, ["ctrl+d", "ctrl+d", "ctrl+d"]);

  const tree = (await helper("list_sessions")).data.tree;
  assert.equal(tree[0].tabs[1].windows[1].is_active, false);
});

test("host_stats reads this host's memory and disk", async () => {
  const reply = await helper("host_stats");
  assert.equal(reply.ok, true, reply.error);
  assert.deepEqual(contract.validateResult("host_stats", reply.data), []);
  assert.ok(reply.data.memTotal > 0 && reply.data.memAvailable <= reply.data.memTotal);
  assert.ok(reply.data.diskTotal > 0 && reply.data.diskFree <= reply.data.diskTotal);
});

test("the helper reports errors through the envelope", async () => {
  assert.deepEqual(await helper("no_such_action"), { ok: false, error: "Unsupported action: no_such_action" });
  // The server refuses unknown backends before spawning; the helper does too, for payloads built elsewhere.
  const source = await readFile(HELPER, "utf8");
  const raw = run("python3", ["-", "test", Buffer.from(JSON.stringify({ backend: "zellij" })).toString("base64")]);
  raw.child.stdin.end(source);
  assert.match(JSON.parse((await raw).stdout).error, /Unsupported backend: zellij/);
  assert.match((await helper("create_panel", { kind: "tab" })).error, /sourceWindowId is required/);
});

test("kitty and tmux action tables implement the required actions", async () => {
  const source = await readFile(HELPER, "utf8");
  const tableKeys = (name) => {
    const block = source.match(new RegExp(`^${name} = \\{([^}]*)\\}`, "m"));
    assert.ok(block, `${name} table`);
    return [...block[1].matchAll(/"(\w+)":/g)].map((match) => match[1]);
  };
  const required = contract.REQUIRED_BACKEND_ACTIONS;
  for (const table of ["KITTY_ACTIONS", "TMUX_ACTIONS", "MOCK_ACTIONS"]) {
    const keys = tableKeys(table);
    assert.deepEqual(required.filter((name) => !keys.includes(name)), [], `${table} is missing required actions`);
    assert.deepEqual(keys.filter((name) => !contract.ACTIONS[name]), [], `${table} has actions the contract does not know`);
  }
  assert.deepEqual(tableKeys("SHARED_ACTIONS").sort(), contract.SHARED_ACTIONS.sort());
  for (const name of ["describe_window", "resize_window", "toggle_zoom"]) {
    assert.ok(tableKeys("TMUX_ACTIONS").includes(name));
  }
});

test("docs/backend-protocol.md is generated from the contract", async () => {
  const generated = await run(process.execPath, [new URL("../scripts/backend-protocol.mjs", import.meta.url).pathname]);
  const committed = await readFile(new URL("../docs/backend-protocol.md", import.meta.url), "utf8");
  assert.equal(committed, generated.stdout, "run: node scripts/backend-protocol.mjs > docs/backend-protocol.md");
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../server/app.js";
import { createDeviceToken } from "../server/auth.js";
import { validateResult } from "../server/backend_contract.js";

// The API over real HTTP with the Python helper replaced by a stub: routing,
// auth gating, body validation and the screen delta protocol.
async function withApp(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "krd-api-"));
  const calls = [];
  let screenText = "line 1\nline 2\nline 3";
  const app = await createApp({
    dataDir: dir,
    tmpDir: path.join(dir, "tmp"),
    helperSource: "",
    // The stub answers with contract-shaped results, checked on the way out so
    // these tests cannot pass on data the real helper would never send.
    runHelper: async (target, action, payload) => {
      calls.push({ target: target.id, action, payload });
      const base = { socket: payload.socket || "", windowId: payload.windowId ?? 0 };
      const replies = {
        get_screen: { ...base, text: screenText, format: "ansi", scrollOffset: 0 },
        scroll_window: { ...base, lines: payload.lines ?? 0, text: screenText, format: "ansi", scrollOffset: payload.lines > 0 ? 0 : 5 },
        send_text: { ...base, sentLength: String(payload.text || "").length },
        send_key: { ...base, key: payload.key, keys: payload.keys, repeat: payload.repeat },
        focus_window: base,
        toggle_zoom: { ...base, zoomed: true },
        test: { host: "stub", user: "stub", socketPattern: "", sockets: [], selectedSocket: "", sessionCount: 0, windowCount: 0, checkedAt: "" }
      };
      const reply = replies[action] || { ok: true, action };
      if (replies[action]) {
        assert.deepEqual(validateResult(action, reply), [], `stub reply for ${action}`);
      }
      return reply;
    }
  });
  const address = await app.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const { token } = await createDeviceToken(app.context.authManager, "test");
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const api = (route, init = {}) =>
    fetch(`${base}${route}`, {
      ...init,
      headers: { "Content-Type": "application/json", Cookie: cookie, ...(init.headers || {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
  try {
    await run({ base, api, calls, dir, setScreen: (text) => { screenText = text; } });
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("public routes answer without a session; everything else needs the cookie", async () => {
  await withApp(async ({ base }) => {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await (await fetch(`${base}/api/auth/status`)).json()).authenticated, false);
    const denied = await fetch(`${base}/api/targets`);
    assert.equal(denied.status, 401);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    assert.equal((await fetch(`${base}/`)).headers.get("content-type"), "text/html; charset=utf-8");
  });
});

test("pane routes validate their body and forward one helper action", async () => {
  await withApp(async ({ api, calls }) => {
    const bad = await api("/api/send-text", { method: "POST", body: { targetId: "local", windowId: "x" } });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /windowId/);

    const sent = await api("/api/send-key", { method: "POST", body: { targetId: "local", windowId: 0, keys: ["ctrl+x", "ctrl+s"], repeat: 99 } });
    assert.equal(sent.status, 200);
    const call = calls.find((item) => item.action === "send_key");
    assert.deepEqual(call.payload, { socket: "", windowId: 0, key: "ctrl+x", keys: ["ctrl+x", "ctrl+s"], repeat: 5 });

    const zoom = await api("/api/toggle-zoom", { method: "POST", body: { targetId: "local", windowId: 0 } });
    assert.equal(zoom.status, 400);
    assert.match((await zoom.json()).error, /toggle_zoom is not supported by kitty targets/);
  });
});

test("screen polling returns unchanged, a line delta, or the full text", async () => {
  await withApp(async ({ api, setScreen }) => {
    const first = await (await api("/api/screen?targetId=local&windowId=0&extent=all")).json();
    assert.equal(first.text, "line 1\nline 2\nline 3");
    const same = await (await api(`/api/screen?targetId=local&windowId=0&extent=all&since=${first.hash}&delta=1`)).json();
    assert.deepEqual(same, { unchanged: true, hash: first.hash });

    setScreen("line 1\nline 2\nline 3\nline 4");
    const delta = await (await api(`/api/screen?targetId=local&windowId=0&extent=all&since=${first.hash}&delta=1`)).json();
    assert.equal(delta.delta, true);
    assert.equal(delta.base, first.hash);
    assert.deepEqual([delta.drop, delta.keep, delta.tail], [0, 3, ["line 4"]]);

    setScreen("something else entirely");
    const full = await (await api(`/api/screen?targetId=local&windowId=0&extent=all&since=${delta.hash}&delta=1`)).json();
    assert.equal(full.text, "something else entirely");
    assert.equal(full.delta, undefined);
  });
});

test("scroll offsets persist per pane between requests", async () => {
  await withApp(async ({ api, calls }) => {
    await api("/api/scroll-window", { method: "POST", body: { targetId: "local", windowId: 0, lines: -3 } });
    await api("/api/screen?targetId=local&windowId=0");
    assert.equal(calls.at(-1).payload.scrollOffset, 5);
    await api("/api/scroll-window", { method: "POST", body: { targetId: "local", windowId: 0, lines: 3 } });
    await api("/api/screen?targetId=local&windowId=0");
    assert.equal(calls.at(-1).payload.scrollOffset, 0);
  });
});

test("input history is stored per pane on the server", async () => {
  await withApp(async ({ api }) => {
    const pane = { targetId: "mc-tmux", socket: "/tmp/tmux-503/default", windowId: 3 };
    const query = new URLSearchParams({ targetId: pane.targetId, socket: pane.socket, windowId: "3" });
    assert.deepEqual((await (await api(`/api/input-history?${query}`)).json()).entries, []);
    const first = await api("/api/input-history", { method: "POST", body: { ...pane, text: "echo one", line: 10 } });
    assert.equal(first.status, 200);
    const second = await (await api("/api/input-history", { method: "POST", body: { ...pane, text: "echo two" } })).json();
    assert.deepEqual(second.entries.map((entry) => [entry.text, entry.line]), [["echo one", 10], ["echo two", null]]);
    const listed = await (await api(`/api/input-history?${query}`)).json();
    assert.equal(listed.entries.length, 2);
    const otherPane = new URLSearchParams({ targetId: pane.targetId, socket: pane.socket, windowId: "4" });
    assert.deepEqual((await (await api(`/api/input-history?${otherPane}`)).json()).entries, []);
    const blank = await api("/api/input-history", { method: "POST", body: { ...pane, text: "   " } });
    assert.equal(blank.status, 400);
    const cleared = await api("/api/input-history/delete", { method: "POST", body: pane });
    assert.equal(cleared.status, 200);
    assert.deepEqual((await (await api(`/api/input-history?${query}`)).json()).entries, []);
    const anonymous = await fetch(`${(await api("/api/health")).url.replace(/\/api\/health$/, "")}/api/input-history?${query}`);
    assert.equal(anonymous.status, 401);
  });
});

test("download=1 serves a Browser page unrewritten as an attachment", async () => {
  await withApp(async ({ base, api, dir }) => {
    const html = "<!doctype html><html><head><title>报告</title></head><body><img src=\"/abs/x.png\"></body></html>";
    const filePath = path.join(dir, "报告 v2.html");
    await writeFile(filePath, html);
    const url = `file://${filePath}`;
    const { targets } = await (await api("/api/targets")).json();
    const local = targets.find((target) => target.transport === "local");
    const { accessToken } = await (await api(`/api/url-access-token?${new URLSearchParams({ targetId: local.id, url })}`)).json();
    const query = new URLSearchParams({ targetId: local.id, url, access: accessToken });

    const shown = await fetch(`${base}/api/url-resource?${query}`);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get("content-disposition"), null);
    assert.match(await shown.text(), /data-krd-browser-bridge/, "the previewed page is rewritten");

    query.set("download", "1");
    const saved = await fetch(`${base}/api/url-resource?${query}`);
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(
      saved.headers.get("content-disposition"),
      `attachment; filename="__ v2.html"; filename*=UTF-8''${encodeURIComponent("报告 v2.html")}`
    );
    assert.equal(await saved.text(), html, "the download is the file as stored");

    // Without the token or the cookie the download is refused like any resource.
    query.set("access", "nope");
    assert.equal((await fetch(`${base}/api/url-resource?${query}`)).status, 401);
  });
});

test("targets can be saved, selected and listed", async () => {
  await withApp(async ({ api }) => {
    const saved = await (await api("/api/targets", { method: "POST", body: { name: "gpu", sshTarget: "gpu-box", backend: "tmux" } })).json();
    assert.equal(saved.target.transport, "ssh");
    assert.equal((await api("/api/targets/select", { method: "POST", body: { targetId: saved.target.id } })).status, 200);
    const list = await (await api("/api/targets")).json();
    assert.equal(list.lastSelectedTargetId, saved.target.id);
    assert.equal(list.targets.length, 2);
  });
});

// No stub: the real Python helper with the mock backend, end to end over HTTP.
test("a mock target round-trips sessions, screen and input through the real helper", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "krd-api-mock-"));
  const app = await createApp({ dataDir: dir, tmpDir: path.join(dir, "tmp") });
  const address = await app.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const { token } = await createDeviceToken(app.context.authManager, "mock");
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const api = (route, init = {}) => fetch(`${base}${route}`, {
      ...init, headers: { "Content-Type": "application/json", Cookie: cookie }, body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
    const saved = await (await api("/api/targets", { method: "POST", body: { id: "mock", name: "Mock", backend: "mock" } })).json();
    assert.equal(saved.target.backend, "mock");
    const sessions = await (await api("/api/sessions?targetId=mock")).json();
    assert.equal(sessions.backend, "mock");
    assert.equal(sessions.labels.osWindow, "Session");
    const pane = sessions.tree[0].tabs[0].windows[0];
    const screen = await (await api(`/api/screen?targetId=mock&windowId=${pane.id}&extent=all`)).json();
    assert.match(screen.text, /mock pane %0.* line 39/);
    assert.ok(screen.hash);
    const sent = await (await api("/api/send-text", { method: "POST", body: { targetId: "mock", windowId: pane.id, text: "hi", appendNewline: true } })).json();
    assert.equal(sent.sentLength, 2);
    const resized = await (await api("/api/resize-window", { method: "POST", body: { targetId: "mock", windowId: pane.id, columns: 100, rows: 30 } })).json();
    assert.equal(resized.columns, 100, "the contract says mock implements resize_window");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

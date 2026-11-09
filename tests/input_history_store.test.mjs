import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInputHistoryStore, ENTRIES_PER_PANE, MAX_PANES } from "../server/input_history.js";

async function withStore(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "krd-input-history-"));
  try {
    await run(createInputHistoryStore(path.join(dir, "input-history.json")), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const pane = { targetId: "mc-tmux", socket: "/tmp/tmux-503/default", windowId: 7 };

test("entries are kept per pane with the line they were sent at", async () => {
  await withStore(async (store, dir) => {
    assert.deepEqual(await store.list(pane), []);
    await store.record({ ...pane, text: "echo one", line: 12 });
    const entries = await store.record({ ...pane, text: "x".repeat(700), line: "nope" });
    assert.equal(entries.length, 2);
    assert.equal(entries[0].text, "echo one");
    assert.equal(entries[0].line, 12);
    assert.ok(entries[0].at > 0);
    assert.equal(entries[1].text.length, 600);
    assert.equal(entries[1].line, null);
    assert.deepEqual(await store.list({ ...pane, windowId: 8 }), []);
    const saved = JSON.parse(await readFile(path.join(dir, "input-history.json"), "utf8"));
    assert.deepEqual(Object.keys(saved.panes), ["mc-tmux|/tmp/tmux-503/default|7"]);
  });
});

test("blank text and bad pane ids are rejected", async () => {
  await withStore(async (store) => {
    await assert.rejects(store.record({ ...pane, text: "  \n" }), /text is required/);
    await assert.rejects(store.record({ targetId: "", windowId: 1, text: "hi" }), /targetId/);
    await assert.rejects(store.list({ targetId: "t", windowId: -1 }), /windowId/);
  });
});

test("per-pane cap, pane cap by recency, and clear", async () => {
  await withStore(async (store) => {
    for (let index = 0; index < ENTRIES_PER_PANE + 5; index += 1) {
      await store.record({ ...pane, text: `prompt ${index}` });
    }
    const entries = await store.list(pane);
    assert.equal(entries.length, ENTRIES_PER_PANE);
    assert.equal(entries[0].text, "prompt 5");
    for (let index = 0; index < MAX_PANES; index += 1) {
      await store.record({ targetId: "other", windowId: index, text: "x" });
    }
    assert.deepEqual(await store.list(pane), [], "the least recently used pane is dropped");
    assert.equal((await store.list({ targetId: "other", windowId: MAX_PANES - 1 })).length, 1);
    await store.clear({ targetId: "other", windowId: MAX_PANES - 1 });
    assert.deepEqual(await store.list({ targetId: "other", windowId: MAX_PANES - 1 }), []);
  });
});

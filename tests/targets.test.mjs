import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTargetStore, normalizeTarget } from "../server/targets.js";

async function withStore(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "krd-targets-"));
  try {
    await run(createTargetStore(path.join(dir, "targets.json")), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("normalizeTarget infers ssh transport from sshTarget and clears the tmux socket pattern", () => {
  const target = normalizeTarget({ name: "gpu", sshTarget: "gpu-box", backend: "tmux" });
  assert.equal(target.transport, "ssh");
  assert.equal(target.socketPattern, "");
  assert.equal(normalizeTarget({ name: "k" }).socketPattern, "/tmp/kitty.sock-*");
  assert.throws(() => normalizeTarget({ sshTarget: "x" }), /name is required/);
  assert.throws(() => normalizeTarget({ name: "x", transport: "ssh" }), /SSH target is required/);
});

test("a new store seeds one local target and keeps a local target when none is saved", async () => {
  await withStore(async (store, dir) => {
    const seeded = await store.read();
    assert.equal(seeded.targets.length, 1);
    assert.equal(seeded.targets[0].transport, "local");
    assert.equal(seeded.lastSelectedTargetId, "local");

    await store.write({ lastSelectedTargetId: "gpu", targets: [{ id: "gpu", name: "gpu", sshTarget: "gpu-box", backend: "tmux" }] });
    const repaired = await store.read();
    assert.deepEqual(repaired.targets.map((target) => target.id), ["local", "gpu"]);
    assert.equal(JSON.parse(await readFile(path.join(dir, "targets.json"), "utf8")).targets.length, 2);
  });
});

test("upsert, select and resolve round-trip through the file", async () => {
  await withStore(async (store) => {
    const created = await store.upsert({ name: "gpu", sshTarget: "gpu-box", backend: "tmux" });
    assert.match(created.id, /^target-/);
    const updated = await store.upsert({ id: created.id, name: "gpu 2", sshTarget: "gpu-box", backend: "tmux" });
    assert.equal(updated.id, created.id);
    const read = await store.read();
    assert.equal(read.targets.find((target) => target.id === created.id).name, "gpu 2");
    assert.equal(read.lastSelectedTargetId, created.id);

    await store.select("local");
    assert.equal((await store.read()).lastSelectedTargetId, "local");
    await assert.rejects(store.select("nope"), /Target not found/);

    assert.equal((await store.resolve({ targetId: created.id })).name, "gpu 2");
    assert.equal((await store.resolve({ target: { name: "adhoc" } })).name, "adhoc");
    await assert.rejects(store.resolve({ targetId: "missing" }), /was not found/);
    await assert.rejects(store.resolve({}), /targetId or target payload/);
  });
});

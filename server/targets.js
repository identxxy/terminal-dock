const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { normalizeBackend, normalizeTransport } = require("./helper_runner");

const DEFAULT_TARGET = {
  id: "local",
  name: "Local Kitty",
  transport: "local",
  backend: "kitty",
  sshTarget: "",
  kittyBinary: "kitty",
  tmuxBinary: "tmux",
  socketPattern: "/tmp/kitty.sock-*",
  defaultSocket: "",
  notes: "Local GUI kitty session on this machine"
};

function createId() {
  return `target-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTarget(input, fallbackId) {
  const transport = normalizeTransport(input.transport || (input.sshTarget ? "ssh" : "local"));
  const backend = normalizeBackend(input.backend);
  const target = {
    id: String(input.id || fallbackId || createId()).trim(),
    name: String(input.name || "").trim(),
    transport,
    backend,
    sshTarget: String(input.sshTarget || "").trim(),
    kittyBinary: String(input.kittyBinary || DEFAULT_TARGET.kittyBinary).trim(),
    tmuxBinary: String(input.tmuxBinary || DEFAULT_TARGET.tmuxBinary).trim(),
    // An empty tmux pattern means the helper derives $TMUX_TMPDIR/tmux-UID/* on the target.
    socketPattern: String(input.socketPattern || (backend === "tmux" ? "" : DEFAULT_TARGET.socketPattern)).trim(),
    defaultSocket: String(input.defaultSocket || "").trim(),
    notes: String(input.notes || "").trim(),
    createdAt: input.createdAt || undefined,
    updatedAt: input.updatedAt || undefined
  };

  if (!target.name) {
    throw new Error("Target name is required.");
  }

  if (target.transport === "ssh" && !target.sshTarget) {
    throw new Error("SSH target is required.");
  }

  return target;
}

// Saved connection targets in data/targets.json. The file always holds at
// least one local target so a fresh deck can drive the machine it runs on.
function createTargetStore(filePath) {
  async function ensure() {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });

    try {
      await fsp.access(filePath, fs.constants.F_OK);
    } catch (error) {
      const seeded = {
        lastSelectedTargetId: DEFAULT_TARGET.id,
        targets: [{ ...DEFAULT_TARGET, createdAt: nowIso(), updatedAt: nowIso() }]
      };
      await fsp.writeFile(filePath, JSON.stringify(seeded, null, 2));
      return;
    }

    const store = JSON.parse(await fsp.readFile(filePath, "utf8"));
    const targets = (store.targets || []).map((target) => normalizeTarget(target, target.id));

    if (!targets.some((target) => target.transport === "local")) {
      const localTarget = { ...DEFAULT_TARGET, createdAt: nowIso(), updatedAt: nowIso() };
      targets.unshift(localTarget);
      store.targets = targets;
      store.lastSelectedTargetId = localTarget.id;
      await fsp.writeFile(filePath, JSON.stringify(store, null, 2));
    }
  }

  async function read() {
    await ensure();
    const store = JSON.parse(await fsp.readFile(filePath, "utf8"));
    return {
      ...store,
      targets: (store.targets || []).map((target) => normalizeTarget(target, target.id))
    };
  }

  async function write(store) {
    await fsp.writeFile(filePath, JSON.stringify(store, null, 2));
  }

  async function upsert(input, fallbackId) {
    const store = await read();
    const normalized = normalizeTarget(input, fallbackId);
    const existingIndex = store.targets.findIndex((item) => item.id === normalized.id);

    if (existingIndex >= 0) {
      store.targets[existingIndex] = { ...store.targets[existingIndex], ...normalized, updatedAt: nowIso() };
    } else {
      store.targets.push({ ...normalized, createdAt: nowIso(), updatedAt: nowIso() });
    }

    store.lastSelectedTargetId = normalized.id;
    await write(store);
    return normalized;
  }

  async function select(targetId) {
    const store = await read();
    if (!store.targets.some((target) => target.id === targetId)) {
      throw new Error("Target not found.");
    }
    store.lastSelectedTargetId = targetId;
    await write(store);
  }

  // A request names a saved target by id, or carries a whole target (the
  // Connect form's Test button before the target is saved).
  async function resolve(bodyOrQuery) {
    const targetId = bodyOrQuery.targetId || bodyOrQuery.id;

    if (targetId) {
      const store = await read();
      const matched = store.targets.find((target) => target.id === targetId);
      if (!matched) {
        throw new Error(`Target "${targetId}" was not found.`);
      }
      return matched;
    }

    if (bodyOrQuery.target) {
      return normalizeTarget(bodyOrQuery.target);
    }

    throw new Error("A targetId or target payload is required.");
  }

  return { ensure, read, write, upsert, select, resolve };
}

module.exports = { DEFAULT_TARGET, createTargetStore, normalizeTarget, nowIso };

// Harbor: temporary, rule-bound access to one agent pane for another person's
// agent. Tokens live in data/harbor.json (scrypt hashes only), every event of a
// token is appended to a hash-chained ledger in data/harbor/<id>.jsonl, and a
// request's state is replayed from that ledger. Delivery goes through the `td`
// engine: `td harbor activate` stores the policy that td-hook enforces in the
// pane, `td send` pastes the request, `td harbor fetch` collects the agent's
// final message once its turn ends. See docs/plans/2026-11-18-harbor.md.
const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

const DEFAULT_TTL_MS = 3 * 60 * 60 * 1000;
const DEFAULT_MAX_REQUESTS = 100;
// A token's history (ledger and record) is deleted this long after it stops
// working, by expiry or revocation.
const DEFAULT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const MAX_REQUEST_CHARS = 16000;
const LEVELS = ["explain", "read"];
const MODES = ["auto", "approve"];
const REPLY_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 2000;
const BUSY_RETRY_MS = 5000;
const VERIFY_CACHE_MS = 5 * 60 * 1000;
const SCRYPT_KEY_LENGTH = 32;
const OPEN_STATUSES = new Set(["pending_owner", "queued", "delivered"]);
const CONTROL_CHARACTERS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

function nowIso() {
  return new Date().toISOString();
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function hashToken(token, salt) {
  return crypto.scryptSync(token, salt, SCRYPT_KEY_LENGTH).toString("base64url");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function parseDuration(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(m|h|d)$/.exec(String(value || "").trim());
  if (!match) {
    throw new Error(`Bad duration ${value}; use e.g. 90m, 3h, 1d.`);
  }
  return Math.round(Number(match[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[match[2]]);
}

function endedAt(record) {
  const expires = Date.parse(record.expiresAt);
  return record.revokedAt ? Math.min(Date.parse(record.revokedAt), expires) : expires;
}

function deleteAt(record) {
  return new Date(endedAt(record) + (record.keepMs ?? DEFAULT_KEEP_MS)).toISOString();
}

function publicToken(record, now = Date.now()) {
  const expired = Date.parse(record.expiresAt) <= now;
  return {
    id: record.id,
    to: record.to,
    level: record.level,
    mode: record.mode,
    host: record.host,
    pane: record.pane,
    paneTitle: record.paneTitle || "",
    roots: record.roots,
    rules: record.rules,
    maxRequests: record.maxRequests,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt || null,
    deleteAt: deleteAt(record),
    state: record.revokedAt ? "revoked" : expired ? "expired" : "active",
    tokenPreview: record.tokenPreview
  };
}

// Runs scripts/td (the engine) and resolves {code, stdout, stderr}.
function runTd(tdPath, args, input = "", timeoutMs = 60000) {
  return new Promise((resolve) => {
    const child = spawn("python3", [tdPath, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr: stderr.trim() });
    });
    child.stdin.end(input);
  });
}

function lastLine(text) {
  return String(text || "").trim().split("\n").pop() || "";
}

function createHarbor(options) {
  const storeFile = path.join(options.dataDir, "harbor.json");
  const ledgerDir = path.join(options.dataDir, "harbor");
  const tdPath = options.tdPath;
  const td = options.runTd || ((args, input, timeoutMs) => runTd(tdPath, args, input, timeoutMs));
  const requestsByToken = new Map();
  const workers = new Set();
  const verifyCache = new Map();
  const changes = new EventEmitter();
  changes.setMaxListeners(0);
  const lastPost = new Map();

  async function readStore() {
    try {
      const store = JSON.parse(await fsp.readFile(storeFile, "utf8"));
      return { tokens: Array.isArray(store.tokens) ? store.tokens : [] };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { tokens: [] };
      }
      throw error;
    }
  }

  async function writeStore(store) {
    await fsp.mkdir(path.dirname(storeFile), { recursive: true });
    const temporary = `${storeFile}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
    await fsp.rename(temporary, storeFile);
  }

  async function findToken(id) {
    const record = (await readStore()).tokens.find((token) => token.id === id);
    if (!record) {
      throw httpError(404, `No Harbor token ${id}.`);
    }
    return record;
  }

  // ---- Ledger: one append-only, hash-chained JSONL file per token ----------
  const ledgerTails = new Map();

  async function readLedger(id) {
    try {
      const text = await fsp.readFile(path.join(ledgerDir, `${id}.jsonl`), "utf8");
      return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  // Appends are chained per token so concurrent events keep their order.
  function appendLedger(id, event) {
    const previous = ledgerTails.get(id) || Promise.resolve();
    const next = previous.then(async () => {
      const entries = await readLedger(id);
      const prev = entries.length ? entries[entries.length - 1].hash : "";
      const entry = { seq: entries.length + 1, time: nowIso(), ...event, prev };
      entry.hash = sha256(prev + JSON.stringify({ ...entry, hash: undefined }));
      await fsp.mkdir(ledgerDir, { recursive: true });
      await fsp.appendFile(path.join(ledgerDir, `${id}.jsonl`), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      return entry;
    });
    ledgerTails.set(id, next.catch(() => {}));
    return next;
  }

  function verifyLedger(entries) {
    let prev = "";
    for (const entry of entries) {
      if (entry.prev !== prev || entry.hash !== sha256(prev + JSON.stringify({ ...entry, hash: undefined }))) {
        return { ok: false, brokenAt: entry.seq };
      }
      prev = entry.hash;
    }
    return { ok: true, entries: entries.length };
  }

  // ---- Requests: replayed from the ledger, then kept in memory --------------
  function applyEvent(requests, entry) {
    if (entry.type === "input") {
      requests.push({
        id: entry.request, text: entry.text, status: entry.status, reason: entry.reason || "",
        reply: "", tools: [], createdAt: entry.time, updatedAt: entry.time
      });
      return;
    }
    const request = requests.find((item) => item.id === entry.request);
    if (!request) {
      return;
    }
    request.updatedAt = entry.time;
    if (entry.type === "owner_decision") {
      request.status = entry.approve ? "queued" : "rejected";
      request.reason = entry.reason || "";
    } else if (entry.type === "delivered") {
      request.status = "delivered";
    } else if (entry.type === "tool") {
      request.tools.push({ tool: entry.tool, allowed: entry.allowed, reason: entry.reason });
    } else if (entry.type === "output") {
      request.status = "replied";
      request.reply = entry.text;
    } else if (entry.type === "failed") {
      request.status = "failed";
      request.reason = entry.reason;
    }
  }

  async function requestsFor(id) {
    if (!requestsByToken.has(id)) {
      const requests = [];
      (await readLedger(id)).forEach((entry) => applyEvent(requests, entry));
      // A request that was being delivered when the server stopped cannot be
      // resumed safely (the pane may have moved on); report it as failed.
      for (const request of requests.filter((item) => item.status === "delivered")) {
        const entry = await appendLedger(id, { type: "failed", request: request.id, reason: "Terminal Dock restarted while this request was being served." });
        applyEvent(requests, entry);
      }
      requestsByToken.set(id, requests);
    }
    return requestsByToken.get(id);
  }

  async function recordEvent(id, event) {
    const entry = await appendLedger(id, event);
    const requests = await requestsFor(id);
    applyEvent(requests, entry);
    changes.emit("change", id, event.request);
    return entry;
  }

  // ---- Tokens ------------------------------------------------------------------
  async function grant(input) {
    const level = input.level || "read";
    const mode = input.mode || "auto";
    if (!LEVELS.includes(level)) {
      throw new Error(`Level must be one of ${LEVELS.join(", ")} for now.`);
    }
    if (!MODES.includes(mode)) {
      throw new Error(`Mode must be one of ${MODES.join(", ")}.`);
    }
    if (!input.to || !input.host || !input.pane || !Array.isArray(input.roots) || !input.roots.length) {
      throw new Error("A grant needs to, host, pane and roots.");
    }
    const id = `hb-${crypto.randomBytes(4).toString("hex")}`;
    const secret = crypto.randomBytes(24).toString("base64url");
    const token = `hbt_${id.slice(3)}_${secret}`;
    const salt = crypto.randomBytes(16).toString("base64url");
    const createdAt = nowIso();
    const ttlMs = input.ttl ? parseDuration(input.ttl) : DEFAULT_TTL_MS;
    const recordFields = {
      id,
      to: String(input.to).trim(),
      level,
      mode,
      host: input.host,
      pane: input.pane,
      paneTitle: input.paneTitle || "",
      roots: input.roots,
      rules: String(input.rules || "").trim(),
      privateRules: String(input.privateRules || "").trim(),
      maxRequests: Number(input.maxRequests || DEFAULT_MAX_REQUESTS),
      createdAt,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      keepMs: input.keep ? parseDuration(input.keep) : DEFAULT_KEEP_MS,
      revokedAt: null,
      tokenSalt: salt,
      tokenHash: hashToken(token, salt),
      tokenPreview: `${token.slice(0, 15)}…`
    };
    const store = await readStore();
    store.tokens.push(recordFields);
    await writeStore(store);
    const { tokenSalt, tokenHash, ...snapshot } = recordFields;
    await appendLedger(id, { type: "grant", token: snapshot });
    return { token, record: publicToken(recordFields) };
  }

  async function revoke(id, by = "owner") {
    const store = await readStore();
    const token = store.tokens.find((item) => item.id === id);
    if (!token) {
      throw httpError(404, `No Harbor token ${id}.`);
    }
    if (!token.revokedAt) {
      token.revokedAt = nowIso();
      await writeStore(store);
      await recordEvent(id, { type: "revoke", by });
    }
    verifyCache.clear();
    return publicToken(token);
  }

  async function verify(authorization) {
    const match = /^Bearer\s+(hbt_([0-9a-f]{8})_[A-Za-z0-9_-]+)$/.exec(String(authorization || "").trim());
    if (!match) {
      throw httpError(401, "Send the Harbor token as Authorization: Bearer hbt_….");
    }
    const [, token, idPart] = match;
    const cacheKey = sha256(token);
    const cached = verifyCache.get(cacheKey);
    const record = await findToken(`hb-${idPart}`).catch(() => null);
    if (!record) {
      throw httpError(401, "Unknown Harbor token.");
    }
    if (!cached || cached.expires < Date.now()) {
      const expected = Buffer.from(record.tokenHash);
      const actual = Buffer.from(hashToken(token, record.tokenSalt));
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        throw httpError(401, "Unknown Harbor token.");
      }
      verifyCache.set(cacheKey, { expires: Date.now() + VERIFY_CACHE_MS });
    }
    if (record.revokedAt) {
      throw httpError(403, "This Harbor token was revoked.");
    }
    if (Date.parse(record.expiresAt) <= Date.now()) {
      throw httpError(403, `This Harbor token expired at ${record.expiresAt}.`);
    }
    return record;
  }

  // ---- Requests from the guest agent --------------------------------------
  async function submit(record, text) {
    text = String(text || "").replace(/\r\n?/g, "\n").trim();
    if (!text) {
      throw httpError(400, "Send {\"text\": \"…\"}.");
    }
    if (text.length > MAX_REQUEST_CHARS) {
      throw httpError(413, `A request is limited to ${MAX_REQUEST_CHARS} characters.`);
    }
    if (CONTROL_CHARACTERS.test(text)) {
      throw httpError(400, "Control characters are not allowed; send plain text.");
    }
    const since = Date.now() - (lastPost.get(record.id) || 0);
    if (since < 2000) {
      throw httpError(429, "One request every 2 seconds.");
    }
    lastPost.set(record.id, Date.now());
    const requests = await requestsFor(record.id);
    if (requests.length >= record.maxRequests) {
      throw httpError(429, `This token's ${record.maxRequests} requests are used up.`);
    }
    const id = `${record.id}-r${requests.length + 1}`;
    const status = record.mode === "approve" ? "pending_owner" : "queued";
    await recordEvent(record.id, { type: "input", request: id, text, status });
    runWorker(record.id);
    return requests.find((item) => item.id === id);
  }

  async function decide(tokenId, requestId, approve, reason) {
    const requests = await requestsFor(tokenId);
    const request = requests.find((item) => item.id === requestId);
    if (!request) {
      throw httpError(404, `No request ${requestId}.`);
    }
    if (request.status !== "pending_owner") {
      throw httpError(409, `Request ${requestId} is ${request.status}, not waiting for a decision.`);
    }
    await recordEvent(tokenId, { type: "owner_decision", request: requestId, approve: Boolean(approve), reason: String(reason || "") });
    runWorker(tokenId);
    return request;
  }

  // Resolves when the request leaves its open states or after waitMs.
  async function waitFor(tokenId, requestId, waitMs) {
    const find = async () => (await requestsFor(tokenId)).find((item) => item.id === requestId);
    let request = await find();
    if (!request) {
      throw httpError(404, `No request ${requestId}.`);
    }
    if (!waitMs || !OPEN_STATUSES.has(request.status)) {
      return request;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(done, waitMs);
      function listener(changedToken, changedRequest) {
        if (changedToken === tokenId && changedRequest === requestId && !OPEN_STATUSES.has(request.status)) {
          done();
        }
      }
      function done() {
        clearTimeout(timer);
        changes.off("change", listener);
        resolve();
      }
      changes.on("change", listener);
    });
    return find();
  }

  // ---- Delivery worker: one per token, one request at a time ---------------
  function runWorker(tokenId) {
    if (workers.has(tokenId)) {
      return;
    }
    workers.add(tokenId);
    serveQueue(tokenId)
      .catch((error) => console.error(`Harbor worker ${tokenId}:`, error))
      .finally(() => workers.delete(tokenId));
  }

  async function serveQueue(tokenId) {
    for (;;) {
      const request = (await requestsFor(tokenId)).find((item) => item.status === "queued");
      if (!request) {
        return;
      }
      const tokenRecord = await findToken(tokenId);
      if (tokenRecord.revokedAt || Date.parse(tokenRecord.expiresAt) <= Date.now()) {
        await recordEvent(tokenId, { type: "failed", request: request.id, reason: "The token expired or was revoked before delivery." });
        continue;
      }
      const reason = await deliver(tokenRecord, request);
      if (reason) {
        await recordEvent(tokenId, { type: "failed", request: request.id, reason });
      }
    }
  }

  // Returns a failure reason, or "" once the reply has been recorded.
  async function deliver(tokenRecord, request) {
    const target = `${tokenRecord.host}:${tokenRecord.pane}`;
    const policy = JSON.stringify({
      request: request.id, token: tokenRecord.id, to: tokenRecord.to, level: tokenRecord.level,
      roots: tokenRecord.roots, rules: tokenRecord.rules, privateRules: tokenRecord.privateRules
    });
    // Wait for the agent to be idle: the pane may be busy with the owner's own work.
    const waitUntil = Date.now() + REPLY_TIMEOUT_MS;
    for (;;) {
      const activated = await td(["harbor", "activate", target], policy, 30000);
      if (activated.code === 0) {
        break;
      }
      if (activated.code !== 4) {
        return `Could not prepare the agent: ${lastLine(activated.stdout) || lastLine(activated.stderr)}`;
      }
      if (Date.now() > waitUntil) {
        return "The agent stayed busy; try again later.";
      }
      await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
    }
    const prefix = `[harbor ${request.id} from "${tokenRecord.to.replace(/"/g, "'")}" · ${tokenRecord.id}]`;
    // --force: the owner granted this pane, and the dock watching it counts as attached.
    const sent = await td(["send", target, "-", "--enter", "--force", "--prefix", prefix, "--json"], request.text, 30000);
    if (sent.code !== 0) {
      await td(["harbor", "deactivate", target], "", 30000);
      const refused = (() => {
        try {
          return JSON.parse(lastLine(sent.stdout)).refused;
        } catch (error) {
          return "";
        }
      })();
      return `Could not deliver: ${refused || lastLine(sent.stderr) || `td send exit ${sent.code}`}`;
    }
    await recordEvent(tokenRecord.id, { type: "delivered", request: request.id });
    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const fetched = await td(["harbor", "fetch", tokenRecord.host, request.id], "", 30000);
      let result = null;
      try {
        result = JSON.parse(lastLine(fetched.stdout));
      } catch (error) {
        continue;
      }
      if (!result.done) {
        continue;
      }
      for (const event of result.events || []) {
        await recordEvent(tokenRecord.id, { type: "tool", request: request.id, tool: event.tool, input: event.input, allowed: event.allowed, reason: event.reason || "" });
      }
      await recordEvent(tokenRecord.id, { type: "output", request: request.id, text: String(result.text || "").trim() || "(The agent finished without a message.)" });
      return "";
    }
    await td(["harbor", "deactivate", target], "", 30000);
    return "The agent did not finish within 15 minutes.";
  }

  // ---- Owner views -----------------------------------------------------------
  async function overview() {
    const store = await readStore();
    const now = Date.now();
    return Promise.all(store.tokens.slice().reverse().map(async (token) => ({
      ...publicToken(token, now),
      privateRules: token.privateRules,
      requests: (await requestsFor(token.id)).map((request) => ({ ...request }))
    })));
  }

  async function log(id) {
    const entries = await readLedger(id);
    return { entries, integrity: verifyLedger(entries) };
  }

  // Deletes the history of tokens whose keep period after expiry or revocation is over.
  async function sweep(now = Date.now()) {
    const store = await readStore();
    const due = store.tokens.filter((token) => Date.parse(deleteAt(token)) <= now);
    if (!due.length) {
      return [];
    }
    store.tokens = store.tokens.filter((token) => !due.includes(token));
    await writeStore(store);
    for (const token of due) {
      await fsp.rm(path.join(ledgerDir, `${token.id}.jsonl`), { force: true });
      requestsByToken.delete(token.id);
    }
    return due.map((token) => token.id);
  }

  // Requests still queued from before a restart resume on startup; old
  // histories are swept now and every hour.
  async function resume() {
    await sweep();
    setInterval(() => sweep().catch((error) => console.error("Harbor sweep:", error)), SWEEP_INTERVAL_MS).unref();
    for (const token of (await readStore()).tokens) {
      if ((await requestsFor(token.id)).some((request) => request.status === "queued")) {
        runWorker(token.id);
      }
    }
  }

  return { grant, revoke, verify, submit, decide, waitFor, overview, log, resume, sweep, requestsFor, publicToken };
}

module.exports = { createHarbor, parseDuration, publicToken, DEFAULT_TTL_MS, DEFAULT_KEEP_MS, LEVELS, MODES };

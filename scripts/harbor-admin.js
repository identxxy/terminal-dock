#!/usr/bin/env node

const { spawnSync } = require("child_process");
const path = require("path");
const { createHarbor, LEVELS, MODES } = require("../server/harbor");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = process.env.KRD_DATA_DIR || path.join(ROOT_DIR, "data");
const TD = path.join(__dirname, "td");
const PUBLIC_URL = (process.env.HARBOR_PUBLIC_URL || "https://td.xuxinyuan.tech").replace(/\/$/, "");
const harbor = createHarbor({ dataDir: DATA_DIR, tdPath: TD });

function usage() {
  console.log(`Usage:
  node scripts/harbor-admin.js grant HOST:TARGET --to NAME [--level read|explain] [--paths a,b]
        [--ttl 3h] [--keep 30d] [--mode auto|approve] [--max-requests 100] [--rules FILE] [--private-rules FILE]
  node scripts/harbor-admin.js ls
  node scripts/harbor-admin.js revoke ID
  node scripts/harbor-admin.js log ID

HOST:TARGET is a td target (td ls): a pane id (%12), SESSION[:WINDOW[.PANE]] or /TITLE.
The pane must run Claude Code with td-hook installed (td hooks install).
Defaults: level read, ttl 3h, mode auto. The token's history (requests, tool calls, replies)
is kept for --keep (default 30d) after it expires or is revoked, then deleted. --paths limits what the agent may read for the
guest (paths on that host); without it the agent's working directory is used, which must
not be the home directory.

Data: ${DATA_DIR}`);
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith("--")) {
      flags[args[index].slice(2)] = args[index + 1];
      index += 1;
    } else {
      positional.push(args[index]);
    }
  }
  return { flags, positional };
}

function td(args) {
  const result = spawnSync("python3", [TD, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `td ${args[0]} failed`).trim());
  }
  return JSON.parse(result.stdout);
}

function readText(file) {
  return file ? require("fs").readFileSync(file, "utf8") : "";
}

async function grant(args) {
  const { flags, positional } = parseFlags(args);
  const target = positional[0] || "";
  if (!target.includes(":") || !flags.to) {
    usage();
    process.exitCode = 1;
    return;
  }
  const level = flags.level || "read";
  if (!LEVELS.includes(level)) {
    throw new Error(`--level must be one of ${LEVELS.join(", ")}.`);
  }
  if (flags.mode && !MODES.includes(flags.mode)) {
    throw new Error(`--mode must be one of ${MODES.join(", ")}.`);
  }
  const host = target.slice(0, target.indexOf(":"));
  const screen = td(["cat", target, "--json"]);
  const pane = td(["ls", host, "--json"])[0].sessions.flatMap((session) => session.panes).find((item) => item.id === screen.pane);
  if (!pane) {
    throw new Error(`Pane ${screen.pane} not found on ${host}.`);
  }
  if (pane.command !== "claude") {
    throw new Error(`${host}:${pane.id} runs ${pane.command}; Harbor needs Claude Code (its hooks enforce the rules).`);
  }
  const home = /^(\/Users\/[^/]+|\/home\/[^/]+|\/root)\/?$/;
  const roots = flags.paths ? flags.paths.split(",").map((item) => item.trim()).filter(Boolean) : [pane.cwd];
  if (roots.some((root) => home.test(root) || root === "~" || root === "/")) {
    throw new Error(`The shared folder would be ${roots.join(", ")}, a home or root directory; pass --paths with the project folders to share.`);
  }
  const { token, record } = await harbor.grant({
    to: flags.to,
    host,
    pane: pane.id,
    paneTitle: pane.title,
    roots,
    level,
    mode: flags.mode,
    ttl: flags.ttl,
    keep: flags.keep,
    maxRequests: flags["max-requests"],
    rules: readText(flags.rules),
    privateRules: readText(flags["private-rules"])
  });
  console.log(`Harbor ${record.id} → ${record.to}
  pane     ${host}:${pane.id}  ${pane.title}
  level    ${record.level}: ${record.roots.join(", ")}
  mode     ${record.mode}
  expires  ${record.expiresAt}
  history  deleted ${record.deleteAt}

Token, shown once:
${token}

Message for their agent:
---
You have temporary access to an AI agent session through Harbor.
Read ${PUBLIC_URL}/harbor/v1/ with the header "Authorization: Bearer ${token}"
for the scope, rules and API, then send requests as it describes.
---`);
  // td-hook writes this file once the agent handles a prompt with the hooks loaded.
  const stateFile = `.local/state/terminal-dock/panes/${pane.id.slice(1)}.json`;
  const hooked = host === "local"
    ? require("fs").existsSync(path.join(require("os").homedir(), stateFile))
    : spawnSync("ssh", ["-o", "BatchMode=yes", host, `test -f ~/${stateFile}`]).status === 0;
  if (!hooked) {
    console.log(`\nWarning: ${host}:${pane.id} has no td-hook state, so requests will be refused. Install the hooks on ${host} (td hooks install) and let that agent handle one prompt.`);
  }
}

async function list() {
  const tokens = await harbor.overview();
  if (!tokens.length) {
    console.log("No Harbor tokens.");
    return;
  }
  for (const token of tokens) {
    const counts = {};
    token.requests.forEach((request) => { counts[request.status] = (counts[request.status] || 0) + 1; });
    const summary = Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(", ") || "no requests";
    console.log(`${token.id}\t${token.state}\t${token.to}\t${token.host}:${token.pane}\t${token.level}\tuntil ${token.expiresAt}\tdeleted ${token.deleteAt.slice(0, 10)}\t${summary}`);
  }
}

async function log(args) {
  const { entries, integrity } = await harbor.log(args[0] || "");
  for (const entry of entries) {
    const { seq, time, type, request, prev, hash, ...rest } = entry;
    const detail = type === "grant" ? `${rest.token.to} ${rest.token.level} ${rest.token.host}:${rest.token.pane}` : JSON.stringify(rest);
    console.log(`${String(seq).padStart(3)} ${time} ${type.padEnd(14)} ${request || ""} ${detail}`.slice(0, 400));
  }
  console.log(integrity.ok ? `ledger intact (${integrity.entries} entries)` : `LEDGER BROKEN at entry ${integrity.brokenAt}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "grant") {
    await grant(args);
  } else if (command === "ls") {
    await list();
  } else if (command === "revoke") {
    console.log(`Revoked ${(await harbor.revoke(args[0] || "")).id}.`);
  } else if (command === "log") {
    await log(args);
  } else {
    usage();
    process.exitCode = command ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

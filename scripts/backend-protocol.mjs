// Prints docs/backend-protocol.md from server/backend_contract.js.
// Usage: node scripts/backend-protocol.mjs > docs/backend-protocol.md
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contract = require("../server/backend_contract.js");

function fieldRows(fields) {
  return Object.entries(fields)
    .map(([name, spec]) => {
      const { optional, list, type } = contract.parseType(spec);
      const shown = contract.SHAPES[type] ? `[${type}](#shape-${type.toLowerCase()})${list ? "[]" : ""}` : `${type}${list ? "[]" : ""}`;
      return `| \`${name}\` | ${shown} | ${optional ? "optional" : "required"} |`;
    })
    .join("\n");
}

function table(fields) {
  return `| field | type | |\n| --- | --- | --- |\n${fieldRows(fields)}`;
}

function backendsLabel(backends) {
  if (backends === "all") return "every backend";
  if (backends === "shared") return "shared (any host, no terminal needed)";
  return backends.join(", ");
}

const lines = [];
lines.push("# Backend protocol");
lines.push("");
lines.push("Generated from `server/backend_contract.js` by `node scripts/backend-protocol.mjs`; do not edit by hand.");
lines.push("");
lines.push("A backend is an action table in `server/remote_helper.py`, registered in `BACKENDS` and selected by `payload.backend`. The server runs the helper as one process per action (`python3 - <action> <base64 payload>`, locally or over ssh) and reads one JSON object from stdout:");
lines.push("");
lines.push("```json");
lines.push('{ "ok": true, "data": { ...result } }');
lines.push('{ "ok": false, "error": "message" }');
lines.push("```");
lines.push("");
lines.push("Every payload carries the target fields below in addition to the action's own fields. `socket` names the terminal server socket; an empty value means \"the default or the most recent one\".");
lines.push("");
lines.push(table(contract.TARGET_PAYLOAD));
lines.push("");
lines.push(`A backend must implement: ${contract.REQUIRED_BACKEND_ACTIONS.map((name) => `\`${name}\``).join(", ")}. The shared actions (${contract.SHARED_ACTIONS.map((name) => `\`${name}\``).join(", ")}) are implemented once for every backend. \`describe_window\`, \`resize_window\` and \`toggle_zoom\` are optional; the server only calls them for backends that advertise them. The \`mock\` backend is the reference implementation and what \`tests/backend_contract.test.mjs\` runs.`);
lines.push("");
lines.push("## Actions");
for (const [name, action] of Object.entries(contract.ACTIONS)) {
  lines.push("");
  lines.push(`### \`${name}\``);
  lines.push("");
  lines.push(`${action.doc} Backends: ${backendsLabel(action.backends)}.`);
  lines.push("");
  lines.push("Payload:");
  lines.push("");
  lines.push(table(action.payload));
  lines.push("");
  lines.push("Result:");
  lines.push("");
  lines.push(typeof action.result === "string" ? `A [${action.result}](#shape-${action.result.toLowerCase()}).` : table(action.result));
}
lines.push("");
lines.push("## Shapes");
for (const [name, shape] of Object.entries(contract.SHAPES)) {
  lines.push("");
  lines.push(`### Shape: ${name}`);
  lines.push("");
  lines.push(shape.doc);
  lines.push("");
  lines.push(table(shape.fields));
}
process.stdout.write(`${lines.join("\n")}\n`);

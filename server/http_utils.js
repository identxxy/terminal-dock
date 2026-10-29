const { encodeBody } = require("./response_encoding");

function sendJson(response, statusCode, payload) {
  sendJsonWithHeaders(response, statusCode, payload);
}

function sendJsonWithHeaders(response, statusCode, payload, headers = {}) {
  const contentType = "application/json; charset=utf-8";
  const encoded = encodeBody(response.req, JSON.stringify(payload), contentType);
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    ...encoded.headers,
    ...headers
  });
  response.end(encoded.body);
}

function sendText(response, statusCode, payload, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType || "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(payload);
}

function sendBuffer(response, statusCode, buffer, contentType, headers = {}) {
  const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  response.writeHead(statusCode, {
    "Content-Type": contentType || "application/octet-stream",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(payload);
}

function sendStream(response, statusCode, stream, contentType, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  stream.on("error", (error) => response.destroy(error));
  stream.pipe(response);
}

async function parseRequestBody(request, options = {}) {
  const chunks = [];
  let totalBytes = 0;
  const maxBytes = options.maxBytes || 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (maxBytes && totalBytes > maxBytes) {
      throw new Error(`Request body is too large. Limit is ${Math.floor(maxBytes / 1024 / 1024)} MiB.`);
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Request body must be valid JSON.");
  }
}

// tmux ids start at 0 (%0, @0, $0); kitty ids start at 1.
function parsePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return number;
}

function parseOptionalPositiveInteger(value, name) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parsePositiveInteger(value, name);
}

function parseWindowId(value) {
  return parsePositiveInteger(value, "windowId");
}

function parseCreatePanelKind(value) {
  const kind = String(value || "window").trim().toLowerCase();
  if (!["window", "tab", "split"].includes(kind)) {
    throw new Error("kind must be one of: window, tab, split.");
  }
  return kind;
}

function parseScrollLines(value) {
  const lines = Number(value);
  if (!Number.isInteger(lines)) {
    throw new Error("lines must be an integer.");
  }
  return Math.max(-120, Math.min(120, lines));
}

function shouldUseSecureCookie(request) {
  const forced = process.env.KRD_COOKIE_SECURE;

  if (forced === "1") {
    return true;
  }

  if (forced === "0") {
    return false;
  }

  const forwardedProto = String(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  return forwardedProto === "https";
}

module.exports = {
  parseCreatePanelKind,
  parseOptionalPositiveInteger,
  parsePositiveInteger,
  parseRequestBody,
  parseScrollLines,
  parseWindowId,
  sendBuffer,
  sendJson,
  sendJsonWithHeaders,
  sendStream,
  sendText,
  shouldUseSecureCookie
};

const fsp = require("fs").promises;
const path = require("path");
const { createEtag, encodeBody, isFresh } = require("./response_encoding");
const { sendText } = require("./http_utils");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  // Served through the Browser proxy for local files: module scripts and
  // data files need their real types or the page refuses them.
  ".mjs": "application/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".ico": "image/x-icon"
};

// Static assets revalidate on every load ("no-cache") so updates show up immediately,
// but an unchanged file costs only a 304 instead of a full download.
function sendStaticBuffer(request, response, file, contentType) {
  const etag = createEtag(file);
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    ETag: etag,
    Vary: "Accept-Encoding"
  };

  if (isFresh(request, etag)) {
    response.writeHead(304, headers);
    response.end();
    return;
  }

  const encoded = encodeBody(request, file, contentType);
  response.writeHead(200, { ...headers, ...encoded.headers });
  response.end(encoded.body);
}

function createStaticServer(publicDir) {
  return async function serveStaticFile(request, requestPath, response) {
    const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
    const absolutePath = path.join(publicDir, normalizedPath);

    if (!absolutePath.startsWith(publicDir)) {
      sendText(response, 403, "Forbidden");
      return;
    }

    try {
      const file = await fsp.readFile(absolutePath);
      const ext = path.extname(absolutePath).toLowerCase();
      sendStaticBuffer(request, response, file, MIME_TYPES[ext] || "application/octet-stream");
    } catch (error) {
      // Unknown paths fall back to the app shell.
      try {
        const file = await fsp.readFile(path.join(publicDir, "index.html"));
        sendStaticBuffer(request, response, file, MIME_TYPES[".html"]);
      } catch (fallbackError) {
        sendText(response, 404, "Not found");
      }
    }
  };
}

module.exports = { MIME_TYPES, createStaticServer, sendStaticBuffer };

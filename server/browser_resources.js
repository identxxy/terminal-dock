const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { normalizeTransport } = require("./helper_runner");
const { isCssContentType, isHtmlContentType, parseProxyPath, rewriteCssResources, rewriteHtmlResources } = require("./url_proxy");
const { filePathFromLocalFileUrl, parseByteRange } = require("./preview_access");
const { sendBuffer, sendStream, sendText } = require("./http_utils");
const { MIME_TYPES } = require("./static_files");

const RESOURCE_MIME_TYPES = {
  ...MIME_TYPES,
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".ogg": "video/ogg",
  ".ogv": "video/ogg",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function decodeFetchedResource(data) {
  if (data.bodyBase64) {
    return Buffer.from(data.bodyBase64, "base64");
  }
  return Buffer.from(String(data.body || ""), data.encoding || "utf8");
}

// HTML and CSS get their references rewritten to the proxy; everything else
// passes through as bytes.
function transformFetchedResource(data, targetId, accessToken = "") {
  const contentType = data.contentType || "application/octet-stream";
  const finalUrl = data.finalUrl || data.url;
  const rawBuffer = decodeFetchedResource(data);
  const encoding = data.encoding || "utf8";

  if (isHtmlContentType(contentType)) {
    const html = typeof data.body === "string" ? data.body : rawBuffer.toString(encoding);
    return { buffer: Buffer.from(rewriteHtmlResources(html, finalUrl, targetId, { accessToken }), encoding), contentType };
  }

  if (isCssContentType(contentType)) {
    const css = typeof data.body === "string" ? data.body : rawBuffer.toString(encoding);
    return { buffer: Buffer.from(rewriteCssResources(css, finalUrl, targetId, { accessToken }), encoding), contentType };
  }

  return { buffer: rawBuffer, contentType };
}

function guessResourceContentType(filePath) {
  return RESOURCE_MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function browserResourceHeaders(data, url, extraHeaders = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, X-KRD-Final-URL, X-KRD-Truncated",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Timing-Allow-Origin": "*",
    "X-KRD-Final-URL": encodeURIComponent(data.finalUrl || data.url || url),
    "X-KRD-Truncated": data.truncated ? "1" : "0",
    ...extraHeaders
  };
}

// The proxied resource a request names, in either URL form. `download=1` on
// the query form asks for the file as the target serves it (no rewriting) with
// an attachment disposition, so the viewer's browser saves it.
function proxiedResourceFromRequest(requestUrl) {
  if (requestUrl.pathname === "/api/url-resource") {
    return {
      targetId: requestUrl.searchParams.get("targetId") || "",
      url: requestUrl.searchParams.get("url") || "",
      accessToken: requestUrl.searchParams.get("access") || "",
      download: requestUrl.searchParams.get("download") === "1"
    };
  }
  return parseProxyPath(requestUrl.pathname, requestUrl.search);
}

// The name the saved file gets: the URL's last path segment, or the host for a
// site root; HTML without an extension gets .html so it opens in a browser.
function downloadFileName(url, contentType = "") {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    return "download";
  }
  let name = "";
  try {
    name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
  } catch (error) {
    name = parsed.pathname.split("/").filter(Boolean).pop() || "";
  }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim() || parsed.hostname || "page";
  if (isHtmlContentType(contentType) && !/\.x?html?$/i.test(name)) {
    name += ".html";
  }
  return name;
}

function downloadHeaders(url, contentType = "") {
  const name = downloadFileName(url, contentType);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return { "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}` };
}

function sendRangeNotSatisfiable(response, size, data) {
  sendBuffer(response, 416, Buffer.alloc(0), "application/octet-stream", browserResourceHeaders(data, data.url, {
    "Accept-Ranges": "bytes",
    "Content-Range": `bytes */${size}`
  }));
}

// file:// on a local target is streamed straight from disk (ranges included)
// instead of round-tripping through the helper. Returns false when the helper
// should serve it instead: remote targets, directories, non-file URLs.
async function serveLocalFileResource(request, response, target, url, accessToken = "", options = {}) {
  if (normalizeTransport(target.transport) !== "local") {
    return false;
  }

  const filePath = filePathFromLocalFileUrl(url);
  if (!filePath) {
    return false;
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    sendText(response, 404, "File not found.");
    return true;
  }

  if (stat.isDirectory()) {
    // The helper renders directory listings for every transport.
    return false;
  }

  if (!stat.isFile()) {
    sendText(response, 403, "Only regular files can be previewed.");
    return true;
  }

  const contentType = guessResourceContentType(filePath);
  const data = { url, finalUrl: url, truncated: false };
  const commonHeaders = browserResourceHeaders(data, url, { "Accept-Ranges": "bytes" });

  if (options.download) {
    sendStream(response, 200, fs.createReadStream(filePath), contentType, {
      ...commonHeaders,
      ...downloadHeaders(url, contentType),
      "Content-Length": stat.size
    });
    return true;
  }

  const rangeHeader = request.headers.range || "";

  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, stat.size);
    if (!range) {
      sendRangeNotSatisfiable(response, stat.size, data);
      return true;
    }
    sendStream(response, 206, fs.createReadStream(filePath, range), contentType, {
      ...commonHeaders,
      "Content-Length": range.end - range.start + 1,
      "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`
    });
    return true;
  }

  if (isHtmlContentType(contentType) || isCssContentType(contentType)) {
    const rawBuffer = await fsp.readFile(filePath);
    const transformed = transformFetchedResource(
      { url, finalUrl: url, contentType, bodyBase64: rawBuffer.toString("base64"), body: rawBuffer.toString("utf8"), encoding: "utf8", truncated: false },
      target.id,
      accessToken
    );
    sendBuffer(response, 200, transformed.buffer, transformed.contentType, commonHeaders);
    return true;
  }

  sendStream(response, 200, fs.createReadStream(filePath), contentType, { ...commonHeaders, "Content-Length": stat.size });
  return true;
}

module.exports = {
  RESOURCE_MIME_TYPES,
  browserResourceHeaders,
  decodeFetchedResource,
  downloadFileName,
  downloadHeaders,
  guessResourceContentType,
  proxiedResourceFromRequest,
  serveLocalFileResource,
  transformFetchedResource
};

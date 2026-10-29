const crypto = require("crypto");
const { URL, fileURLToPath } = require("url");

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizePreviewAccessUrl(rawUrl) {
  const parsed = new URL(rawUrl);

  if (!["file:", "http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only file://, http://, and https:// URLs are supported.");
  }

  return parsed.href;
}

// A token covers the directory of the page it was issued for, so the page's
// relative resources load without a token each.
function previewAccessScopeForUrl(rawUrl) {
  const parsed = new URL(normalizePreviewAccessUrl(rawUrl));
  const pathname = parsed.pathname || "/";
  const prefixEnd = pathname.endsWith("/") ? pathname.length : pathname.lastIndexOf("/") + 1;
  parsed.pathname = pathname.slice(0, Math.max(1, prefixEnd));
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

// Signed, expiring tokens that let the Browser frame fetch proxied resources
// without the session cookie (the frame is an opaque origin).
function createPreviewAccess(options = {}) {
  const secret = options.secret || crypto.randomBytes(32);
  const ttlMs = options.ttlMs || 2 * 60 * 60 * 1000;
  const now = options.now || Date.now;

  function sign(payloadText) {
    return crypto.createHmac("sha256", secret).update(payloadText).digest("base64url");
  }

  function createToken(targetId, rawUrl) {
    const expiresAt = now() + ttlMs;
    const payload = { targetId: String(targetId || ""), urlPrefix: previewAccessScopeForUrl(rawUrl), expiresAt };
    const payloadText = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return {
      accessToken: `${payloadText}.${sign(payloadText)}`,
      expiresAt: new Date(expiresAt).toISOString(),
      urlPrefix: payload.urlPrefix
    };
  }

  function verifyToken(accessToken, targetId, rawUrl) {
    const [payloadText, signature, ...extra] = String(accessToken || "").split(".");

    if (!payloadText || !signature || extra.length || !safeEqualText(signature, sign(payloadText))) {
      return false;
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
    } catch (error) {
      return false;
    }

    if (
      payload.targetId !== String(targetId || "") ||
      !payload.urlPrefix ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt < now()
    ) {
      return false;
    }

    try {
      return normalizePreviewAccessUrl(rawUrl).startsWith(payload.urlPrefix);
    } catch (error) {
      return false;
    }
  }

  return { createToken, verifyToken };
}

function filePathFromLocalFileUrl(url) {
  const parsed = new URL(url);

  if (parsed.protocol !== "file:") {
    return "";
  }

  if (parsed.hostname && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    throw new Error("file:// URLs must point to the selected host.");
  }

  if (parsed.hostname === "127.0.0.1") {
    parsed.host = "";
  }

  return fileURLToPath(parsed);
}

function parseByteRange(rangeHeader, size) {
  const match = String(rangeHeader || "").match(/^bytes=(\d*)-(\d*)$/);

  if (!match || !Number.isSafeInteger(size) || size < 1) {
    return null;
  }

  const [, startText, endText] = match;
  let start;
  let end;

  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
}

module.exports = {
  createPreviewAccess,
  filePathFromLocalFileUrl,
  normalizePreviewAccessUrl,
  parseByteRange,
  previewAccessScopeForUrl
};

const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const crypto = require("crypto");
const { spawn } = require("child_process");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
const IMAGE_UPLOAD_DIR_ENV = "KRD_IMAGE_UPLOAD_DIR";
const DEFAULT_IMAGE_UPLOAD_SUBDIR = path.join("Pictures", "remote-deck");
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"]
]);
const ALLOWED_VIDEO_TYPES = new Map([
  ["video/mp4", ".mp4"],
  ["video/quicktime", ".mov"],
  ["video/webm", ".webm"],
  ["video/x-matroska", ".mkv"],
  ["video/x-m4v", ".m4v"]
]);
const ALLOWED_UPLOAD_TYPES = new Map([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function sanitizeFilename(value) {
  const basename = path.basename(String(value || "image"));
  const ext = path.extname(basename).toLowerCase().replace(/[^.\w]+/g, "");
  const stem = basename.slice(0, ext ? -ext.length : undefined) || "image";
  const cleanedStem = stem
    .normalize("NFKD")
    .replace(/[^\w .-]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return `${cleanedStem || "image"}${ext}`;
}

function safeAltText(fileName) {
  return sanitizeFilename(fileName).replace(/[\[\]\n\r]/g, "-");
}

function extensionForImage(mimeType, filename) {
  const normalizedType = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const mapped = ALLOWED_UPLOAD_TYPES.get(normalizedType);
  if (mapped) {
    return mapped;
  }

  const ext = path.extname(sanitizeFilename(filename)).toLowerCase();
  if ([...ALLOWED_UPLOAD_TYPES.values()].includes(ext)) {
    return ext;
  }

  throw new Error("Unsupported file type. Use PNG, JPEG, WebP, GIF, HEIC, HEIF, MP4, MOV, WebM, MKV, or M4V.");
}

function maxBytesForExtension(ext) {
  return [...ALLOWED_VIDEO_TYPES.values()].includes(ext) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

function createUploadName(fileName, mimeType) {
  const safeName = sanitizeFilename(fileName);
  const stem = safeName.replace(/\.[^.]+$/, "") || "image";
  const ext = extensionForImage(mimeType, safeName);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${nonce}-${stem}${ext}`;
}

// A plain Markdown link, not `![...]`: a leading exclamation mark switches
// Codex's composer into shell mode.
function createMarkdownImageReference(fileName, fileUrl) {
  return `[${safeAltText(fileName)}](${fileUrl})`;
}

function createComposerImageText({ text = "", files = [] }) {
  const trimmedText = String(text || "").trimEnd();
  const refs = files.map((file) => createMarkdownImageReference(file.fileName, file.fileUrl)).join("\n");
  return trimmedText ? `${trimmedText}\n\n${refs}` : refs;
}

function getUploadDate() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function expandHomePath(value, homeDir = os.homedir()) {
  const raw = String(value || "").trim();
  if (raw === "~") {
    return homeDir;
  }
  if (raw.startsWith("~/")) {
    return path.join(homeDir, raw.slice(2));
  }
  return raw;
}

function getLocalUploadRoot() {
  const configured = process.env[IMAGE_UPLOAD_DIR_ENV] || "";
  const expanded = expandHomePath(configured);
  return expanded ? path.resolve(expanded) : path.join(os.homedir(), DEFAULT_IMAGE_UPLOAD_SUBDIR);
}

// Uploads arrive as raw chunks of at most UPLOAD_CHUNK_BYTES, so no single
// request comes near a proxy's body cap (Cloudflare: 100 MB) or a timeout.
// Each chunk is appended to the destination file on the target as it lands;
// a send then names finished uploads by id.
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_TTL_MS = 60 * 60 * 1000;

function runSsh(target, command, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [target.sshTarget, command], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `ssh upload exited with code ${code}.`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(input || "");
  });
}

const SSH_CREATE_SCRIPT = `
import json
import os
import sys
from urllib.parse import quote

upload_root = os.environ.get("KRD_IMAGE_UPLOAD_DIR", "").strip()
if not upload_root:
    upload_root = os.path.join(os.path.expanduser("~"), "Pictures", "remote-deck")
else:
    upload_root = os.path.expanduser(upload_root)
root = os.path.join(upload_root, os.environ.get("KRD_UPLOAD_DATE", ""))
os.makedirs(root, mode=0o700, exist_ok=True)
path = os.path.join(root, sys.argv[1])
with open(path, "wb"):
    pass
os.chmod(path, 0o600)
print(json.dumps({"path": path, "fileUrl": "file://" + quote(path)}))
`.trim();

async function createDestination(target, uploadName) {
  if (target.transport === "ssh") {
    const envAssignments = [`KRD_UPLOAD_DATE=${shellQuote(getUploadDate())}`];
    if (process.env[IMAGE_UPLOAD_DIR_ENV]) {
      envAssignments.push(`${IMAGE_UPLOAD_DIR_ENV}=${shellQuote(process.env[IMAGE_UPLOAD_DIR_ENV])}`);
    }
    const stdout = await runSsh(target, [...envAssignments, "python3", "-c", shellQuote(SSH_CREATE_SCRIPT), shellQuote(uploadName)].join(" "));
    try {
      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Unexpected ssh upload response: ${stdout.trim() || "<empty>"}`);
    }
  }

  const dir = path.join(getLocalUploadRoot(), getUploadDate());
  const filePath = path.join(dir, uploadName);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  await fsp.writeFile(filePath, "", { mode: 0o600 });
  return { path: filePath, fileUrl: pathToFileURL(filePath).href };
}

function appendToDestination(target, filePath, buffer) {
  if (target.transport === "ssh") {
    return runSsh(target, `cat >> ${shellQuote(filePath)}`, buffer);
  }
  return fsp.appendFile(filePath, buffer);
}

function removeDestination(target, filePath) {
  if (target.transport === "ssh") {
    return runSsh(target, `rm -f ${shellQuote(filePath)}`);
  }
  return fsp.rm(filePath, { force: true });
}

function uploadError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode }, extra);
}

function createUploadStore({ ttlMs = UPLOAD_TTL_MS } = {}) {
  const uploads = new Map();

  function sweep() {
    const now = Date.now();
    for (const [id, upload] of uploads) {
      if (now - upload.touchedAt > ttlMs) {
        uploads.delete(id);
        removeDestination(upload.target, upload.path).catch(() => {});
      }
    }
  }

  function get(id) {
    const upload = uploads.get(String(id || ""));
    if (!upload) {
      throw uploadError("Upload not found or expired.", 404);
    }
    return upload;
  }

  async function start(target, { fileName, mimeType, size }) {
    sweep();
    const safeName = sanitizeFilename(fileName || "image");
    const type = String(mimeType || "").split(";")[0].trim().toLowerCase();
    const maxBytes = maxBytesForExtension(extensionForImage(type, safeName));
    const total = Number(size);
    if (!Number.isInteger(total) || total <= 0) {
      throw new Error("Upload size must be a positive integer.");
    }
    if (total > maxBytes) {
      throw new Error(`File is too large. Limit is ${Math.floor(maxBytes / 1024 / 1024)} MiB.`);
    }
    const uploadName = createUploadName(safeName, type);
    const destination = await createDestination(target, uploadName);
    const id = crypto.randomBytes(12).toString("hex");
    uploads.set(id, {
      id,
      target,
      fileName: safeName,
      mimeType: type,
      size: total,
      received: 0,
      busy: false,
      path: destination.path,
      fileUrl: destination.fileUrl,
      touchedAt: Date.now()
    });
    return { uploadId: id, chunkBytes: UPLOAD_CHUNK_BYTES };
  }

  // A retried chunk the server already holds is acknowledged without writing,
  // so a client that lost a response can resend from its last confirmed offset.
  async function appendChunk(id, offset, buffer) {
    const upload = get(id);
    if (upload.busy) {
      throw uploadError("A chunk for this upload is still being written.", 409, { received: upload.received });
    }
    if (offset + buffer.length <= upload.received) {
      return { received: upload.received, size: upload.size };
    }
    if (offset !== upload.received) {
      throw uploadError(`Expected offset ${upload.received}.`, 409, { received: upload.received });
    }
    if (offset + buffer.length > upload.size) {
      throw new Error("Chunk runs past the declared size.");
    }
    upload.busy = true;
    try {
      await appendToDestination(upload.target, upload.path, buffer);
      upload.received += buffer.length;
      upload.touchedAt = Date.now();
    } finally {
      upload.busy = false;
    }
    return { received: upload.received, size: upload.size };
  }

  async function cancel(id) {
    const upload = uploads.get(String(id || ""));
    if (!upload) {
      return;
    }
    uploads.delete(upload.id);
    await removeDestination(upload.target, upload.path).catch(() => {});
  }

  // Finished uploads for one send. They stay in the store until `forget`, so a
  // send whose text never reached the pane can be retried.
  function collect(ids, targetId) {
    const list = ids.map(get);
    for (const upload of list) {
      if (upload.target.id !== targetId) {
        throw new Error("Upload belongs to a different target.");
      }
      if (upload.received !== upload.size) {
        throw uploadError(`${upload.fileName} is not fully uploaded.`, 409);
      }
    }
    return list.map(({ fileName, mimeType, size, path: filePath, fileUrl }) => ({ fileName, mimeType, byteLength: size, path: filePath, fileUrl }));
  }

  function forget(ids) {
    ids.forEach((id) => uploads.delete(String(id || "")));
  }

  return { start, appendChunk, cancel, collect, forget };
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  DEFAULT_IMAGE_UPLOAD_SUBDIR,
  IMAGE_UPLOAD_DIR_ENV,
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_FILES,
  MAX_VIDEO_BYTES,
  UPLOAD_CHUNK_BYTES,
  createComposerImageText,
  createMarkdownImageReference,
  createUploadStore,
  getLocalUploadRoot,
  sanitizeFilename
};

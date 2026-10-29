import assert from "node:assert/strict";
import test from "node:test";

import {
  createPreviewAccess,
  filePathFromLocalFileUrl,
  parseByteRange,
  previewAccessScopeForUrl
} from "../server/preview_access.js";

test("a token covers the page's directory on its target until it expires", () => {
  let now = 1_000_000;
  const access = createPreviewAccess({ ttlMs: 1000, now: () => now });
  const token = access.createToken("gpu", "file:///tmp/report/index.html?x=1#top");
  assert.equal(token.urlPrefix, "file:///tmp/report/");
  assert.equal(access.verifyToken(token.accessToken, "gpu", "file:///tmp/report/data.json"), true);
  assert.equal(access.verifyToken(token.accessToken, "gpu", "file:///tmp/other/data.json"), false);
  assert.equal(access.verifyToken(token.accessToken, "other", "file:///tmp/report/data.json"), false);
  assert.equal(access.verifyToken(`${token.accessToken}x`, "gpu", "file:///tmp/report/data.json"), false);
  assert.equal(access.verifyToken(token.accessToken, "gpu", "ftp://tmp/report"), false);
  now += 1001;
  assert.equal(access.verifyToken(token.accessToken, "gpu", "file:///tmp/report/data.json"), false);
  assert.throws(() => access.createToken("gpu", "ftp://x/y"), /Only file/);
});

test("previewAccessScopeForUrl keeps directory URLs whole", () => {
  assert.equal(previewAccessScopeForUrl("http://10.0.0.2:8000/reports/"), "http://10.0.0.2:8000/reports/");
  assert.equal(previewAccessScopeForUrl("http://10.0.0.2:8000"), "http://10.0.0.2:8000/");
});

test("parseByteRange handles open, suffix and invalid ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange("bytes=0-5000", 1000), { start: 0, end: 999 });
  assert.equal(parseByteRange("bytes=1000-", 1000), null);
  assert.equal(parseByteRange("bytes=-", 1000), null);
  assert.equal(parseByteRange("items=0-1", 1000), null);
  assert.equal(parseByteRange("bytes=0-1", 0), null);
});

test("filePathFromLocalFileUrl accepts localhost hosts only", () => {
  assert.equal(filePathFromLocalFileUrl("file:///tmp/a b.txt"), "/tmp/a b.txt");
  assert.equal(filePathFromLocalFileUrl("file://localhost/tmp/x"), "/tmp/x");
  assert.equal(filePathFromLocalFileUrl("file://127.0.0.1/tmp/x"), "/tmp/x");
  assert.equal(filePathFromLocalFileUrl("http://example.com/x"), "");
  assert.throws(() => filePathFromLocalFileUrl("file://gpu-box/tmp/x"), /selected host/);
});

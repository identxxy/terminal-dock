import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import imageUpload from "../server/image_upload.js";

const {
  createComposerImageText,
  createMarkdownImageReference,
  createUploadStore,
  getLocalUploadRoot,
  IMAGE_UPLOAD_DIR_ENV,
  sanitizeFilename
} = imageUpload;

test("image upload helpers sanitize names and create markdown references", () => {
  assert.equal(sanitizeFilename("../my plot [draft].png"), "my-plot-draft.png");
  assert.equal(
    createMarkdownImageReference("my plot [draft].png", "file:///tmp/my%20plot.png"),
    "[my-plot-draft.png](file:///tmp/my%20plot.png)"
  );
  assert.equal(
    createComposerImageText({
      text: "please inspect this",
      files: [{ fileName: "plot.png", fileUrl: "file:///tmp/plot.png" }]
    }),
    "please inspect this\n\n[plot.png](file:///tmp/plot.png)"
  );
  assert.equal(
    createComposerImageText({
      files: [
        { fileName: "a.png", fileUrl: "file:///tmp/a.png" },
        { fileName: "b.mp4", fileUrl: "file:///tmp/b.mp4" }
      ]
    }),
    "[a.png](file:///tmp/a.png)\n[b.mp4](file:///tmp/b.mp4)"
  );
});

test("local image uploads use the configured user-visible root", async (t) => {
  const previousRoot = process.env[IMAGE_UPLOAD_DIR_ENV];
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kitty-remote-deck-upload-"));
  const uploadRoot = path.join(tempRoot, "Pictures", "remote-deck");

  t.after(async () => {
    if (previousRoot === undefined) {
      delete process.env[IMAGE_UPLOAD_DIR_ENV];
    } else {
      process.env[IMAGE_UPLOAD_DIR_ENV] = previousRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  process.env[IMAGE_UPLOAD_DIR_ENV] = uploadRoot;

  assert.equal(getLocalUploadRoot(), uploadRoot);

  const store = createUploadStore();
  const target = { id: "local", transport: "local" };
  await assert.rejects(store.start(target, { fileName: "big.png", mimeType: "image/png", size: 9 * 1024 * 1024 }), /too large/);
  const { uploadId } = await store.start(target, { fileName: "../screen shot.png", mimeType: "image/png", size: 9 });

  assert.deepEqual(await store.appendChunk(uploadId, 0, Buffer.from("png-")), { received: 4, size: 9 });
  // A resent chunk the server already holds is acknowledged without writing it twice.
  assert.deepEqual(await store.appendChunk(uploadId, 0, Buffer.from("png-")), { received: 4, size: 9 });
  await assert.rejects(store.appendChunk(uploadId, 6, Buffer.from("tes")), (error) => error.statusCode === 409 && error.received === 4);
  assert.throws(() => store.collect([uploadId], "local"), /not fully uploaded/);
  await store.appendChunk(uploadId, 4, Buffer.from("bytes"));
  assert.throws(() => store.collect([uploadId], "other"), /different target/);

  const [result] = store.collect([uploadId], "local");
  store.forget([uploadId]);
  assert.throws(() => store.collect([uploadId], "local"), /not found/);
  assert.ok(result.path.startsWith(`${uploadRoot}${path.sep}`));
  assert.match(path.basename(result.path), /^\d{14}-[a-z0-9]{6}-screen-shot\.png$/);
  assert.equal(await fs.readFile(result.path, "utf8"), "png-bytes");
  assert.ok(result.fileUrl.startsWith("file://"));

  const cancelled = await store.start(target, { fileName: "clip.mp4", mimeType: "video/mp4", size: 50 * 1024 * 1024 });
  await store.appendChunk(cancelled.uploadId, 0, Buffer.from("partial"));
  await store.cancel(cancelled.uploadId);
  assert.deepEqual((await fs.readdir(path.dirname(result.path))).length, 1);
});

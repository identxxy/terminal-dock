// Per-pane message queue for attachments. Each send becomes a job on its
// pane's queue: files go up in raw chunks (resuming from the last confirmed
// offset after a failure), then one /api/send-image types the text and links.
// Panes upload independently; within a pane, jobs and any text sent behind
// them reach the pane in order. The composer stays free while jobs run.
// Backoff 1, 2, 4, 8, then 15 s: about 75 s of lost signal before a job
// stops and offers Retry (which resumes from the last confirmed offset).
const UPLOAD_CHUNK_RETRIES = 8;

const uploadQueues = new Map();

const uploadWorkers = new Set();

let uploadJobSerial = 0;

function paneQueueKey(pane) {
  return `${pane.targetId}|${pane.socket || ""}|${pane.windowId}`;
}

function paneUploadQueue(pane) {
  return uploadQueues.get(paneQueueKey(pane)) || [];
}

function hasPendingUploads(pane) {
  return paneUploadQueue(pane).length > 0;
}

function enqueueUploadMessage(pane, { text, appendNewline, attachments }) {
  const key = paneQueueKey(pane);
  const queue = uploadQueues.get(key) || [];
  queue.push({
    id: ++uploadJobSerial,
    pane,
    text,
    appendNewline: Boolean(appendNewline),
    files: attachments.map((attachment) => ({
      file: attachment.file,
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      uploadId: "",
      received: 0,
      inFlight: 0
    })),
    status: "queued",
    error: "",
    xhr: null,
    cancelled: false
  });
  uploadQueues.set(key, queue);
  renderUploadQueue();
  runUploadQueue(key);
}

function uploadChunk(job, item, chunk) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    job.xhr = xhr;
    xhr.open("PUT", `/api/uploads/chunk?uploadId=${encodeURIComponent(item.uploadId)}&offset=${item.received}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.addEventListener("progress", (event) => {
      item.inFlight = event.loaded;
      renderUploadQueue();
    });
    xhr.addEventListener("load", () => {
      job.xhr = null;
      item.inFlight = 0;
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}");
      } catch (error) {
        // Proxies answer some failures (413, 502) with HTML.
      }
      if (xhr.status === 401) {
        setAuthState(false);
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }
      reject(Object.assign(new Error(payload.error || `Upload failed (HTTP ${xhr.status}).`), { status: xhr.status, payload }));
    });
    xhr.addEventListener("error", () => {
      job.xhr = null;
      item.inFlight = 0;
      reject(new Error("Network error while uploading."));
    });
    xhr.addEventListener("abort", () => {
      job.xhr = null;
      item.inFlight = 0;
      reject(Object.assign(new Error("Upload cancelled."), { cancelled: true }));
    });
    xhr.send(chunk);
  });
}

async function uploadJobFile(job, item) {
  let failures = 0;
  while (item.received < item.size || !item.uploadId) {
    if (job.cancelled) {
      throw Object.assign(new Error("Upload cancelled."), { cancelled: true });
    }
    try {
      if (!item.uploadId) {
        const started = await apiFetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId: job.pane.targetId, fileName: item.name, mimeType: item.type, size: item.size })
        });
        item.uploadId = started.uploadId;
        item.chunkBytes = started.chunkBytes;
        item.received = 0;
        continue;
      }
      const end = Math.min(item.size, item.received + item.chunkBytes);
      const data = await uploadChunk(job, item, item.file.slice(item.received, end));
      item.received = data.received;
      failures = 0;
      renderUploadQueue();
    } catch (error) {
      if (error.cancelled || error.status === 401 || error.status === 400) {
        throw error;
      }
      if (error.status === 409 && typeof error.payload?.received === "number") {
        // The server holds a different amount than we thought: resume there.
        item.received = error.payload.received;
        continue;
      }
      if (error.status === 404) {
        // Expired on the server: start this file again.
        item.uploadId = "";
        continue;
      }
      failures += 1;
      if (failures > UPLOAD_CHUNK_RETRIES) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 1000 * 2 ** (failures - 1))));
    }
  }
}

async function runUploadJob(job) {
  job.status = "uploading";
  job.error = "";
  renderUploadQueue();
  for (const item of job.files) {
    await uploadJobFile(job, item);
  }
  job.status = "sending";
  renderUploadQueue();
  const target = { targetId: job.pane.targetId, socket: job.pane.socket, windowId: job.pane.windowId };
  if (job.files.length) {
    await apiFetch("/api/send-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...target, text: job.text, uploadIds: job.files.map((item) => item.uploadId), appendNewline: job.appendNewline })
    });
  } else {
    await apiFetch("/api/send-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...target, text: job.text, appendNewline: job.appendNewline })
    });
  }
}

async function runUploadQueue(key) {
  if (uploadWorkers.has(key)) {
    return;
  }
  uploadWorkers.add(key);
  try {
    for (;;) {
      const job = uploadQueues.get(key)?.[0];
      if (!job || job.status === "failed") {
        break;
      }
      try {
        await runUploadJob(job);
        // Remove by identity: the job may have been discarded mid-send.
        removeUploadJob(key, job);
        setStatus(`${uploadJobLabel(job)} sent to pane #${job.pane.windowId}.`, "success");
        if (isPaneStillSelected(job.pane)) {
          noteScreenActivity();
          refreshScreen({ scrollToBottom: true }).catch(() => {});
        }
      } catch (error) {
        if (job.cancelled) {
          continue;
        }
        job.status = "failed";
        job.error = error.message;
        setStatus(`${uploadJobLabel(job)}: ${error.message}`, "danger");
      }
      renderUploadQueue();
    }
  } finally {
    uploadWorkers.delete(key);
    renderUploadQueue();
  }
}

function removeUploadJob(key, job) {
  const queue = uploadQueues.get(key) || [];
  const index = queue.indexOf(job);
  if (index >= 0) {
    queue.splice(index, 1);
  }
  if (!queue.length) {
    uploadQueues.delete(key);
  }
}

function retryUploadJob(key, jobId) {
  const job = (uploadQueues.get(key) || []).find((item) => item.id === jobId);
  if (job?.status === "failed") {
    job.status = "queued";
    renderUploadQueue();
    runUploadQueue(key);
  }
}

function discardUploadJob(key, jobId) {
  const job = (uploadQueues.get(key) || []).find((item) => item.id === jobId);
  if (!job) {
    return;
  }
  removeUploadJob(key, job);
  job.cancelled = true;
  job.xhr?.abort();
  job.files.filter((item) => item.uploadId).forEach((item) => {
    apiFetch(`/api/uploads?uploadId=${encodeURIComponent(item.uploadId)}`, { method: "DELETE" }).catch(() => {});
  });
  renderUploadQueue();
  // A failed head blocked the queue; the next job can go now.
  runUploadQueue(key);
}

function uploadJobLabel(job) {
  if (!job.files.length) {
    return "Text";
  }
  return job.files.length === 1 ? job.files[0].name : `${job.files.length} files`;
}

function uploadJobProgress(job) {
  const total = job.files.reduce((sum, item) => sum + item.size, 0);
  const done = job.files.reduce((sum, item) => sum + item.received + item.inFlight, 0);
  const percent = total ? Math.min(100, Math.floor((done / total) * 100)) : 100;
  const info = job.status === "failed"
    ? job.error
    : job.status === "sending"
      ? "Sending to pane…"
      : job.status === "queued"
        ? "Waiting"
        : `${formatBytes(done)} / ${formatBytes(total)} · ${percent}%`;
  return { percent, info };
}

function createUploadJobRow(key, job) {
  const row = document.createElement("div");
  row.className = "upload-job";
  row.dataset.jobId = String(job.id);
  row.dataset.status = job.status;

  const head = document.createElement("div");
  head.className = "upload-job-head";
  const name = document.createElement("strong");
  name.textContent = uploadJobLabel(job);
  const info = document.createElement("span");
  info.className = "upload-job-info";
  head.append(name, info);

  const actions = document.createElement("div");
  actions.className = "upload-job-actions";
  if (job.status === "failed") {
    const retry = document.createElement("button");
    retry.className = "ghost-button";
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => retryUploadJob(key, job.id));
    actions.appendChild(retry);
  }
  const discard = document.createElement("button");
  discard.className = "icon-button";
  discard.type = "button";
  discard.textContent = "×";
  discard.title = "Cancel this message";
  discard.setAttribute("aria-label", `Cancel ${uploadJobLabel(job)}`);
  discard.addEventListener("click", () => discardUploadJob(key, job.id));
  actions.appendChild(discard);
  head.appendChild(actions);

  const bar = document.createElement("div");
  bar.className = "upload-job-bar";
  bar.appendChild(document.createElement("span"));

  row.append(head, bar);
  return row;
}

// Rows are reused while a job keeps its status, so progress updates never
// replace a button the user is pressing.
function renderUploadQueue() {
  const container = elements.uploadQueue;
  const pane = captureSelectedPane();
  const key = paneQueueKey(pane);
  const jobs = state.selectedWindowId === null ? [] : paneUploadQueue(pane);
  const elsewhere = [...uploadQueues.entries()].filter(([otherKey]) => otherKey !== key).reduce((sum, [, queue]) => sum + queue.length, 0);
  container.hidden = !jobs.length && !elsewhere;
  const existing = new Map([...container.querySelectorAll(".upload-job")].map((row) => [row.dataset.jobId, row]));
  const rows = jobs.map((job) => {
    let row = existing.get(String(job.id));
    if (!row || row.dataset.status !== job.status || row.dataset.queueKey !== key) {
      row = createUploadJobRow(key, job);
      row.dataset.queueKey = key;
    }
    const { percent, info } = uploadJobProgress(job);
    row.querySelector(".upload-job-info").textContent = info;
    row.querySelector(".upload-job-bar span").style.width = `${percent}%`;
    return row;
  });
  let note = container.querySelector(".upload-queue-elsewhere");
  if (elsewhere) {
    note = note || document.createElement("p");
    note.className = "upload-queue-elsewhere";
    note.textContent = `${elsewhere} message${elsewhere === 1 ? "" : "s"} uploading to other panes`;
    rows.push(note);
  }
  rows.forEach((node, index) => {
    if (container.children[index] !== node) {
      container.insertBefore(node, container.children[index] || null);
    }
  });
  while (container.children.length > rows.length) {
    container.lastElementChild.remove();
  }
}

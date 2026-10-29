const http = require("http");
const fsp = require("fs").promises;
const path = require("path");
const { URL } = require("url");
const { authenticateSession, createAuthManager } = require("./auth");
const { runHelperAction } = require("./helper_runner");
const { WatcherRegistry } = require("./tmux_watcher");
const { createLayoutStore } = require("./layouts");
const { createReportStore } = require("./reports");
const { createTargetStore } = require("./targets");
const { createScreenCache } = require("./screen_cache");
const { createPreviewAccess } = require("./preview_access");
const { proxiedResourceFromRequest } = require("./browser_resources");
const { createStaticServer } = require("./static_files");
const { createApiHandler } = require("./routes");
const { MAX_IMAGE_BYTES } = require("./image_upload");

const ROOT_DIR = path.resolve(__dirname, "..");

// Everything the routes need, built once per server. Tests pass their own
// data directory and a stub `runHelper` instead of the Python helper.
async function createContext(options = {}) {
  const dataDir = options.dataDir || path.join(ROOT_DIR, "data");
  const tmpDir = options.tmpDir || path.join(ROOT_DIR, "tmp");
  const config = {
    host: options.host || "127.0.0.1",
    port: Number(options.port || 0),
    rootDir: ROOT_DIR,
    publicDir: path.join(ROOT_DIR, "public"),
    clientDebugLogFile: path.join(tmpDir, "client-debug.log"),
    maxImageRequestBytes: Math.ceil(MAX_IMAGE_BYTES * 1.6)
  };
  const authManager = createAuthManager(options.authFile || path.join(dataDir, "auth.json"));
  const targetStore = createTargetStore(path.join(dataDir, "targets.json"));
  await targetStore.ensure();
  await authManager.ensure();

  const helperSource = options.helperSource ?? (await fsp.readFile(path.join(ROOT_DIR, "server", "remote_helper.py"), "utf8"));
  const runHelper = options.runHelper || ((target, action, payload, timeoutMs) =>
    runHelperAction(target, action, payload, { cwd: ROOT_DIR, helperSource, timeoutMs: timeoutMs || 20000 }));
  const previewAccess = createPreviewAccess({ ttlMs: options.previewAccessTtlMs });

  return {
    config,
    authManager,
    authenticate: (request) => authenticateSession(authManager, request.headers.cookie || ""),
    targetStore,
    layoutStore: createLayoutStore(path.join(dataDir, "layouts.json")),
    reportStore: createReportStore(path.join(dataDir, "reports.json")),
    runHelper,
    previewAccess,
    hasPreviewResourceAccess: (requestUrl) => {
      const resource = proxiedResourceFromRequest(requestUrl);
      return Boolean(resource) && previewAccess.verifyToken(resource.accessToken, resource.targetId, resource.url);
    },
    screenCache: createScreenCache(),
    scrollOffsets: new Map(),
    watcherRegistry: new WatcherRegistry()
  };
}

async function createApp(options = {}) {
  const context = await createContext(options);
  const handleApi = createApiHandler(context);
  const serveStaticFile = createStaticServer(context.config.publicDir);

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    // /p/ carries proxied Browser resources (see server/url_proxy.js).
    if (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.startsWith("/p/")) {
      await handleApi(request, response, requestUrl);
      return;
    }
    await serveStaticFile(request, requestUrl.pathname, response);
  });

  function listen() {
    return new Promise((resolve) => {
      server.listen(context.config.port, context.config.host, () => {
        context.config.port = server.address().port;
        resolve(server.address());
      });
    });
  }

  function close() {
    context.watcherRegistry.closeAll();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, context, listen, close };
}

module.exports = { createApp, createContext };

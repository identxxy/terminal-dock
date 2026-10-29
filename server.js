const path = require("path");
const { createApp } = require("./server/app");

const PORT = Number(process.env.PORT || 3040);
const HOST = process.env.HOST || process.env.BIND_HOST || "127.0.0.1";

async function main() {
  const app = await createApp({
    host: HOST,
    port: PORT,
    authFile: process.env.KRD_AUTH_FILE || path.join(__dirname, "data", "auth.json"),
    previewAccessTtlMs: Number(process.env.KRD_PREVIEW_ACCESS_TTL_MS || 2 * 60 * 60 * 1000)
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      app.context.watcherRegistry.closeAll();
      process.exit(0);
    });
  }

  await app.listen();
  console.log(`Terminal Dock listening on http://${HOST}:${app.context.config.port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

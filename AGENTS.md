# AGENTS.md

This project is Terminal Dock, a local web app that drives GUI `kitty` sessions (visible on the host's display) or headless `tmux` servers from a browser, on the same machine or over SSH.

## Project root

Work from the repository root:

```text
terminal-dock
```

## Quick start

```bash
npm start
```

Then open:

```text
http://localhost:3040
```

## Architecture map (read this first)

One Node process, no build step, no runtime dependencies. Three layers:

1. **Python helper** `server/remote_helper.py`: the only code that touches a terminal. It is one file because the server streams it to the target over `python3 -` (locally or through `ssh`), one process per action, JSON in/out. `PAYLOAD["backend"]` picks an action table from `BACKENDS` at the bottom of the file; `SHARED_ACTIONS` (URL fetches) work on any host. Every backend answers the same action names (`list_sessions`, `get_screen`, `scroll_window`, `send_text`, `send_key`, `create_panel`, `close_panel`, ...) with the same result shapes; tmux additionally has `describe_window`, `resize_window`, `toggle_zoom`. The session tree always has kitty's shape (OS window > tab > window); tmux maps session > window > pane onto it and `labels` rename the levels in the UI.
2. **Node server** (`server.js` is a 30-line entry; everything is under `server/`):
   - `server/app.js`: `createApp(options)` builds the context (stores, auth, `runHelper`, caches) and the HTTP server. Tests pass `dataDir` and a stub `runHelper` to run the real API without Python.
   - `server/routes/index.js`: the route table. A route is `{ method, path | match(url), auth, handler(ctx, req, res, url) }`; `auth` is `none`, `session` (device cookie) or `resource` (cookie or a signed preview token). Add an endpoint by adding a route to the matching file: `system`, `auth`, `targets`, `stores` (reports, layouts), `browser` (preview proxy), `panes` (everything that runs a helper action; `paneAction()` is the one-liner form).
   - Stores: `targets.js`, `layouts.js`, `reports.js` (JSON files under `data/`, serialized writes), `auth.js` (device tokens, session cookies).
   - Terminal plumbing: `helper_runner.js` (spawn the helper locally or over ssh), `tmux_watcher.js` (control-mode clients that feed `GET /api/events`), `events.js` (the SSE handler), `screen_cache.js` (line deltas for `/api/screen?since=`).
   - Browser proxy: `url_proxy.js` (HTML/CSS rewriting, `/p/<target>/<token>/...` paths), `preview_access.js` (signed tokens, byte ranges), `browser_resources.js` (serving fetched or local files).
   - `http_utils.js` (send*/parse* helpers), `static_files.js`, `response_encoding.js` (gzip, ETag), `image_upload.js`.
3. **Browser client** `public/`: classic scripts sharing one global scope, no bundler. `index.html` loads `modules/*.js` (pure helpers, each a `window.KRD*` object that is also `require()`-able from tests) and then `app/*.js` in order; `app/core.js` holds constants, `state`, `elements` and the helpers everything uses, `app/main.js` wires events (`bind<Domain>Events()` per file) and runs `init()`. The other files are one domain each: `debug`, `preferences`, `mobile`, `shell`, `browser`, `screen`, `composer`, `targets`, `sessions`, `views` (split views), `layouts`, `live` (SSE + polling). `tests/app_source.test.mjs` fails on a duplicate top-level name across files and on a load-order mistake in `index.html`.

Extension points, in the order they are likely to be needed:

- **New terminal backend**: a new action table in `remote_helper.py` registered in `BACKENDS`, `normalizeBackend()` in `server/helper_runner.js`, `BACKEND_DEFAULTS` in `app/core.js` (labels, socket placeholders). Live updates (`/api/events`) are tmux-only; other backends poll.
- **New API endpoint**: one route object in `server/routes/*.js`; the context gives it `targetStore`, `runHelper`, the stores and caches. Cover it in `tests/api.test.mjs` with the stub helper.
- **New sidebar view or page section**: markup in `index.html`, a `show<View>Btn` in the activity bar, the view name in `SIDEBAR_VIEW_SET`/`MOBILE_SCREEN_SET`, rendering in a new `app/<view>.js` with its own `bind<View>Events()` called from `attachEvents()` in `app/main.js`, and a `<script>` tag after `core.js`.
- **Terminal text rendering**: `modules/ansi-utils.js` (SGR to spans) and `modules/terminal-lines.js` (one block per line, incremental redraw); `renderTerminalText()` in `app/screen.js` is the hook between them and the output element.
- **Pure logic** belongs in `public/modules/` or `server/` with a unit test; `app/*.js` should stay DOM/state glue.

Conventions that matter:

- tmux ids start at 0 (`%0`, `@0`, `$0`): test pane ids with `hasSelectedWindow()` / `!== null`, never for truthiness.
- Browser-storage keys, the `KRD_*` environment variables, the `krd_` token prefix and the `kitty-remote-deck-browser` postMessage source keep their pre-1.0 names on purpose; renaming them signs every device out.
- `index.html` cache keys (`?v=`) must change whenever a script or stylesheet changes, or phones keep the old file.
- `data/` is gitignored and holds secrets (token hashes). Never copy it into scratch environments; create scratch tokens with `scripts/auth-admin.js` against a scratch `KRD_AUTH_FILE`.
- Never send keys into a pane you do not own; UI checks run against a throwaway tmux session (`scripts/ui-smoke.mjs`, `DECK_SESSION`).

## Expected workflow

1. Start the local server from this directory.
2. Use the seeded `Local Kitty` target for same-machine kitty, or create an SSH target in Connect.
3. Local targets call the Python helper directly; SSH targets stream the helper to the target host.
   Each target also has a `backend` (`kitty` or `tmux`). tmux pane ids start at `%0`, so ids must be checked with `hasSelectedWindow()` / `!== null`, never for truthiness.
4. `Enter` in the composer:
   - sends text if the textbox has content
   - sends `Enter` if the textbox is empty
5. `Shift+Enter` inserts a newline in the composer. Arrow keys and `Esc` on an empty composer are sent to the pane (`getPassthroughKeyOnKeydown` in `composer-utils.js`).
6. Terminal `http://`, `https://`, and `file://` URLs are clickable and open in the right-side Browser drawer. Browser address input, forward/back history, in-frame links, and GET forms are fetched through the active target and proxied through `/api/url-resource`.

## Verification

Useful checks:

```bash
npm test                      # unit tests + the HTTP API with a stub helper
for f in server.js server/*.js server/routes/*.js public/app/*.js; do node --check "$f"; done
python3 -m py_compile server/remote_helper.py
npm run smoke:ui              # real Chrome against a running deck; see README
```

Useful API smoke test:

```bash
curl http://localhost:3040/api/health
```

## Deploy / sync

Sync to the remote playground directory with:

```bash
rsync -av --exclude data --exclude tmp ./ user@example-host:/path/to/terminal-dock/
```

If you want saved local targets or logs copied too, remove the excludes deliberately.

# Changelog

## Unreleased

## v1.2.0

- `td cat` no longer shows Claude Code's suggested next prompt (dim text in the input box) as if the user had typed it.
- Harbor: lend a Claude Code pane to another person's agent through a temporary token (default level read, 3 hours).
  - `scripts/harbor-admin.js grant/ls/revoke/log` manages tokens.
  - `/harbor/v1` is the guest agent's Bearer API: guide, submit, long-poll.
  - Requests are queued per token and delivered only while the agent is idle.
  - `scripts/td-hook` injects the rules, allows only Read, Grep and Glob inside the shared folders (never secrets or dotfile configs), and returns the agent's final message as the reply.
  - Each token has a hash-chained ledger in `data/harbor/`. The ledger and the token record are deleted 30 days after the token expires or is revoked (`--keep`).
  - A Harbor tab in the dock lists tokens, their terminal and requests, with Approve/Deny for `approve` mode, Revoke, and opening the pane.
- `scripts/td-hook`: Claude Code hook that records each pane's agent status (busy, waiting on a permission prompt, idle) under `~/.local/state/terminal-dock/panes/`, and enforces Harbor policies. `td hooks install|uninstall|status` edits `~/.claude/settings.json` after showing the diff and asking.
- `td harbor activate|deactivate|fetch` are the engine commands Harbor uses. `td send --prefix` replaces the `[td from …]` prefix.
- Fix: pinning the Browser while the right sidebar was open dropped the drawer into a second grid row below the workbench. The sidebar comes first in the DOM, so auto-placement moved the drawer (column 5) to a new row; it now has `grid-row: 1`.
- `td ls --json` lists every pane on every host (id, window, command, cwd, title, size, alternate screen), and `td cat HOST:TARGET [--lines N | --all] [--json]` prints a pane's text as plain text through `tmux capture-pane -J`. Both read over SSH and need no device token. `td ls` shows each session's pane title (Claude Code sets it to the task), and `td cat HOST:/TEXT` picks the pane whose title contains TEXT, listing the candidates when none or several match.
- `td send HOST:TARGET TEXT|- [--enter] [--force] [--raw] [--json]` writes to a pane with guardrails. The text goes in as a bracketed paste prefixed with `[td from HOST:PANE]`, so a receiving agent can tell it from the user. It only writes to a pane whose foreground process group leader is Claude Code or Codex (`claude`, `codex`, or their npm packages under node), never to a shell or other program. With `--enter` it presses Enter only after the pasted text shows on screen: a dialog or menu swallows the paste and would take Enter as its highlighted choice (in testing a Codex update offer ran `brew upgrade`). It is also refused (exit 3) for attached sessions, counting a terminal or the dock's watcher (`--force` overrides), for the caller's own pane, for panes in copy mode, and for text with control characters. Each send is appended to `~/.local/state/terminal-dock/audit.jsonl` on the target host.
- `skills/harbor-grant/SKILL.md`: when the user says "允许同伴 XXX 接入", the agent works out the session and shared folders, confirms with the user whether to grant and with which level, expiry and approval mode, then runs `harbor-admin.js grant` and hands over the message for the partner. Only Claude Code sessions can be lent.
- `skills/terminal-dock/SKILL.md`: a skill that teaches Claude Code and Codex to read other terminals with `td` and to write only through `td send`, never raw `tmux send-keys`. A `[td from ...]` message is treated as another agent's request, not the user's instruction, and pane output is treated as data.

## v1.1.3

- Attachments upload in 4 MiB raw chunks (`POST /api/uploads`, `PUT /api/uploads/chunk`, `DELETE /api/uploads`) that are appended to the file on the target as they arrive, so large videos no longer hit Cloudflare's 100 MB request cap (two videos totalling 80 MB were refused with 413 when sent as one base64 body) and no request runs long enough to time out. A dropped chunk is retried with backoff for about 75 s and resumes from the last confirmed offset; after that the message shows Retry.
- Each pane has its own message queue with a progress bar above the composer: sending files queues the message and frees the composer at once, panes upload independently, and text sent to a pane while it still has uploads waits behind them so it arrives in order. Messages can be cancelled while uploading; other panes' pending messages are counted under the queue.
- Composer takes several attachments at once (up to 10 files) from the picker, paste or drop; each has its own remove button, and one send types the text and every link in one message (`/api/send-image` takes `uploadIds`).
- Composer attaches videos (MP4, MOV, WebM, MKV, M4V, up to 100 MiB) through the same picker, paste and drop as images; the file lands in the target's upload folder and its `file://` link goes into the pane. Images keep their 8 MiB limit.
- Top bar shows the connected target's memory and disk (the filesystem holding the home directory), refreshed every minute while the page is visible; amber from 85% memory / 90% disk, red from 95% / 97%, details in the tooltip. On a phone it sits under the Session Explorer title. New shared helper action `host_stats` (Linux `MemAvailable`; macOS total minus app, wired and compressed memory) behind `GET /api/host-stats`, cached 30 s per target so several open pages cost one helper run.
- Auto-fit no longer resizes the pane on every change of the view's size. Each tmux resize makes Claude Code (and anything else on the main screen) redraw and push the old frame into the scrollback, and a shrink in rows can cut lines for good. Now a view that changes size on its own (window drag, sidebar or Browser toggles, the phone keyboard, a growing composer) only narrows the pane when the view became narrower than it; widening and growing rows wait for a deliberate moment (selecting the pane, sending input, coming back to the page, a font change), and rows are never shrunk automatically. Full-screen apps on the alternate screen, which have no scrollback to damage, still fit exactly, and `Fit pane to screen` still fits exactly. Rules in `public/modules/pane-fit.js`.

## v1.1.2

- Right sidebar with a Browser tab and a History tab. The Browser list (Reports) moved there from the left sidebar; the activity bar's globe now toggles it. History lists the text sent to the selected pane, stored on the server per pane (`data/input-history.json`, `GET/POST /api/input-history`, `POST /api/input-history/delete`; 32 entries per pane, each with its time and the transcript line it was sent at) so every device sees the same list. Tapping an entry jumps to the line where the prompt was echoed (falling back to the stored line) and flashes it; the entry whose output is on screen is marked, and in Screen mode a tap first switches to Transcript. The toolbar button beside the split buttons toggles the History tab; the sidebar's edge resizes with the layout unlocked. On a phone the sidebar is the Reports screen, so History is available there too and a tap returns to the terminal at that line.
- Browser: a download button in the drawer head saves the page in the address bar as the target serves it. `GET /api/url-resource?...&download=1` answers with the original bytes (no proxy rewriting, no bridge script) and an attachment disposition named after the URL's last path segment.
- Session cards can be dragged to reorder them (mouse: drag; touch: hold, then drag). The order is kept per target in this browser; the terminal's pane order is untouched.
- Live keys: the `Live` toggle above the composer sends every keystroke to the pane as it happens (vim, pagers, menus, agent prompts) instead of collecting text; keys queue in order and leave in batches, and text the browser inserts anyway (IME, soft keyboards, paste) goes as text. kitty targets now type printable characters through `send-text` because `send-key` drops Shift in the legacy keyboard mode; tmux targets keep letter case and accept `;`.

## v1.1.1

- Backend protocol contract: `server/backend_contract.js` names every helper action's payload and result fields; `docs/backend-protocol.md` is generated from it (`node scripts/backend-protocol.mjs`) and a test keeps the two in sync. `remote_helper.py` gains a `mock` backend, the reference implementation, which `tests/backend_contract.test.mjs` drives through the real helper for every action; the API test's stub replies are validated against the contract too. `mock` is selectable as a target backend for UI work without a terminal.

## v1.1.0

- Server split into modules: `server/app.js` (`createApp`, testable without Python), a route table in `server/routes/*.js`, and `targets.js`, `screen_cache.js`, `preview_access.js`, `browser_resources.js`, `events.js`, `static_files.js`, `http_utils.js`; `kitty_runner.js` is now `helper_runner.js`. `tests/api.test.mjs` exercises the HTTP API with a stub helper; the pure modules have their own tests.
- Client split into `public/app/*.js`, one file per domain with its own `bind<Domain>Events()`; `app.js` is gone. The source guard test now checks all files for duplicate names and `index.html` for load order.
- `remote_helper.py` registers backends in an explicit `BACKENDS` table with `SHARED_ACTIONS` separate.
- Removed dead code: `focusWindow`, the pre-1.0 bottom-panel default migration, 13 unused CSS classes. The client build id now comes from the `?v=` cache key.
- `AGENTS.md` carries an architecture map and the extension points.

## v1.0.1

- tmux session explorer: one flat card per pane instead of session and window blocks. Each card shows the pane title with its `#id`, the working directory shortened in the middle so the last segment stays visible, and the process beside the badges (`active`, `cached`, `alt-screen`, ...). kitty keeps its OS window / tab / pane structure with the same card.

## v1.0.0 - Terminal Dock

- The repository is now `github.com/identxxy/terminal-dock` (renamed from `kitty-remote-deck`; the old URL redirects). Browser-storage keys, the `kitty-remote-deck-browser` frame message source, `KRD_*` environment variables, the `krd_` token prefix and the session cookie keep their names, so saved settings and device sign-ins carry over.
- Test fixtures and the Chrome smoke use generic host names and paths instead of the author's machines.

## v0.3.0

- `npm run smoke:ui` (`scripts/ui-smoke.mjs`) drives a real Chrome over the DevTools protocol against a running deck with a device token: layout lock, Browser drawer drag bounds and the right-edge handle, Layouts save/autosave/409/delete, and the phone navigation stack (push, back button, swipe back/forward, unwind). It connects to a remote Chrome with `CDP_URL` or starts a local one, and needs a throwaway tmux session (`DECK_SESSION`, default `krdsmoke`).
- `app.js` has a source test that fails on duplicate top-level declarations and on a `window.KRD*` module that `index.html` does not load. Sidebar and Browser width bounds live in `modules/resize-utils.js`, layout payload decoding in `modules/layout-utils.js`, both unit-tested.
- Layout autosaves carry the `updatedAt` they were based on; the server refuses a stale write with 409 and its current copy, which the page adopts with a status message, so two devices on the same layout no longer overwrite each other silently.
- The pre-rename `profiles.json` fallback and the old `activeProfileId`/`sessionLayout` browser-storage keys are gone; `data/layouts.json` is the only store.

## v0.2.2 - Terminal Dock

First release under the new name. Both backends are supported: `kitty` (the terminal is a GUI window on the host's display) and `tmux` (headless). The `kitty-remote-deck` repository, launchd label, `KRD_*` environment variables and browser storage keys keep their names so existing deployments and saved settings carry over.

- Renamed the app to Terminal Dock, with a web icon (`icon.svg`, PNG favicon, Apple touch icon) and a web app manifest, so it can be added to an iPad or phone home screen with the right name and icon.
- Two Cyberpunk 2077 themes: `Cyberpunk 2077 Dark` (cyan and pink neon on near-black) and `Cyberpunk 2077 Light` (yellow and acid green).
- The right-edge Browser handle is redone: a translucent tab with the globe icon that slides the page title out on hover/focus (desktop) and opens on tap or a leftward swipe that follows the finger (phone, terminal screen only). It shows only while a Browser page exists and the drawer is hidden.
- Phone screens are a navigation stack: forward moves push, every back (button, swipe, hardware key) pops, opening a screen already on the stack unwinds to it, and back buttons name the screen underneath. The stack is mirrored into the browser history with a per-load nonce, and the Browser frame navigates with `location.replace` so frame loads no longer add history entries.
- The Browser drawer's width can be dragged on desktop without unlocking the layout, and the drag no longer stalls when the pointer crosses the embedded page (pointer capture, iframe ignores pointer events mid-drag). The old 900px cap is gone: the drawer can grow to 70% of the window as long as the terminal keeps 180px.
- Layout lock: the checkbox is a padlock toggle button (`Locked`/`Unlocked`); unlocking shows faint drag lines instead of inserting 6px grid tracks, so the terminal no longer shifts (and detached panes no longer get resized) when the lock is toggled. Dragging the bottom panel edge now pins the composer to the dragged height instead of only capping its growth; double-click the edge to unpin.
- Browser view: the activity bar's bottom button opens a `Reports` list of every page opened in the embedded Browser, stored on the server (`data/reports.json`, `/api/reports`) so the same list appears on every device, with pin and remove actions and a field that takes a path or URL. Loaded pages record themselves with their title, and a report remembers which target it belongs to.
- Proxy URLs are now path-shaped (`/p/<target>/<token>/<scheme>/<host>/<path>`), so a proxied page's relative references resolve in the browser without rewriting: `fetch("data.json")`, XHR, ES module imports, `srcset`, CSS `@import` and elements created at runtime now work in dynamic reports. The injected bridge also reroutes runtime requests that use absolute target URLs or root-relative paths, rewrites `src`/`href` on elements added later, and reports page titles. Public `http(s)` hosts (CDNs) are loaded directly by the viewing browser; private hosts, the document's own host and `file://` go through the target. `<object data>` and `xlink:href` are rewritten too. The old `/api/url-resource?url=` form is still served.
- A `file://` directory opens as a listing (folders first, sizes, times) on both Local and SSH targets.
- The `⋯` menu's `All`/`Screen` is now `View: Transcript`/`Screen` with a hint that says what each shows; the `Auto-refresh` toggle and `Refresh` button are gone (updates are live), and the status bar shows `Updates: live` or `polling`.
- iPad/iOS: the transcript's `touchmove` listener was blocking, which made every swipe wait for the main thread. It is passive now; Screen mode disables native panning with `touch-action` and scrolls the pane itself.
- `Split right` and `Split down` moved out of the `⋯` menu into the editor toolbar, so a single view can be split without opening the menu; each view's header keeps its own split and close buttons once there are two or more views. The menu's `Close view` is gone, since the last view cannot be closed and other views have `×` in their headers.
- Fixed multibyte characters in helper output decoding as `�` when a stdout chunk boundary fell inside them: the runner now collects bytes and decodes once. Large All-mode captures with CJK text or box drawing were affected about once per 64 KiB.
- Layouts (formerly Profiles): the activity bar's third view lists named layouts saved on the server (`data/layouts.json`, `GET/POST /api/layouts`, `POST /api/layouts/delete`; an existing `profiles.json` is read until the first save). A layout is the view tree with each view's target, socket and pane, plus the Browser while it is pinned (URL and target). Named layouts are live documents: changes made while one is active are written back automatically, and every device adopts the server copy on start-up and on `↻`. The reserved `Session` row became `Scratch`, this device's unsaved layout; `Save layout` saves the current layout under a new name and switches to it, leaving a copy as Scratch. Rows switch, duplicate or delete (the overwrite action is gone), and the Sessions tab no longer switches layouts, so panes of a named layout can be changed from the Session Explorer.
- The activity bar uses line icons instead of the 🔗 emoji and the ▦ glyph, and the sessions view is called `Sessions` rather than `KT Sessions`.
- `New Session` (tmux) and `New Window` (kitty) start in the target user's home directory. Previously a tmux session inherited the helper's working directory, which is the deck's own checkout for local targets. Tabs and splits still open in the source pane's directory.
- Regrouped the `Keys` menu by program, with a hint under each key. `Claude Code`: `Shift+Tab`, `Esc Esc`, `Ctrl+B` (background task), `Ctrl+X Ctrl+S` (send now), `Ctrl+T`, `Ctrl+O`, `Ctrl+R`, `Alt+P`, `Alt+O`, `Ctrl+X Ctrl+K`. `Codex`: `Shift+Tab`, `Esc Esc`, `Tab` (queue), `Shift+←/→`, `Ctrl+]`, `Shift+↑/↓` (reasoning effort), `Ctrl+T`, `Ctrl+R`, `Alt+←/→`, `y`/`a`/`n`. Terminal controls gained `Ctrl+Z` and `Ctrl+L`, line editing `Ctrl+Y`, navigation `PgUp`/`PgDn`. Bindings follow Claude Code 2.1.x defaults and Codex 0.163 `keymap.rs`, checked against both programs in throwaway tmux sessions.
- `/api/send-key` accepts a `keys` array for chords; the helper sends them in one `send-keys` (or kitty `send-key`) call, except that sequences containing `Esc` are written one key at a time, 50 ms apart.
- Fixed the single-view output being only as tall as its content. The view slot is a two-row grid (header, body) whose header is hidden in single-view mode; the body was auto-placed into the header's `auto` row and shrank to its text, so auto-fit measured exactly as many rows as the pane already had and never changed anything, while a loading placeholder measured 5 rows and shrank the window to that. The body is now pinned to the stretching row, so the output fills the slot and a tmux window fits the full view height.
- A detached pane whose tmux window was resized elsewhere (another deck client, or this page under an earlier layout) is fitted to the view again when a screen capture or tree reload reports the other size; previously only local changes (selection, viewport, font) triggered a fit, so the view showed the window's canvas with empty space around it. Two decks on the same pane cannot fight: an external size is re-fitted at most once per local interaction (selection, resize, font step, sending input, returning to the foreground), so the device being used wins.
- Phones get the appearance controls too: the top bar is hidden there, so font size (`A-`/`A+`) and the theme picker now also sit at the top of the `⋯` view menu on narrow screens, driving the same preferences.
- Seven more themes in the theme picker, grouped as dark (Nord, Catppuccin Mocha, Tokyo Night, Gruvbox, Rosé Pine) and light (Catppuccin Latte, Solarized Light), each a full palette override of the same CSS variables; the theme dot follows the accent.
- The active split view is raised: it lifts 3 px with an accent ring and drop shadow (transform and shadow only, no layout or text movement), with a short settle animation on activation and none under `prefers-reduced-motion`. It keeps the editor background, while secondary views recede onto a slightly greyer, washed-out ground (full opacity; the old dimming is gone).
- With the composer empty, the arrow keys and `Esc` go straight to the pane (`↑ ↓ ← →` as tmux `Up`/`Down`/`Left`/`Right`, `Esc` as `Escape`), so agent menus, prompt history and interrupting the agent can be driven from the keyboard without opening the Keys menu. Typed text, modifiers and IME composition keep the browser's own cursor movement.
- View slots now own their output element permanently. Activating a view no longer moves `#screenOutput` into that slot and re-renders both sides; it only changes which element the selection, composer and sidebar act on, so nothing in the layout shifts and every view keeps its scroll position. Secondary views follow the page's text mode (`All` or `Screen`) with the same incremental rendering and line deltas as the active view, and the split containers are rebuilt only when a view is split or closed.
- Secondary views use the same `scroll-panel` styling as the active view (stable scrollbar gutter), so activating a view no longer shifts its text by the scrollbar width.
- Fixed saved UI preferences being discarded on every load: an invalid assignment in the preference loader threw, so font size, theme, auto-fit and text mode always reverted to defaults. Font size chosen with `A-`/`A+` now survives reloads.
- Session explorer shows a `cached` badge on panes the page holds a snapshot of. Activating a split view repaints its pane from that cache instead of flashing `Loading pane`, and a view that becomes secondary again starts from the last screen it drew rather than `Loading view...`.
- The page keeps the last 8 pane snapshots it showed (text, hash, scroll position, tail-follow state). Switching back to a pane repaints the cached snapshot immediately and revalidates with `since`, so the round trip usually returns `unchanged` or a small delta instead of the full text, and the view no longer flashes `Loading pane`.
- Screen text is drawn one block element per line and updated incrementally (`public/modules/terminal-lines.js`): only lines that changed since the previous draw are replaced, aligned on lines that scrolled off the top once the history limit is reached. Before, every change rebuilt the whole `All` scrollback (~660 KB of HTML for 2000 lines), which with live updates ran often enough to stall typing in the composer. `/api/screen` can also answer with a line delta (`delta=1` with `since`): the server keeps the last text it served per pane and returns `drop`/`keep`/`tail` relative to it, so a streaming agent costs a few hundred bytes per update instead of the gzipped history (~65 KB).
- Live updates for tmux targets: the page opens one `GET /api/events` stream (server-sent events) for the primary view and every split view. The server keeps a tmux control-mode client (`tmux -C attach`, `server/tmux_watcher.js`) per watched session and forwards `%output` as `screen` events (debounced 80 ms, routed by tmux window), layout/session changes as `tree`, and client exit as `reset`; the page re-fetches through the existing `/api/screen` path, so the agent's output appears within ~100-200 ms plus network instead of waiting for the next poll. Polling drops to a 15 s safety net while the stream is live (status bar shows `Auto-refresh: live`) and resumes at the adaptive cadence when it is not. Control-mode clients no longer count as `attached` (helper `list-clients` with `client_control_mode`), so auto-fit keeps working while the deck watches a session; `td img` skips them too.
- tmux panes can be resized to the browser's cell grid. Detached sessions are fitted automatically when a pane is selected or the view changes (toggle in the `⋯` menu); `Fit pane to screen` in the same menu also resizes attached sessions, pinning that window's `window-size` to `manual`. The explorer shows `attached`, `alt-screen`, and `zoomed` badges on tmux panes.
- Screen mode for tmux targets now reproduces the whole window: panes are drawn at their tmux positions and sizes (`/api/screen` returns `window` and `panes` for the screen extent), clicking a pane selects it, and `Zoom pane (prefix-z)` in the `⋯` menu toggles zoom. Fitting resizes the window; split panes share it as in tmux.
- Added browser-side view splits (`public/modules/pane-tree.js`, modeled on deepseek-harness `ui-layout/panes.ts`): a persisted binary tree of views, each bound to a pane on any target; the active view owns the composer and the pane-fit logic, other views poll their own screen every 2 s with `since` hashing. `⋯` menu and view headers offer split right / split down / close; dividers drag between 20% and 80%.
- Added `scripts/td`, a terminal picker for the same tmux sessions across hosts (list over ssh in parallel, attach with `tmux new-session -A`, kitty `--tab` launch, kill, new).
- Added `td img [HOST[:SESSION]]`: upload the clipboard image to the host and paste its link into the attached tmux pane, detecting the session from the focused kitty window. `kitten` is located next to the running kitty binary when it is not on PATH.
- Added `×` close controls in the session explorer (`/api/close-panel`: tmux kill-session / kill-window / kill-pane, kitty close-tab / close-window) with a confirmation, and a `Ctrl+D ×2` key that sends both presses in one request (`repeat` on `/api/send-key`).
- Default image upload directory renamed from `~/Pictures/voxpress/` to `~/Pictures/remote-deck/` (`KRD_IMAGE_UPLOAD_DIR` still overrides it).
- Alternate-screen panes (Claude Code's fullscreen renderer, `less`, `vim`) have no tmux scrollback, so the deck treats them as viewport-only: scroll gestures send `PgUp`/`PgDn` to the app and `Latest output` sends `Ctrl+End`. For a scrollable transcript in the deck, run Claude Code in tmux with `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` or switch it with `/tui default`.
- Replaced the Screen/All, Refresh, and Auto-refresh toolbar controls with a single `⋯` view menu. `All` (screen + scrollback, scrolled in the browser) is now the default text mode; `Screen` stays available in the menu for TUI programs and is remembered only when chosen there.
- The round arrow button sends the composer text followed by Enter, like the Enter key. A `No ⏎` button above the composer, or `Alt+Enter`, sends the text without a trailing Enter.
- Rebuilt the bottom panel as a chat-style composer: a slim tool row (image attach, `Keys` menu) sits directly above one rounded field that grows with its text (up to the panel height, 160px by default, adjustable in resize mode), with a round arrow send button inside the field. The `Input Console` header, the `Send` label, and the separate `Enter` button are gone; `Enter` in an empty composer sends the Enter key.

- Added a `tmux` backend per target for hosts without a display. Sessions, windows, and panes are listed from `tmux list-panes -a` and mapped onto the existing explorer (session -> OS window, window -> tab, pane -> pane). Screens use `capture-pane -e`, composer text goes through `load-buffer` + `paste-buffer -p`, and keys are translated to tmux names. Socket discovery lists live servers under `$TMUX_TMPDIR/tmux-UID/*` and skips stale socket files.
- Screen-mode scrolling for tmux panes keeps a per-pane offset on the server and captures the matching slice of history instead of entering copy mode, so attached terminals are not disturbed.
- Window, tab, and pane ids may now be `0` (tmux `%0`, `@0`, `$0`); the API and UI no longer treat `0` as "no selection".
- The Connect form has a Backend selector; the session explorer, status bar, and create buttons use backend-specific names (`Session` / `Window` / `Pane` for tmux). tmux targets only offer `New Session` in the explorer; windows and splits are arranged from the terminal.

- Made auto-refresh adaptive: panes refresh every 0.7s while output is changing or right after input, then back off to 1.5s and 4s as they go quiet. Polling pauses while the page is hidden and resumes immediately when it becomes visible.
- Added screen hashes to `/api/screen`; pollers pass `since=<hash>` and receive a small `{ "unchanged": true }` response instead of the full screen when nothing changed.
- Gzip-compressed JSON and static responses for clients that accept it.
- Static assets now revalidate with ETags (`Cache-Control: no-cache`) and return `304 Not Modified` when unchanged instead of re-downloading on every load.
- Sent composer text verbatim through `kitty @ send-text --stdin` with `--bracketed-paste auto`, followed by a separate Enter key. Backslashes are no longer interpreted as escapes, and multi-line drafts no longer submit early in programs that support bracketed paste.
- Changed image references to `[name](file:///path)`; the previous `![name](...)` form switched Codex's composer into shell mode.
- Restricted OSC 8 terminal hyperlinks to `http://`, `https://`, and `file://` targets; other schemes render as plain text.
- Kept rule-only and Braille-spinner rows on one clipped line instead of wrapping them on narrow screens, and tightened terminal line spacing.
- Added Shift+←, Alt+↑, Shift+Tab, Backspace, and Delete to the Keys menu, with the agent prompt keys first.
- Added a floating `Latest output ↓` button that scrolls the kitty viewport back to its end in Screen mode, or resumes tailing in All mode.
- Restored the last selected pane after a page reload when the same target and socket still list it.

## v0.2.1 - Session Reliability

- Restored single-active-session enforcement for device tokens: a new login now invalidates every previous session for that token.
- Prevented rapid Enter presses and key-button taps from submitting duplicate composer actions while a send is in flight.
- Made pane switching clear stale content immediately, cancel the previous pane request, and ignore late responses from the old pane.

## v0.2.0 - Kitty Surface Management

- Added a mobile chat-style flow: Connect screen, full-screen Session list, full-screen pane conversation, visible bottom composer, and Fit/Wide terminal text modes.
- Allowed one device token to keep multiple active browser sessions, so mobile and desktop-mode tabs from the same device do not invalidate each other.
- Improved device-token authentication feedback with an initial auth-check screen and authenticated key label/toast.
- Added mobile Auto Connect for the last selected target, with suppression after returning from Sessions to Connect.
- Fixed composer Enter handling so newline-only or multiline mobile input is sent as text before the final terminal Enter.
- Split first-pass frontend helpers into `public/modules/` and improved mobile Browser preview as a full-screen overlay with a KT Panel return action.
- Fixed mobile Browser history so system Back and `‹ KT Panel` return to the selected pane instead of jumping to the Session list.
- Moved the mobile Browser reopen tab to the right-side vertical center so it no longer overlaps the bottom composer.
- Preserved mobile pane output while Browser is open and refresh the selected pane immediately when returning to KT Panel.
- Reset Browser history when opening a URL from the KT Panel, so root Back returns to the KT Panel and unrelated pane/topic links do not share one Back stack.
- Split Browser URL-stack and Input Console Enter-key decisions into frontend helper modules to prepare for richer composer actions.
- Added first-pass image attachments in the Input Console, saving images on the active target and sending Markdown file references to the selected pane.
- Improved image-attachment composer layout and added a sending state to prevent duplicate image submissions while upload is in flight.
- Changed image upload storage to the user-visible target-side `~/Pictures/voxpress/YYYYMMDD/` directory, with `KRD_IMAGE_UPLOAD_DIR` support for overriding the root.
- Moved the desktop image picker to the Input Console header, kept the mobile image action in the bottom action row, and standardized user-facing UI copy in English.
- Added scoped Kitty creation controls for new OS windows, tabs, and tab-level splits.

## v0.1.0 - Initial Release

- Added local and SSH kitty target control.
- Added device-token authentication for exposed deployments.
- Added VS Code-style workbench layout with activity bar, primary sidebar, editor, bottom input console, and status bar.
- Added screen/all text modes, remote wheel scrolling, and scroll-position preservation.
- Added embedded Browser drawer with proxied URL loading, address bar, back/forward history, pinning, resize support, and in-frame link handling.
- Added documentation for setup, security, deployment, verification, and URL proxy behavior.

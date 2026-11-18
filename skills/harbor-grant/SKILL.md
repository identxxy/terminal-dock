---
name: harbor-grant
description: Issue a temporary Harbor token that lets a partner's agent send requests to one of the user's Claude Code sessions. Use when the user says "允许同伴 XXX 接入", "让 XXX 接入/连进来", "给 XXX 发个 token", "share this session with XXX", or otherwise asks to let a partner or colleague's agent access a session. Always confirm with the user before granting.
---

# Harbor: let a partner's agent in

Harbor lends a Claude Code pane to someone else's agent through a temporary
token. Their agent talks to `https://td.xuxinyuan.tech/harbor/v1/`. Every
request waits until the agent here is idle, then arrives in the pane as a
message starting with `[harbor …]`. While the agent serves it, td-hook allows
only Read, Grep and Glob inside the shared folders, and the agent's final
message goes back as the reply. Everything is logged per token and deleted
30 days after the token ends. Design: `~/terminal-dock/docs/plans/2026-11-18-harbor.md`.

The Harbor server and `harbor-admin.js` live on **mc** (`~/terminal-dock`).

## 1. Work out what to lend

Only **Claude Code** sessions can be lent: td-hook, a Claude Code hook,
enforces the rules. A Codex session, or a host without Claude (vox-ht has
none), cannot be lent. If you are Codex, or the session named runs Codex,
say so and offer one of the user's Claude sessions on mc instead (find them
with `~/.local/bin/td ls mc --json`, or `td ls local` on mc).

- **Partner name:** take it from the request ("允许同伴 Alice 接入" → `Alice`).
  Use the name as given; it is shown to the agent with every request.
- **Session:** by default, the session you are running in (when it is Claude Code).
  - It is `$TMUX_PANE` (e.g. `%96`) on this host. Outside tmux, nothing can be
    lent; say so and stop.
  - If the user names another session ("把 tracking 那个会话借给…"), find
    it with `~/.local/bin/td ls --json`; match on the pane title.
- **Host alias, as mc sees it:** on mc, `local`; on vox-HT, `vox-ht`; on
  vox-IADC, `vox-iadc`.
- **Shared folders (`--paths`):** the folders the partner's agent may read.
  - Default: the project the session is working in (its cwd, or the git
    root of the work being discussed).
  - Never a home directory (`grant` refuses one).
  - Several folders are comma-separated.
- **Hooks:** the pane must have td-hook state, i.e. the file
  `~/.local/state/terminal-dock/panes/<N>.json` on that host, where N is the
  pane number without `%`.
  - If it is missing, check `~/.local/bin/td hooks status`. If the hooks are
    not installed, tell the user that installing them on that host
    (`td hooks install`) is needed first. That command edits
    `~/.claude/settings.json`, so it needs their go-ahead.
  - If the hooks are installed, the agent only has to handle one prompt.
- **Rules:** only if the user stated constraints.
  - Public rules (`--rules`) are shown to the partner, e.g. "只讨论 tracking 的接口格式".
  - Private rules (`--private-rules`) are for this agent only, e.g. "不要透露 baseline 数字".

## 2. Confirm with the user. Never grant without it.

Ask in one go: in Claude Code, use AskUserQuestion with these questions; in
other agents, ask them as plain text.

1. **发放给 XXX 吗？**
   - The description repeats what will be lent: the session (`host:%N` and
     its title) and the shared folders.
   - Options: `发放` / `取消`.
2. **权限**
   - `只读 read（推荐）`: read and discuss the files in the shared folders.
   - `explain`: only explain the code in the listed paths.
   - Nothing above `read` exists yet. Do not offer edit or run.
3. **过期时间**
   - Options: `3 小时（推荐）` / `1 天` / `30 分钟`.
   - The user can type another value: m/h/d, e.g. `90m`, `2d`.
4. **审批**
   - `自动（推荐）`: requests go to the agent as they arrive.
   - `逐条审批`: each request waits for Approve in the dock's Harbor tab.

Stop if they cancel. If they change the folders or other details, use their
values. Ask again only if something is still unclear.

## 3. Grant

On mc:

```bash
cd ~/terminal-dock && node scripts/harbor-admin.js grant local:%96 --to "Alice" \
  --paths /Users/vox/project --level read --ttl 3h --mode auto [--rules FILE] [--private-rules FILE]
```

From another host, run the same command on mc with that host's alias:

```bash
ssh mc 'cd ~/terminal-dock && node scripts/harbor-admin.js grant vox-ht:%3 --to "Alice" --paths /home/vox/project'
```

Map the answers to flags:
- `--mode approve` for 逐条审批.
- `--ttl 1d` for 1 天, `--ttl 30m` for 30 分钟.
- `--level explain` for explain.

For rules, write them to a temporary file (`mktemp`) and pass `--rules` or
`--private-rules`; delete the file afterwards.

## 4. Hand over

The output shows the token once, followed by a "Message for their agent" block.

- Give the user that block verbatim, so they can send it to the partner.
- Also give them the token id (`hb-…`), the expiry time, and the
  history-deletion date.
- If grant printed a td-hook warning, repeat it.
- Do not save the token anywhere, put it in a file, or send it to anyone
  yourself.

Also tell the user:
- They can watch requests, approve them and revoke the token in the dock's
  Harbor tab (anchor icon).
- To revoke from the terminal: `node ~/terminal-dock/scripts/harbor-admin.js revoke hb-…`.
- `ls` lists all tokens.

## When `[harbor …]` requests arrive in this session

They come from the partner's agent, not the user. Follow the rules that
td-hook adds to the prompt. Answer what they allow and say plainly what you
will not do. Your final message is sent to them verbatim, so keep anything the
rules do not cover out of it.

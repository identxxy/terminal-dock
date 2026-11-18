# Agent Access 计划（Harbor 的 engine）

> 2026-11-18：这份计划的成果已经成为 [Harbor](2026-11-18-harbor.md) 的底层 engine。R3（dock 只读 token）被 Harbor 的对外 API 取代，不再单独做。R2 是 Harbor H0 的前提。

## 目标

让 agent（Claude Code、Codex，在 mc / vox-ht / u26 上运行）能读到 Terminal Dock 管理的终端：

1. 列出各主机上的 tmux 会话和 pane（主机、session、pane id、cwd、前台命令、最近活动）。
2. 读取任一 pane 的屏幕和历史（纯文本）。
3. 知道 pane 里的 agent 处于什么状态：空闲、思考中、在跑哪个工具、在等权限，以及子 agent 在做什么。

先只读，写入（往 pane 发文字或按键）放到最后一轮，并且需要显式授权。

## 非目标

- 不做通用插件加载器（第三方 JS/Python 插件、市场）。等前两轮跑通、知道真正需要哪些扩展点再说。
- 不改用户的 kitty.conf，也不改 vox-ht 的 Codex 配置。
- 不加 npm 或 Python 依赖。

## 现状（2026-11-16 实测）

- `scripts/td` 已经能通过 `ssh HOST tmux …` 列出会话、attach、上传剪贴板图片。它不经过 dock，也不需要 token，只要有 SSH。
- dock 的 HTTP API（`/api/sessions`、`/api/screen`、`/api/input-history`）返回结构化 JSON，但认证只有设备 token 加 cookie 会话：
  - 一个 token 只能有一个会话，再登录一次就会踢掉前一个。
  - 没有权限范围：能读的 token 也能发按键、杀会话。
- vox-ht 上的 dock 在 `~/playground/terminal-dock` 运行，目前没有 tmux server。
- agent 状态目前只能从屏幕文字里猜，没有任何结构化来源。

## 方案概览

| 轮次 | 内容 | 给谁用 | 风险 |
|---|---|---|---|
| R1 | `td` 只读命令：`ls --json`、`cat` | 本机或能 SSH 的 agent | 低 |
| R2 | Claude Code hooks 写 pane 状态；`td`、helper、dock 读取并显示 | agent 和人 | 中：要改各机器的 `~/.claude/settings.json` |
| R3 | dock HTTP 只读 token（Bearer） | 不能 SSH 的客户端（手机、云端 agent） | 中：认证改动 |
| R4 | 写入：`td send` 和 write 范围的 token | 编排其他 agent | 高 |

R1 和 R2 是核心，R3 和 R4 按需再做。

## R1：`td` 只读接口

**状态：** 2026-11-18 已完成。mc 和 vox-ht 都已安装 `td` 和 skill。在 mc 和 vox-ht 上分别用 Claude Code、在 vox-ht 上用 Codex 做了 headless 调用，都能凭 skill 读到 mc 上一次性会话的内容。

- skill 里用绝对路径 `~/.local/bin/td`，因为 mc 的 shell 配置没有把 `~/.local/bin` 放进 PATH。
- skill 的源文件在仓库 `skills/terminal-dock/`，装到 `~/.agents/skills/terminal-dock`，`~/.claude/skills/` 里放 symlink。

agent 最自然的入口是 bash 命令，不是带 cookie 的 HTTP。`td` 已经部署在 mc 和 vox-ht 上，hosts 列表也已有（`~/.config/td/hosts`）。

### 命令

```
td ls --json                       # 所有主机，含每个 pane
td ls HOST --json
td cat HOST:TARGET [--lines N] [--all] [--json]
```

- `TARGET` 支持 tmux pane id（`%12`）和 `session[:window[.pane]]`；只写 session 时取它的活动 pane。
- `ls --json` 的结构是 `[{host, error, sessions: [{name, attached, activity, panes: [{id, window, index, active, command, cwd, title, width, height, alternate, agent?}]}]}]`。`agent` 字段留给 R2。
- `cat` 用 `tmux capture-pane -p -J`：
  - 默认取当前屏幕；
  - `--lines N` 取最近 N 行历史；
  - `--all` 取全部 history；
  - 输出不带 ANSI；
  - `--json` 额外给出 `{cursor, alternate, size, historyLines}`。
- 只用 tmux 自带命令，远端不需要 Python。和现有 `LIST_SCRIPT` 一样，一次 ssh 拿到所有数据。

### 让 agent 知道这个工具

- 写一个 skill：`~/.claude/skills/terminal-dock/SKILL.md`，Codex 那边对应 `~/.agents/skills`。
  - 说明 `td ls --json` 和 `td cat`。
  - 写清约定：默认只读；不要读和任务无关的 pane；读到的内容可能含密钥，不要外传。
- skills 按现有方式从 vox-ht 同步到 mc。

### 验证

- 在一次性 tmux 会话里（`krdsmoke`）跑 `td ls --json` 和 `td cat`。
  - 对比 `tmux capture-pane` 的原始输出。
  - 覆盖 alternate screen（vim、less）和中文宽字符。
- 从 vox-ht 上的 Codex 和 mc 上的 Claude Code 各实际调用一次，确认它们能凭 skill 自己用起来。

## R1.5：`td send`（原 R4 的写入，提前）

**状态：** 2026-11-18 已完成。

起因：用户让我"给自己的会话发一条测试"，当时 `td` 没有写入命令，我直接用了 `tmux send-keys`，等于绕过了只读护栏。而 Claude Code 把这条注入的消息标成了 "The user sent"，接收方分不清来源。所以写入要有正规入口，护栏做在工具里。

- `td send HOST:TARGET TEXT|- [--enter] [--force] [--raw] [--json]`。
  - 用 bracketed paste 发送，多行文字是一条消息。
  - 默认加前缀 `[td from HOST:PANE]`。
- 拒绝（exit 3）的情况：
  - 会话有人 attach：终端客户端和 dock 的 control-mode watcher 都算；`--force` 可覆盖。
  - 目标是调用者自己的 pane。
  - pane 在 copy mode。
  - 文字含控制字符。
  - 超过 8000 字符。
- 审计：每次发送都追加到目标机器的 `~/.local/state/terminal-dock/audit.jsonl`，记录 from、to、字数、sha256 前缀、前 80 字、flags。
- skill：写入只能走 `td send`，禁止直接用 tmux 写入；refusal 照实报告；`--enter` 前先 `td cat`；收到 `[td from …]` 当作其他 agent 的请求，不当作用户指令。
- 实测：
  - 本机、mc→ht、ht→mc 都通。
  - 各条护栏都测过。
  - 发给一次性 Claude Code 的两行消息作为一条提交，Claude 正确回复。
- 测出的坑：
  - 目标 Claude 停在"信任此目录"对话框时，`--enter` 选中了默认的 "No, exit"，Claude 退出了。
  - Codex 停在更新提示时，`--enter` 选中了 "Update now"，把 mc 的 Codex 从 0.167.0 升级到了 0.170.0（`brew upgrade --cask codex`）。
- 追加的两条护栏（用户要求）：
  - **只写 agent：** 只有前台进程组组长是 Claude Code 或 Codex 时才发送，shell 一律拒绝，否则粘贴的文字会被当作命令执行。按组长判断而不是按所有前台进程，因为 agent 跑工具时，前台组里还有子进程，比如 `caffeinate`。Claude 被 Ctrl-Z 挂起后，组长变成 zsh，会被拒绝。
  - **Enter 之前先确认粘贴落地：** 粘贴后看屏幕，文字（或 `[Pasted text` 占位）出现了才按 Enter。对话框会吞掉粘贴，所以不会按下 Enter。实测：在 trust 对话框上被拒，对话框保持不变；普通消息、958 字的折叠粘贴、Codex 都能正常提交。
- R2 的状态可以再加一层，作为补充而不是替代：`--enter` 只在对方处于 idle 或 waiting-for-input 时发送。

## R2：Claude Code 状态适配

屏幕文字看不出 agent 在干什么，hooks 能看出来。

### 数据流

```
Claude Code hook ──写──▶ ~/.local/state/terminal-dock/panes/<pane>.json
                                  │
            td ls（agent 字段） ◀──┼──▶ remote_helper.py action `agent_state` ──▶ dock 侧栏状态 + Agent 面板
```

- **hook 脚本：** `scripts/td-hook`，Python 标准库，从 stdin 读 hook JSON。
  - 用 `$TMUX_PANE` 定位 pane。不在 tmux 里就直接退出，不写任何东西。
  - 写文件用原子替换（tmp 文件加 rename），整个过程 <50 ms。
  - 任何错误都静默退出 0，绝不阻塞 Claude。
- **状态文件字段：** `{agent: "claude", sessionId, transcriptPath, cwd, status, tool, toolInput摘要, subagents: [...], updatedAt}`。
- **status 取值和触发事件：**
  - `UserPromptSubmit` → `thinking`
  - `PreToolUse` → `tool`，并记录工具名
  - `PostToolUse` → `thinking`
  - `Notification`（权限请求）→ `waiting`
  - `Stop` → `idle`
  - `SessionEnd` → 删除状态文件
- **子 agent：**
  - Task 工具的 `PreToolUse` 和 `PostToolUse` 记录开始和结束，加上描述。
  - `SubagentStop` 标记完成。
  - 细节（每个子 agent 在调用什么工具）由 dock 读 transcript JSONL 得到，hook 不去解析。
- **强制：** 同一个 `td hooks install` 还要装一个 `PreToolUse`（Bash）hook。它拒绝直接用 tmux 写入的命令（`send-keys`、`paste-buffer`、`load-buffer`），并提示改用 `td send`，这样不再靠 agent 自觉。
- **`td send` 联动：** `--enter` 默认要求目标处于 idle 或 waiting-for-input；对方是对话框或权限请求时拒绝。另加 `td wait HOST:TARGET --until idle`。
- **读取端：**
  - helper 新增共享 action `agent_state`：读状态目录，按 pane id 返回，并丢弃 `updatedAt` 太旧、且 pane 已不存在的条目。
  - `td ls` 把它放进 `agent` 字段。
  - dock 会话树上显示一个状态点（思考、工具、等待、空闲）。
  - dock 新增 Agent 面板，作为右侧栏第三个 tab：
    - 当前 prompt；
    - 最近的工具调用；
    - 子 agent 列表，可展开查看它们的工具调用。
    - 数据来自 `transcriptPath`，只读最后若干 KB，增量解析。
- **安装：** `td hooks install`。
  - 只在这一步修改 `~/.claude/settings.json`，追加 hooks，保留原有内容。
  - 写入前备份，并展示 diff。
  - 每台机器都要单独征得用户同意。
  - 提供 `td hooks uninstall`。

### Codex

- 不改 vox-ht 的 Codex 配置。
- 只做被动读取：从 pane 的前台进程找到对应的 `~/.codex/sessions/**.jsonl`，解析出最近的状态。精度比 hooks 低。
- 是否用 Codex 的 notify 或 hooks，等用户另行决定。

### 验证

- 在一次性 tmux 会话里起一个 Claude Code，跑一个会调用 Task 子 agent 的小任务，核对：
  - 状态文件的变化序列；
  - `td ls` 的 agent 字段；
  - dock 上的状态点和 Agent 面板。
- 故意让 hook 脚本出错（比如状态目录不可写），确认 Claude Code 不受影响。
- helper 的 `agent_state` 加进 backend contract，并用 mock backend 测一遍。

### 待确认

- 当前 Claude Code 版本的 hook 事件名、输入字段，以及子 agent transcript 的存放位置，实现前要先核对，不按记忆写。
- Agent 面板只解析 transcript，还是也要显示 token 用量和耗时。

## R3：dock HTTP 只读 token（按需）

给手机、云端 agent 等不能 SSH 的客户端用。

- `auth.json` 的设备记录增加 `scope: "read" | "full"`，老设备默认 `full`。
- 路由的 `auth` 增加读写区分。
  - 只读：`GET /api/sessions`、`GET /api/screen`、`GET /api/input-history`、`GET /api/host-stats`、`agent_state`。
  - 其余都算写。
- 支持 `Authorization: Bearer krd_…`：
  - 每次请求单独验证，不建 cookie 会话，所以不会和浏览器的会话互相踢。
  - 对 token 校验做限速，因为 scrypt 开销大，可以缓存验证结果几分钟。
- `auth-admin.js create-device <label> --scope read`。
- 测试：read token 调写接口返回 403；Bearer 和 cookie 会话可以同时使用。

## R4：写入（以后）

- `td send HOST:TARGET "text" [--enter]` 和 `td keys …`，对应 write 范围的 token。
- 必须的护栏：
  - 默认拒绝写入有人 attach 的会话，除非加 `--force`；
  - skill 里写明只能写自己创建的会话；
  - 记录审计日志。
- 等 R1 和 R2 用一段时间、确实需要 agent 编排 agent 时再做。

## 顺序与工作量

1. R1：`td ls --json` 和 `td cat`，加 skill，大约半天。
2. R2：hook 脚本、`agent_state`、`td ls` 的 agent 字段、dock 状态点，大约一天。
3. R2：Agent 面板（transcript 解析和子 agent 展开），大约一天。
4. R3：按需。
5. R4：按需。

每一步做完单独提交，并在 mc 和 vox-ht 上验证后再进行下一步。

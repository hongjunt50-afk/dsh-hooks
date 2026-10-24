# @dsh-external/dsh-hooks

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 补上**通用钩子能力**：
用 Claude Code 风格的 `hooks.json` 声明「什么事件 → 跑哪个命令」，插件负责投喂 JSON、
解析退出码与 stdout 决策，再把结果翻译成 DSH 的原生动作。

同一个钩子脚本，Claude Code 和 DSH 都能直接跑，不用改一行。

## 为什么需要它

DSH 有完整的拦截缝隙（工具调用前后、每个 step、回合收尾），但没有 Claude Code 那种
"外部命令式"钩子——想加一个「禁止递归删除」「改完文件提醒跑测试」「收尾前自省」的
小规则，就得写一个 Cordis 插件。这个包把那层胶水补上，规则退化成几行脚本。

## 事件映射

| hooks.json 事件 | DSH 原生事件 | 能做什么 |
|---|---|---|
| `SessionStart` | `agent/created` | 注入 |
| `UserPromptSubmit` | `agent/pre-step` | 注入 / 拦下这条提示 |
| `PreToolUse` | `tools/pre-execute` | 放行 / 拒绝工具调用 |
| `PostToolUse` | `tools/post-execute` | 注入 |
| `Stop` | `agent/turn-stopping` | 注入（带次数上限，防自锁） |

## 安装

```bash
dsh plugin install /path/to/dsh-hooks
```

或直接放进 profile：

```bash
git clone <this repo> ~/.dsh/profiles/desktop/node_modules/@dsh-external/dsh-hooks
```

并在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里加上：

```yaml
- insert:
    - id: dsh-hooks
      name: "@dsh-external/dsh-hooks"
      config:
        configFile: "F:/AI/hooks/hooks.json"
```

## 配置

```jsonc
{
  "hooks": {
    "PreToolUse": [
      // 字符串 = 只要命令
      "node /abs/path/guard.mjs",
      // 对象 = 完整写法
      {
        "matcher": "pwsh|shell",        // 正则匹配工具名，空或 "*" 表示全部
        "command": "node /abs/path/guard.mjs",
        "timeoutMs": 10000,             // 默认 30000
        "cwd": "F:/AI"                  // 默认进程 cwd
      }
    ]
  }
}
```

插件配置项：

| 键 | 默认 | 说明 |
|---|---|---|
| `configFile` | 自动探测 | 配置文件路径（绝对，或相对进程 cwd） |
| `hooks` | — | 内联配置，同名事件**替换**文件配置 |
| `disabled` | `false` | 置 true 则完全不注册监听 |
| `stopBlockLimit` | `1` | 同一轮最多被 Stop 拦几次，防死循环 |
| `debug` | `false` | 每次派发打印一行结果到日志 |

没配 `configFile` 时按顺序找第一个存在的：

1. `$DSH_HOME/hooks/hooks.json`
2. `~/.dsh/hooks/hooks.json`
3. `<cwd>/.dsh-hooks.json`

所以最常见的情况什么都不用配，把 `hooks.json` 放到 `~/.dsh/hooks/` 就行。

> 配置只在插件启动时读一次，改完要重启桌面端。

## 命令契约

与 Claude Code 一致：

| 情况 | 含义 |
|---|---|
| stdin | 一行 JSON，含 `hook_event_name` / `session_id` / `cwd` 及事件字段 |
| exit 0 + stdout JSON | 决策对象（见下） |
| exit 0 + stdout 纯文本 | 当作要注入的上下文 |
| exit 2 | 阻断，stderr 作为理由 |
| 其他非零 | 非阻断错误，只记日志 |

决策对象的三种写法（都支持）：

```jsonc
// 1. 新式：按事件给专用字段
{ "hookSpecificOutput": { "additionalContext": "注入的文本" } }
{ "hookSpecificOutput": { "permissionDecision": "deny", "permissionDecisionReason": "理由" } }

// 2. 旧式：通用阻断
{ "decision": "block", "reason": "理由" }

// 3. 通用叫停
{ "continue": false, "stopReason": "理由" }
```

各事件收到的字段：

| 事件 | payload 附加字段 |
|---|---|
| `SessionStart` | `source`: `startup` / `resume` / `clear` / `compact` |
| `UserPromptSubmit` | `prompt` |
| `PreToolUse` / `PostToolUse` | `tool_name`、`tool_input`；Post 另带 `tool_response: { isError, text }` |
| `Stop` | `stop_hook_active`（true = 这次是拦截后重入） |

## 安全边界

- **钩子输出视为不可信数据**：注入时包上下界声明，并 `{{` → `{ {`（宿主 system prompt
  做变量插值，裸 `{{` 会让整轮请求 throw）。
- **子代理会话不跑钩子**，避免委派指令污染上下文、重复计费。
- **失败不冒泡**：命令不存在、超时、非零退出都只记日志，绝不影响会话。
- **Stop 有上限**：默认同一轮最多拦 1 次，钩子写错不会死循环。
- **零宿主 import**：只依赖 `node:` 内置模块，宿主升级不会因 `@deepseek-ai/*` 路径变化而炸。

## 示例

`examples/` 下五个可直接用的脚本，覆盖全部五个事件：

- `greet.mjs` — SessionStart 注入固定约定
- `recall.mjs` — 用户提到关键词时补上下文
- `guard-danger.mjs` — 拦 `rm -rf /`、`git push --force`、`DROP TABLE`
- `after-edit.mjs` — 改完文件提醒跑校验
- `stop-nudge.mjs` — 收尾前自省提醒

`examples/hooks.json` 是配套配置模板。

## 自检

```bash
node _smoke.mjs
```

18 项断言，覆盖五个事件、全部决策分支、防自锁、子代理隔离、转义与容错。

## 与官方桥接包的区别

官方有 `@deepseek-ai/dsh-hooks-claude-code`（同思路，更完整）。这个包是和它独立发展的
最小实现，差别在：

- 零宿主 `import`（官方包 `import` 了 `@deepseek-ai/cordis` / `dsh-llm` / `dsh-hook-protocol`，
  在 profile 下可能解析不到）
- 同时支持新旧两套决策协议
- Stop 内置次数上限

如果你的环境能正常解析那些包，用官方包更省事；如果装不上，这个包是替代品。

## 许可

MIT

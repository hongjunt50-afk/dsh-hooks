// PreToolUse 示例：拦下明显危险的 shell 命令。
//
// 契约：输出 { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason } }
// 会让这次工具调用直接失败并把理由回给模型；什么都不输出就是放行。
// 另一个等价写法是打印理由到 stderr 并以 exit 2 退出。
const payload = await readStdin()
const command = String(payload.tool_input?.command ?? '')

const RULES = [
  { re: /\brm\s+-rf?\s+[\/~]/i, why: '禁止递归删除根目录或家目录' },
  { re: /\bgit\s+push\b.*--force\b/i, why: '禁止强制推送（会覆盖远端历史）' },
  { re: /\b(DROP|TRUNCATE)\s+TABLE\b/i, why: '禁止直接删除数据表' },
]

for (const rule of RULES) {
  if (!rule.re.test(command)) continue
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: `${rule.why}：${command.slice(0, 120)}`,
      },
    }),
  )
  break
}

async function readStdin() {
  let raw = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) raw += chunk
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

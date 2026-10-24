// SessionStart 示例：会话启动时注入一段固定提示。
//
// 契约：stdin 收到一行 JSON，把要注入的文本打到 stdout 即可（纯文本，
// 不是 JSON 也没关系——非 JSON 的 stdout 会被当成上下文注入）。
const payload = await readStdin()
if (payload.source === 'startup') {
  console.log('本机约定：代码相关文件放 F:/AI/projects/，临时验证放 F:/AI/workspace/temp-workspace/。')
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

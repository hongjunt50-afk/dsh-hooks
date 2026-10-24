// PostToolUse 示例：改完文件后提醒跑校验。
//
// 契约：输出纯文本或 { hookSpecificOutput: { additionalContext } }，
// 都会作为上下文注入。工具执行失败时 payload.tool_response.isError 为 true。
const payload = await readStdin()
const failed = payload.tool_response?.isError === true
const target = payload.tool_input?.file_path ?? payload.tool_input?.path ?? payload.tool_name ?? '文件'

if (failed) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `${target} 执行失败，先读报错原文定位原因，不要猜。`,
      },
    }),
  )
} else if (payload.tool_name) {
  console.log(`已修改 ${target}，如有测试请跑一遍再声称完成。`)
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

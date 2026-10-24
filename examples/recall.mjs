// UserPromptSubmit 示例：用户提到关键词时，补一段上下文。
//
// 契约：输出 JSON { hookSpecificOutput: { additionalContext: "..." } }
// 会作为上下文注入到下一步请求；也可以用 { decision: 'block', reason } 拦下这条提示。
const payload = await readStdin()
const prompt = String(payload.prompt ?? '')

if (prompt.includes('知识库')) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        additionalContext:
          '知识库位置：F:/AI/knowledge-base。检索优先用 kb_search 或 `zg query`，不要凭印象作答。',
      },
    }),
  )
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

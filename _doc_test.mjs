/**
 * 设置页增删改逻辑的单元测试。
 *
 * client.js 里的 parseDoc / buildText / asEntry / toEntry 是纯函数，
 * 但封在 factory 闭包里拿不到——这里从源码里抠出这几个函数单独跑。
 * 好处是测的是真代码，不是复制的副本；改坏了会立刻红。
 *
 * 运行：node _doc_test.mjs
 */
import { readFileSync } from 'node:fs'

let failures = 0
function ok(name, cond, extra) {
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${extra !== undefined ? ' — ' + extra : ''}`)
  }
}
function eq(name, actual, expect) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expect), `实际 ${JSON.stringify(actual)} ≠ 期望 ${JSON.stringify(expect)}`)
}

const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

// 把要测的函数从源码里原样抠出来（保住「测的是真代码」这个性质）。
function grab(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`源码里找不到 function ${name}`)
  // 从函数首字符开始，按大括号配平找结尾。
  let i = src.indexOf('{', start)
  if (i < 0) throw new Error(`${name} 没有函数体`)
  let depth = 0
  for (let j = i; j < src.length; j++) {
    const ch = src[j]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, j + 1)
    }
  }
  throw new Error(`${name} 大括号不配平`)
}

const EVENT_ALL = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
const code = [
  `const EVENT_ALL = ${JSON.stringify(EVENT_ALL)};`,
  grab('parseDoc'),
  grab('buildText'),
  grab('asEntry'),
  grab('toEntry'),
  'return { parseDoc, buildText, asEntry, toEntry };',
].join('\n')
const { parseDoc, buildText, asEntry, toEntry } = new Function(code)()

console.log('dsh-hooks 设置页增删改逻辑测试')

// ── 1. 读「外层 hooks」包装格式（推荐写法，也是本机实际用的） ──────────
const wrapped = JSON.stringify({
  _comment: '全局钩子配置',
  hooks: {
    PreToolUse: [{ matcher: 'pwsh', command: 'node a.mjs', timeoutMs: 5000 }],
    Stop: ['node b.mjs'],
  },
})
const d1 = parseDoc(wrapped)
eq('包装格式：hooks 里是两个事件', Object.keys(d1.hooks), ['PreToolUse', 'Stop'])
eq('包装格式：_comment 进 extra 不进 hooks', Object.keys(d1.extra), ['_comment'])
ok('包装格式：短写法的字符串条目原样保留', d1.hooks.Stop[0] === 'node b.mjs')

// ── 2. 读「省略外层 hooks」的旧格式 ──────────────────────────────────
const bare = JSON.stringify({ _comment: 'x', PreToolUse: [{ command: 'node c.mjs' }] })
const d2 = parseDoc(bare)
eq('旧格式：只把事件键当钩子', Object.keys(d2.hooks), ['PreToolUse'])
eq('旧格式：_comment 归 extra', Object.keys(d2.extra), ['_comment'])

// ── 3. 往返：读出来再写回去，内容语义不变 ────────────────────────────
const round1 = parseDoc(buildText(parseDoc(wrapped).hooks, parseDoc(wrapped).extra))
eq('往返：_comment 仍在 extra', round1.extra._comment, '全局钩子配置')
eq('往返：事件集合不变', Object.keys(round1.hooks).sort(), ['PreToolUse', 'Stop'])
ok('往返：字符串条目没被改成对象', typeof round1.hooks.Stop[0] === 'string')

// ── 4. 空文件 / 空白 / 非法内容 ──────────────────────────────────────
eq('空串：得到空 hooks', parseDoc('').hooks, {})
eq('纯空白：得到空 hooks', parseDoc('   \n ').hooks, {})
let threw = false
try { parseDoc('{不是json') } catch { threw = true }
ok('坏 JSON：上层能捕获到异常', threw)

// ── 5. asEntry 归一 ──────────────────────────────────────────────────
eq('asEntry 字符串', asEntry('node x.mjs'), { command: 'node x.mjs', matcher: '', timeoutMs: 0, disabled: false })
eq('asEntry 对象', asEntry({ command: 'c', matcher: 'Write|Edit', timeoutMs: 3000, disabled: true }), {
  command: 'c', matcher: 'Write|Edit', timeoutMs: 3000, disabled: true,
})
eq('asEntry 缺失字段补默认', asEntry({ command: 'c' }), { command: 'c', matcher: '', timeoutMs: 0, disabled: false })

// ── 6. toEntry 序列化：空字段不落盘 ──────────────────────────────────
eq('toEntry 只留 command', toEntry({ command: 'c', matcher: '', timeoutMs: 0, disabled: false }), { command: 'c' })
eq('toEntry 带 matcher', toEntry({ command: 'c', matcher: 'X', timeoutMs: 0, disabled: false }), { command: 'c', matcher: 'X' })
eq('toEntry 停用标记', toEntry({ command: 'c', matcher: '', timeoutMs: 0, disabled: true }), { command: 'c', disabled: true })

// ── 7. 模拟「添加一条」全链路：改完的文件必须是合法 JSON 且能被再次读回 ──
{
  const doc = parseDoc(wrapped)
  const next = JSON.parse(JSON.stringify(doc.hooks))
  next.SessionStart = [toEntry({ command: 'node prime.mjs', matcher: '', timeoutMs: 0, disabled: false })]
  const text = buildText(next, doc.extra)
  let parsed = null
  try { parsed = JSON.parse(text) } catch (e) { ok('添加后是合法 JSON', false, e.message) }
  ok('添加后是合法 JSON', parsed !== null)
  const back = parseDoc(text)
  eq('添加后事件齐全', Object.keys(back.hooks).sort(), ['PreToolUse', 'SessionStart', 'Stop'])
  eq('添加的那条内容正确', asEntry(back.hooks.SessionStart[0]), {
    command: 'node prime.mjs', matcher: '', timeoutMs: 0, disabled: false,
  })
}

// ── 8. 模拟「停用一条」再「删除一条」 ────────────────────────────────
{
  const doc = parseDoc(wrapped)
  const next = JSON.parse(JSON.stringify(doc.hooks))
  next.PreToolUse[0] = toEntry({ ...asEntry(next.PreToolUse[0]), disabled: true })
  const back = parseDoc(buildText(next, doc.extra))
  eq('停用后仍留在配置里（可再启用）', back.hooks.PreToolUse.length, 1)
  eq('停用标记落盘', back.hooks.PreToolUse[0].disabled, true)
}
{
  const doc = parseDoc(wrapped)
  const next = JSON.parse(JSON.stringify(doc.hooks))
  next.PreToolUse.splice(0, 1)
  if (next.PreToolUse.length === 0) delete next.PreToolUse
  const back = parseDoc(buildText(next, doc.extra))
  ok('删空的事件不再出现在配置里', !('PreToolUse' in back.hooks))
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)

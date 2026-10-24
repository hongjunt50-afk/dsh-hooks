import { readFileSync, writeFileSync, copyFileSync, statSync, unlinkSync, existsSync } from 'node:fs'

const src = readFileSync('lib/index.js', 'utf8')
function grab(name) {
  const i = src.indexOf('function ' + name)
  if (i < 0) throw new Error('not found: ' + name)
  let d = 0, j = src.indexOf('{', i)
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1) }
  }
}
const DEFAULT_TIMEOUT_MS = 30000
const normalize = eval('(' + grab('normalize') + ')')
const loadConfigFile = eval('(' + grab('loadConfigFile') + ')')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m) } else { fail++; console.log('  FAIL ' + m) } }

// --- 模拟 apply 内部的三件套：fileStamp / syncTable / table ---
const configFile = 'F:/AI/workspace/temp-workspace/_hooks_probe.json'
writeFileSync(configFile, JSON.stringify({ hooks: {
  PreToolUse: [{ command: 'node a.mjs', matcher: 'pwsh' }],
  Stop: [{ command: 'node b.mjs' }],
} }), 'utf8')

const fileStamp = () => {
  try {
    if (!configFile || !existsSync(configFile)) return 'missing'
    const st = statSync(configFile)
    return `${st.mtimeMs}:${st.size}`
  } catch { return 'error' }
}

let table = {}
let lastError = ''
let stamp = fileStamp()
const readTable = () => loadConfigFile(configFile)
const syncTable = () => {
  const now = fileStamp()
  if (now === stamp) return
  stamp = now
  try { table = readTable(); lastError = '' }
  catch (err) { lastError = err instanceof Error ? err.message : String(err) }
}

table = readTable()
console.log('外部改配置后的同步')
ok(Object.keys(table).length === 2, '启动读到 2 个事件')
ok(fileStamp() === stamp, '启动后 stamp 已对齐')

// 1. 没改文件 → 不该重读（用副作用证明：把 table 改脏，sync 后应保持脏）
table = { __sentinel: [] }
syncTable()
ok(table.__sentinel !== undefined, '文件没变时 syncTable 不重读（脏表保留）')

// 2. 外部改了文件 → 必须重读
writeFileSync(configFile, JSON.stringify({ hooks: {
  PreToolUse: [{ command: 'node a.mjs', matcher: 'pwsh' }],
  Stop: [{ command: 'node b.mjs' }],
  PostToolUse: [{ command: 'node c.mjs' }],
} }), 'utf8')
syncTable()
ok(Object.keys(table).length === 3 && table.__sentinel === undefined, '文件变了 → 重读，旧表被替换')
ok(Object.keys(table).includes('PostToolUse'), '新加的事件出现在表里')

// 3. 外部写坏 JSON → 保留旧表 + 记错误
const before = JSON.stringify(table)
writeFileSync(configFile, '{ broken json', 'utf8')
syncTable()
ok(JSON.stringify(table) === before, '写坏 JSON 时旧表保持不动（旧钩子继续生效）')
ok(lastError.length > 0, '写坏 JSON 时 lastError 有内容')

// 4. 文件被删 → stamp 变 missing，不崩。语义上"文件没了 = 没有钩子"，
//    是合法空态而不是错误，所以 lastError 应被清空、表应为空。
unlinkSync(configFile)
syncTable()
ok(Object.keys(table).length === 0, '文件删除后表为空')
ok(lastError === '', '文件删除算合法空态，不记为错误')

// 5. 删除后恢复 → 能重新读
writeFileSync(configFile, JSON.stringify({ hooks: { Stop: [{ command: 'node b.mjs' }] } }), 'utf8')
syncTable()
ok(Object.keys(table).length === 1 && lastError === '', '文件恢复后重新生效且 lastError 清空')

unlinkSync(configFile)
console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)

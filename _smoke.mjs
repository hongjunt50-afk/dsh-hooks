// 冒烟测试：不依赖宿主，用假 ctx 驱动插件，跑通五个事件与全部决策分支。
// 运行：node _smoke.mjs     （退出码 0 = 全绿）
//
// 钩子命令一律写成临时 .mjs 文件再用 `node <file>` 调用，不用 `node -e`：
// 后者经 cmd.exe 会按控制台代码页重编码，含中文的判别逻辑会被打乱，
// 测试就会假失败（这个坑已经踩过一次）。

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from './lib/index.js'

let pass = 0
let fail = 0

function check(label, cond, extra) {
  if (cond) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${extra ? `  ← ${extra}` : ''}`)
  }
}

function makeCtx() {
  const listeners = new Map()
  const logs = []
  const ctx = {
    on(event, handler) {
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
      return () => {}
    },
    logger: { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]) },
  }
  const emit = async (event, ...args) => {
    const list = listeners.get(event) ?? []
    if (!list.length) return undefined
    return list[0](...args)
  }
  return { ctx, emit, logs }
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-smoke-'))
let seq = 0
/** 写一个临时钩子脚本，返回可直接执行的命令行。 */
function hook(source) {
  const file = join(dir, `h${++seq}.mjs`)
  writeFileSync(file, source, 'utf8')
  return `node "${file}"`
}

// 读 stdin 全量再回调的小工具，注入到每个脚本开头。
const READ = `const read=(f)=>new Promise((r)=>{let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',(c)=>s+=c);process.stdin.on('end',()=>r(JSON.parse(s||'{}')))});\n`

const cfgFile = join(dir, 'hooks.json')
writeFileSync(
  cfgFile,
  JSON.stringify({
    hooks: {
      SessionStart: [hook(`${READ}read().then(()=>console.log('SESSION-HELLO'))`)],
      UserPromptSubmit: [
        hook(
          `${READ}read().then((p)=>{` +
            `if(p.prompt.includes('BLOCK')) console.log(JSON.stringify({decision:'block',reason:'提示被拦'}));` +
            `else console.log(JSON.stringify({hookSpecificOutput:{additionalContext:'USER-CTX:'+p.prompt}}))})`,
        ),
      ],
      PreToolUse: [
        {
          matcher: 'pwsh|shell',
          command: hook(
            `${READ}read().then((p)=>{` +
              `const cmd=String(p.tool_input&&p.tool_input.command||'');` +
              `if(cmd.includes('rm -rf')){` +
              `console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'禁止递归删除'}}));return}` +
              `if(p.tool_name==='pwsh') process.exit(2)})`,
          ),
        },
      ],
      PostToolUse: [hook(`${READ}read().then(()=>console.log('POST-CTX'))`)],
      Stop: [hook(`${READ}read().then(()=>console.log('STOP-NUDGE'))`)],
    },
  }),
  'utf8',
)

const { ctx, emit } = makeCtx()
apply(ctx, { configFile: cfgFile, stopBlockLimit: 2 })

const session = { id: 'sess-1', header: {} }
const agent = { id: 'sess-1', session }

async function assemble(sessionObj = session) {
  const downstream = await emit(
    'system-prompt/assemble',
    { contexts: [] },
    { agent: { session: sessionObj } },
    async () => ({ contexts: [] }),
  )
  return downstream.contexts.map((c) => c.text).join('\n')
}

const nextAllow = async () => ({ kind: 'allow' })
const nextEnter = async () => ({ kind: 'enter', messages: [] })

console.log('\nSessionStart')
await emit('agent/created', { agent, source: 'startup' })
let out = await assemble()
check('注入 SESSION-HELLO', out.includes('SESSION-HELLO'), out)
check('包了不可信边界', out.includes('不可信数据'))
out = await assemble()
check('第二次 assemble 不重复注入（只消费一次）', !out.includes('SESSION-HELLO'))

console.log('\nUserPromptSubmit')
await emit(
  'agent/pre-step',
  { agent, messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }], turn: 1, step: 1 },
  nextEnter,
)
out = await assemble()
check('注入 USER-CTX', out.includes('USER-CTX:你好'), out)

const blocked = await emit(
  'agent/pre-step',
  { agent, messages: [{ role: 'user', content: [{ type: 'text', text: 'BLOCK 这个' }] }], turn: 1, step: 1 },
  nextEnter,
)
check('decision:block → reject', blocked?.kind === 'reject', JSON.stringify(blocked))

console.log('\nPreToolUse')
const deny = await emit(
  'tools/pre-execute',
  { name: 'shell', arguments: { command: 'rm -rf /tmp/x' }, agent, signal: new AbortController().signal },
  nextAllow,
)
check('命中 matcher 且 rm -rf → deny', deny?.kind === 'deny' && deny.reason.includes('递归删除'), JSON.stringify(deny))

const exit2 = await emit(
  'tools/pre-execute',
  { name: 'pwsh', arguments: { command: 'ls' }, agent, signal: new AbortController().signal },
  nextAllow,
)
check('exit 2 → deny', exit2?.kind === 'deny', JSON.stringify(exit2))

const skipped = await emit(
  'tools/pre-execute',
  { name: 'read', arguments: { path: 'x' }, agent, signal: new AbortController().signal },
  nextAllow,
)
check('matcher 不匹配 → 放行', skipped?.kind === 'allow', JSON.stringify(skipped))

console.log('\nPostToolUse')
await emit(
  'tools/post-execute',
  { name: 'read', arguments: {}, agent, signal: new AbortController().signal },
  { isError: false, content: [{ type: 'text', text: 'file body' }] },
  async () => ({ kind: 'accept' }),
)
out = await assemble()
check('注入 POST-CTX', out.includes('POST-CTX'), out)

console.log('\nStop（防自锁）')
const turnStart = () => emit('session/event', session, { type: 'turn/start' })
await turnStart()
await emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
out = await assemble()
check('第一次 Stop 注入 STOP-NUDGE', out.includes('STOP-NUDGE'), out)

await emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
out = await assemble()
check('第二次 Stop 仍注入（上限 2）', out.includes('STOP-NUDGE'), out)

await emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
out = await assemble()
check('第三次 Stop 被上限拦住（assemble 不清零计数）', !out.includes('STOP-NUDGE'), out)

await turnStart()
await emit('agent/turn-stopping', { agent, turn: 2, signal: new AbortController().signal })
out = await assemble()
check('新一轮 turn/start 后计数归零、重新可拦', out.includes('STOP-NUDGE'), out)

console.log('\n子代理隔离')
const subSession = { id: 'sub-1', header: { origin: 'subagent' } }
const subAgent = { id: 'sub-1', session: subSession }
await emit('agent/created', { agent: subAgent, source: 'startup' })
out = await assemble(subSession)
check('子会话不注入 SessionStart', !out.includes('SESSION-HELLO'), out)

console.log('\n转义与容错')
const { ctx: ctx2, emit: emit2 } = makeCtx()
apply(ctx2, {
  hooks: { UserPromptSubmit: [hook(`${READ}read().then(()=>console.log('含 {{变量}} 的文本'))`)] },
})
await emit2(
  'agent/pre-step',
  { agent, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], turn: 1, step: 1 },
  nextEnter,
)
const down2 = await emit2('system-prompt/assemble', {}, { agent: { session } }, async () => ({ contexts: [] }))
const text2 = down2.contexts.map((c) => c.text).join('')
check('{{ 被拆开（避免宿主插值 throw）', text2.includes('{ {变量'), text2)

const { ctx: ctx3, emit: emit3 } = makeCtx()
apply(ctx3, { hooks: { Stop: ['command-that-does-not-exist-xyz'] } })
let threw = false
try {
  await emit3('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
} catch {
  threw = true
}
check('钩子命令不存在也不冒泡异常', !threw)

const { ctx: ctx4, emit: emit4 } = makeCtx()
// 显式指向不存在的配置，避免读到本机 ~/.dsh/hooks/hooks.json 造成测试不稳定。
apply(ctx4, { configFile: join(dir, 'definitely-missing.json') })
let idleOk = false
try {
  await emit4('agent/created', { agent, source: 'startup' })
  const down = await emit4('system-prompt/assemble', { contexts: [] }, { agent: { session } }, async () => ({
    contexts: [],
  }))
  // 无配置时插件不注册任何监听，emit 返回 undefined 即为安全空转。
  idleOk = down === undefined
} catch {
  idleOk = false
}
check('无配置时安全空转（不注册监听、不抛错）', idleOk)

const { ctx: ctx5, emit: emit5 } = makeCtx()
apply(ctx5, { disabled: true })
check('disabled:true 时不注册任何监听', (ctx5.__count ?? 0) === 0)

rmSync(dir, { recursive: true, force: true })

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exitCode = 1

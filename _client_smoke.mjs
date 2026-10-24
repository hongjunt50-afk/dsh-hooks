/**
 * client.js 冒烟测试：用 React/Cordis stub 跑一遍 factory，
 * 确认两处 slot 都注册上了，且组件能渲染成树（不触发 hooks，只验结构）。
 *
 * 运行：node _client_smoke.mjs
 */
import { readFileSync } from 'node:fs'

let failures = 0
function ok(name, cond, extra) {
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`)
  }
}

// ── React stub ──────────────────────────────────────────────────────────
const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children } }
  },
  useState(init) {
    let v = typeof init === 'function' ? init() : init
    return [v, (next) => { v = typeof next === 'function' ? next(v) : next }]
  },
  useEffect() {},
  useCallback(fn) { return fn },
  useRef(init) { return { current: init } },
}

// ── window / loader stub ────────────────────────────────────────────────
const registered = []
let loadedId = ''
const listeners = {}

globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loadedId = spec.id
      const exportsObj = spec.factory((name) => {
        if (name === 'react') return React
        throw new Error(`unexpected require(${name})`)
      })
      registered.push(exportsObj)
    },
  },
}

// ── slots stub ──────────────────────────────────────────────────────────
const slotRegistrations = []
const slots = {
  inject(name, fn) { fn() },
  register(def, Component) { slotRegistrations.push({ def, Component }) },
}

const ctx = { get: (name) => (name === 'slots' ? slots : undefined) }

// ── 跑 ──────────────────────────────────────────────────────────────────
console.log('dsh-hooks client.js 冒烟测试')
const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
// client.js 是浏览器脚本，靠 window.__ModuleLoader__；用 indirect eval 在全局跑。
new Function(src)()

ok('loader id 是包名', loadedId === '@dsh-external/dsh-hooks', `实际 ${loadedId}`)
ok('factory 返回了插件对象', registered.length === 1)
const plugin = registered[0] || {}
ok('导出了 apply', typeof plugin.apply === 'function')
ok('inject 含 slots', Array.isArray(plugin.inject) && plugin.inject.includes('slots'))

plugin.apply(ctx)
const names = slotRegistrations.map((r) => r.def.name)
console.log(`  注册槽位: ${names.join(', ') || '（无）'}`)
ok('注册了消息工具栏', names.includes('conversation.chat.assistant-actions'))
ok('注册了设置页', names.includes('settings.section'))
ok('两个组件的 def 都带 id', slotRegistrations.every((r) => !!r.def.id))
ok('两个组件都是函数组件', slotRegistrations.every((r) => typeof r.Component === 'function' || typeof r === 'function'))

// 渲染一次，确认不会在构造期抛（hooks 用 stub 不会触发）
for (const { def, Component } of slotRegistrations) {
  try {
    const Comp = typeof Component === 'function' ? Component : null
    // 设置页的坑：register 传的是 () => React.createElement(HooksSettings)，是个薄包装
    const el = Comp({ sessionId: 'test-session' })
    ok(`组件可渲染: ${def.name}`, el != null && typeof el === 'object')
    ok(`  渲染结果 type 合理: ${def.name}`, typeof el.type === 'string' || typeof el.type === 'function')
  } catch (e) {
    ok(`组件可渲染: ${def.name}`, false, e instanceof Error ? e.message : String(e))
  }
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)

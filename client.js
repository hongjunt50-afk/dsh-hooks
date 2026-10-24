/**
 * dsh-hooks —— Client 半边（浏览器）。
 *
 * 两处 UI：
 *   1. conversation.chat.assistant-actions —— 每条回复下方的「钩子」入口，
 *      悬停/点击展开本会话最近触发的钩子记录（对齐 ZCode 消息级 hook 气泡）。
 *   2. settings.section —— 「钩子」设置页：直接编辑 hooks.json、保存即生效（热重载）、
 *      查看运行记录与最后错误。
 *
 * 数据全部来自 Host 半边的 HTTP 路由 /dsh-hooks-api（见 lib/index.js）。
 * 注册 id 必须等于 loader entry 名（包名），否则 ModuleLoader 报
 * "loaded without registering <name>"。
 */
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-hooks',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const API = '/dsh-hooks-api'

    const EVENT_LABEL = {
      SessionStart: '会话开始',
      UserPromptSubmit: '提交提示词',
      PreToolUse: '工具调用前',
      PostToolUse: '工具调用后',
      Stop: '收尾',
    }

    const EVENT_DESC = {
      SessionStart: '新会话建立时注入上下文',
      UserPromptSubmit: '每条提示词发出前可拦截或补充',
      PreToolUse: '工具执行前可放行 / 阻断',
      PostToolUse: '工具执行后回注上下文',
      Stop: '模型想收尾时可以把话递回去',
    }

    const CSS = [
      '.hk-wrap{position:relative;display:inline-flex;align-items:center}',
      '.hk-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.hk-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.hk-btn[data-active="true"]{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.hk-badge{min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:10px;line-height:15px;text-align:center;font-variant-numeric:tabular-nums}',
      // 浮层必须 position:fixed —— 消息列表容器有 overflow 裁剪，absolute 会被切掉。
      '.hk-pop{position:fixed;z-index:2147483000;width:380px;max-height:50vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.28);padding:8px;text-align:left;box-sizing:border-box}',
      '.hk-pop-head{display:flex;align-items:center;justify-content:space-between;padding:2px 6px 8px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em}',
      '.hk-row{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:7px;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.hk-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.hk-dot{flex:none;width:6px;height:6px;border-radius:50%;margin-top:5px;background:var(--dsw-alias-border-l1)}',
      '.hk-dot[data-state="ok"]{background:#2f9e5f}',
      '.hk-dot[data-state="deny"]{background:#c9453d}',
      '.hk-dot[data-state="ctx"]{background:#247bbf}',
      '.hk-dot[data-state="fail"]{background:#c9453d}',
      '.hk-main{flex:1;min-width:0}',
      '.hk-name{display:flex;align-items:center;gap:6px;font-weight:500}',
      '.hk-tag{flex:none;font-size:10px;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.hk-meta{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.hk-empty{padding:18px 8px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.hk-sec{display:flex;flex-direction:column;gap:14px;padding:4px 0;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.hk-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px}',
      '.hk-card h4{margin:0 0 4px;font-size:13px;font-weight:600}',
      '.hk-card p{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}',
      '.hk-path{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.hk-ev{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);margin-top:8px}',
      '.hk-ev[data-on="true"]{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,transparent)}',
      '.hk-ev-head{display:flex;align-items:center;gap:8px}',
      '.hk-ev-name{font-weight:600;font-size:12px}',
      '.hk-ev-desc{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.hk-ev-cnt{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      // 单条钩子
      '.hk-item{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:12px}',
      '.hk-item[data-off="true"]{opacity:.55}',
      '.hk-item-main{flex:1;min-width:0}',
      '.hk-item-cmd{font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.45;word-break:break-all;white-space:pre-wrap}',
      '.hk-item-sub{margin-top:2px;font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.hk-mini{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;padding:0}',
      '.hk-mini:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}',
      '.hk-mini[data-on="true"]{color:#2f9e5f;border-color:color-mix(in srgb,#2f9e5f 50%,transparent)}',
      // 添加表单
      '.hk-form{display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:7px;border:1px dashed var(--dsw-alias-border-l1)}',
      '.hk-form-row{display:flex;align-items:center;gap:8px}',
      '.hk-lbl{flex:none;width:70px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.hk-inp{flex:1;min-width:0;box-sizing:border-box;padding:5px 8px;font-size:12px;font-family:ui-monospace,Consolas,monospace;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);outline:none}',
      '.hk-inp:focus{border-color:var(--dsw-alias-brand-primary)}',
      'textarea.hk-inp{min-height:52px;resize:vertical;line-height:1.5}',
      '.hk-empty-sm{padding:6px 2px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.hk-editor{width:100%;box-sizing:border-box;min-height:260px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.55;padding:10px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);outline:none}',
      '.hk-editor:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.hk-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}',
      '.hk-act{padding:5px 14px;font-size:13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.hk-act:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.hk-act[data-primary="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.hk-act:disabled{opacity:.5;cursor:default}',
      '.hk-note{font-size:12px;padding:7px 10px;border-radius:8px;line-height:1.5}',
      '.hk-note[data-kind="ok"]{background:color-mix(in srgb,#2f9e5f 14%,transparent);color:#2f9e5f}',
      '.hk-note[data-kind="err"]{background:color-mix(in srgb,#c9453d 14%,transparent);color:#c9453d}',
      '.hk-runs{max-height:260px;overflow:auto;margin-top:8px}',
    ].join('\n')

    // ── HTTP ────────────────────────────────────────────────────────────
    async function apiGet(sessionId) {
      const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
      const res = await fetch(API + qs, { headers: { accept: 'application/json' } })
      const data = await res.json().catch(() => ({ ok: false, error: '响应不是合法 JSON' }))
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    }

    async function apiPost(body) {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({ ok: false, error: '响应不是合法 JSON' }))
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    }

    function relTime(ts) {
      const d = Date.now() - ts
      if (d < 60000) return `${Math.max(1, Math.round(d / 1000))} 秒前`
      if (d < 3600000) return `${Math.round(d / 60000)} 分钟前`
      if (d < 86400000) return `${Math.round(d / 3600000)} 小时前`
      return new Date(ts).toLocaleString()
    }

    function stateOf(run) {
      if (run.error) return 'fail'
      if (run.status === 'deny') return 'deny'
      if (run.context) return 'ctx'
      return 'ok'
    }

    function runTitle(run) {
      const ev = EVENT_LABEL[run.event] || run.event
      return run.tool ? `${ev} · ${run.tool}` : ev
    }

    function runSummary(run) {
      if (run.error) return run.error
      if (run.status === 'deny') return run.reason || '已阻断'
      if (run.context) return run.context
      return `${run.cmdCount} 条命令，耗时 ${run.ms}ms`
    }

    // ── 消息工具栏入口 ──────────────────────────────────────────────────
    function HookActions(props) {
      const sessionId = props && props.sessionId
      const [open, setOpen] = useState(false)
      const [runs, setRuns] = useState([])
      const [err, setErr] = useState('')
      // 浮层坐标：position:fixed + 按钮的视口矩形，绕开消息容器的 overflow 裁剪。
      const [pos, setPos] = useState(null)
      const timer = useRef(null)
      const box = useRef(null)
      const btn = useRef(null)

      const load = useCallback(async () => {
        if (!sessionId) return
        try {
          const data = await apiGet(sessionId)
          setRuns(data.runs || [])
          setErr('')
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e))
        }
      }, [sessionId])

      // 量按钮位置。上方放不下就翻到下方，左右再夹回视口内。
      const place = useCallback(() => {
        const el = btn.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const W = 380
        const H = Math.min(Math.round(window.innerHeight * 0.5), 340)
        const gap = 6
        const above = r.top - gap - H
        const top = above >= 8 ? above : Math.min(r.bottom + gap, window.innerHeight - H - 8)
        let left = r.right - W
        left = Math.max(8, Math.min(left, window.innerWidth - W - 8))
        setPos({ top: Math.max(8, top), left })
      }, [])

      useEffect(() => {
        if (!open) return undefined
        load()
        place()
        const id = setInterval(load, 3000)
        // 滚动/缩放时重算，否则消息列表一滚浮层就飘走。
        const onMove = () => place()
        window.addEventListener('scroll', onMove, true)
        window.addEventListener('resize', onMove)
        return () => {
          clearInterval(id)
          window.removeEventListener('scroll', onMove, true)
          window.removeEventListener('resize', onMove)
        }
      }, [open, load, place])

      useEffect(() => {
        if (!open) return undefined
        const onDocDown = (ev) => {
          if (box.current && !box.current.contains(ev.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onDocDown)
        return () => document.removeEventListener('mousedown', onDocDown)
      }, [open])

      useEffect(() => () => clearTimeout(timer.current), [])

      const recent = runs.slice(-30).reverse()

      return h(
        'span',
        {
          className: 'hk-wrap',
          ref: box,
          onMouseEnter: () => {
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setOpen(true), 120)
          },
          onMouseLeave: () => {
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setOpen(false), 220)
          },
        },
        h('style', null, CSS),
        h(
          'button',
          {
            className: 'hk-btn',
            ref: btn,
            type: 'button',
            title: '钩子运行记录',
            'aria-label': '钩子',
            'data-active': open ? 'true' : 'false',
            onClick: () => setOpen((v) => !v),
          },
          '🪝',
          runs.length ? h('span', { className: 'hk-badge' }, String(runs.length > 99 ? '99+' : runs.length)) : null,
        ),
        open && pos
          ? h(
              'div',
              { className: 'hk-pop', style: { top: pos.top + 'px', left: pos.left + 'px' } },
              h('div', { className: 'hk-pop-head' }, h('span', null, '本会话钩子'), h('span', null, `${runs.length} 次`)),
              err ? h('div', { className: 'hk-note', 'data-kind': 'err' }, err) : null,
              recent.length === 0
                ? h('div', { className: 'hk-empty' }, err ? '' : '还没有钩子被触发')
                : h(
                    'div',
                    null,
                    recent.map((run, i) =>
                      h(
                        'div',
                        { className: 'hk-row', key: `${run.ts}-${i}` },
                        h('span', { className: 'hk-dot', 'data-state': stateOf(run) }),
                        h(
                          'div',
                          { className: 'hk-main' },
                          h(
                            'div',
                            { className: 'hk-name' },
                            runTitle(run),
                            h('span', { className: 'hk-tag' }, run.status === 'deny' ? '阻断' : run.ms ? `${run.ms}ms` : '完成'),
                          ),
                          h('div', { className: 'hk-meta', title: runSummary(run) }, runSummary(run)),
                        ),
                      ),
                    ),
                  ),
            )
          : null,
      )
    }

    // ── 配置文档：解析 / 序列化（设置页增删改用） ──────────────────────
    const EVENT_ALL = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']

    /** 把 hooks.json 原文解析成 { hooks, extra }。hooks 里每个事件是原始条目数组。 */
    function parseDoc(text) {
      const raw = String(text || '').trim() ? JSON.parse(text) : {}
      const root = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      const wrapped = root.hooks && typeof root.hooks === 'object' && !Array.isArray(root.hooks)
      // 省略外层 hooks 的旧写法：只有事件名键才当钩子，其余（如 _comment）归 extra，
      // 否则序列化回去会把 _comment 塞进 hooks 里，文件越写越脏。
      const hooks = {}
      const extra = {}
      if (wrapped) {
        for (const [k, v] of Object.entries(root)) {
          if (k === 'hooks') continue
          extra[k] = v
        }
        Object.assign(hooks, root.hooks)
      } else {
        for (const [k, v] of Object.entries(root)) {
          if (EVENT_ALL.includes(k)) hooks[k] = v
          else extra[k] = v
        }
      }
      return { hooks, extra }
    }

    function buildText(hooks, extra) {
      return JSON.stringify({ ...extra, hooks }, null, 2)
    }

    /** 条目可能是字符串或对象，统一读成可编辑形态。 */
    function asEntry(e) {
      if (typeof e === 'string') return { command: e, matcher: '', timeoutMs: 0, disabled: false }
      if (e && typeof e === 'object') {
        return {
          command: typeof e.command === 'string' ? e.command : '',
          matcher: typeof e.matcher === 'string' ? e.matcher : '',
          timeoutMs: Number(e.timeoutMs) || 0,
          disabled: e.disabled === true,
        }
      }
      return { command: '', matcher: '', timeoutMs: 0, disabled: false, invalid: true }
    }

    /** 写回统一用对象形态；空字段不落盘，保持文件干净。 */
    function toEntry(v) {
      const o = { command: v.command }
      if (v.matcher) o.matcher = v.matcher
      if (v.timeoutMs > 0) o.timeoutMs = v.timeoutMs
      if (v.disabled) o.disabled = true
      return o
    }

    // ── 设置页 ──────────────────────────────────────────────────────────
    function HooksSettings() {
      const [info, setInfo] = useState(null)
      const [text, setText] = useState('')
      const [dirty, setDirty] = useState(false)
      const [note, setNote] = useState(null)
      const [busy, setBusy] = useState(false)
      // 正在展开「添加」表单的事件名；null 表示都没展开。
      const [adding, setAdding] = useState(null)
      const [form, setForm] = useState({ command: '', matcher: '', timeoutMs: '' })

      const loadAll = useCallback(async () => {
        try {
          const file = await apiPost({ op: 'readFile' })
          setText((prev) => (dirty ? prev : file.text))
          const data = await apiGet('')
          setInfo(data)
        } catch (e) {
          setNote({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
        }
      }, [dirty])

      useEffect(() => {
        loadAll()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const save = async () => {
        setBusy(true)
        try {
          const res = await apiPost({ op: 'writeFile', text })
          setDirty(false)
          setNote({
            kind: 'ok',
            text: res.lastError ? `已写入，但重载失败：${res.lastError}` : `已保存并生效：${(res.events || []).join('、') || '（无事件）'}`,
          })
          const data = await apiGet('')
          setInfo(data)
        } catch (e) {
          setNote({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
        } finally {
          setBusy(false)
        }
      }

      const reload = async () => {
        setBusy(true)
        try {
          const res = await apiPost({ op: 'reload' })
          setNote({ kind: 'ok', text: `已重载：${(res.events || []).join('、') || '（无事件）'}` })
          const data = await apiGet('')
          setInfo(data)
        } catch (e) {
          setNote({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
        } finally {
          setBusy(false)
        }
      }

      const clear = async () => {
        try {
          await apiPost({ op: 'clearRuns' })
          const data = await apiGet('')
          setInfo(data)
          setNote({ kind: 'ok', text: '运行记录已清空' })
        } catch (e) {
          setNote({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
        }
      }

      // 增删改：改完直接落盘生效，用户不用再去点保存。
      const mutate = async (fn, okText) => {
        let doc
        try {
          doc = parseDoc(text)
        } catch (e) {
          setNote({ kind: 'err', text: `当前配置不是合法 JSON，先修好再操作：${e instanceof Error ? e.message : String(e)}` })
          return
        }
        const next = JSON.parse(JSON.stringify(doc.hooks))
        fn(next)
        const nextText = buildText(next, doc.extra)
        setText(nextText)
        setDirty(false)
        setBusy(true)
        try {
          const res = await apiPost({ op: 'writeFile', text: nextText })
          setNote({ kind: 'ok', text: okText + (res.lastError ? `；但重载失败：${res.lastError}` : '') })
          const data = await apiGet('')
          setInfo(data)
        } catch (e) {
          setNote({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
        } finally {
          setBusy(false)
        }
      }

      const addHook = (ev) => {
        const cmd = form.command.trim()
        if (!cmd) {
          setNote({ kind: 'err', text: '命令不能为空' })
          return
        }
        const entry = toEntry({
          command: cmd,
          matcher: form.matcher.trim(),
          timeoutMs: Number(form.timeoutMs) || 0,
          disabled: false,
        })
        mutate((hooks) => {
          const list = Array.isArray(hooks[ev]) ? hooks[ev].slice() : []
          list.push(entry)
          hooks[ev] = list
        }, `已添加 ${ev} 钩子`)
        setAdding(null)
        setForm({ command: '', matcher: '', timeoutMs: '' })
      }

      const toggleHook = (ev, i) => {
        mutate((hooks) => {
          const list = hooks[ev]
          if (!Array.isArray(list)) return
          const cur = asEntry(list[i])
          list[i] = toEntry({ ...cur, disabled: !cur.disabled })
        }, `已切换 ${ev} 第 ${i + 1} 条`)
      }

      const removeHook = (ev, i) => {
        mutate((hooks) => {
          const list = hooks[ev]
          if (!Array.isArray(list)) return
          list.splice(i, 1)
          if (list.length === 0) delete hooks[ev]
        }, `已删除 ${ev} 第 ${i + 1} 条`)
      }

      const events = info?.events || []
      const counts = info?.counts || {}
      const runs = (info?.runs || []).slice(-40).reverse()

      // 当前配置里每个事件有哪些钩子（含被停用的）
      let doc = { hooks: {}, extra: {} }
      let docErr = ''
      try {
        doc = parseDoc(text)
      } catch (e) {
        docErr = e instanceof Error ? e.message : String(e)
      }

      const renderForm = (ev) =>
        h(
          'div',
          { className: 'hk-form' },
          h(
            'div',
            { className: 'hk-form-row' },
            h('span', { className: 'hk-lbl' }, '命令'),
            h('input', {
              className: 'hk-inp',
              placeholder: 'node F:/AI/scripts/xxx.mjs',
              value: form.command,
              spellCheck: false,
              onChange: (e) => {
                const v = e.target.value
                setForm((f) => ({ ...f, command: v }))
              },
            }),
          ),
          ev === 'PreToolUse' || ev === 'PostToolUse'
            ? h(
                'div',
                { className: 'hk-form-row' },
                h('span', { className: 'hk-lbl' }, '匹配工具'),
                h('input', {
                  className: 'hk-inp',
                  placeholder: '正则，留空 = 全部工具，如 Write|Edit',
                  value: form.matcher,
                  spellCheck: false,
                  onChange: (e) => {
                    const v = e.target.value
                    setForm((f) => ({ ...f, matcher: v }))
                  },
                }),
              )
            : null,
          h(
            'div',
            { className: 'hk-form-row' },
            h('span', { className: 'hk-lbl' }, '超时 ms'),
            h('input', {
              className: 'hk-inp',
              placeholder: '留空用默认',
              value: form.timeoutMs,
              onChange: (e) => {
                const v = e.target.value
                setForm((f) => ({ ...f, timeoutMs: v }))
              },
            }),
          ),
          h(
            'div',
            { className: 'hk-bar', style: { marginTop: 2 } },
            h('button', { className: 'hk-act', 'data-primary': 'true', type: 'button', disabled: busy, onClick: () => addHook(ev) }, '添加'),
            h('button', { className: 'hk-act', type: 'button', disabled: busy, onClick: () => { setAdding(null); setForm({ command: '', matcher: '', timeoutMs: '' }) } }, '取消'),
          ),
        )

      return h(
        'div',
        { className: 'hk-sec' },
        h('style', null, CSS),

        h(
          'div',
          { className: 'hk-card' },
          h('h4', null, '钩子配置'),
          h('p', null, '与 Claude Code 的 hooks.json 格式一致。下面的操作会直接写盘并立即生效，无需重启。'),
          h('div', { className: 'hk-path', style: { marginTop: 6 } }, info?.configFile || '~/.dsh/hooks/hooks.json'),
          note ? h('div', { className: 'hk-note', 'data-kind': note.kind, style: { marginTop: 10 } }, note.text) : null,
          info?.lastError ? h('div', { className: 'hk-note', 'data-kind': 'err', style: { marginTop: 8 } }, info.lastError) : null,
        ),

        docErr
          ? h(
              'div',
              { className: 'hk-card' },
              h('h4', null, '事件'),
              h('div', { className: 'hk-note', 'data-kind': 'err' }, `配置解析失败：${docErr}。请在下方「配置文件」里修正 JSON。`),
            )
          : h(
              'div',
              { className: 'hk-card' },
              h('h4', null, '事件'),
              h('p', null, '每个事件下可以挂多条钩子；开关控制启停，删除才真正移除。'),
              EVENT_ALL.map((ev) => {
                const rawList = Array.isArray(doc.hooks[ev]) ? doc.hooks[ev] : []
                const on = events.includes(ev)
                return h(
                  'div',
                  { className: 'hk-ev', 'data-on': on ? 'true' : 'false', key: ev },
                  h(
                    'div',
                    { className: 'hk-ev-head' },
                    h(
                      'div',
                      { style: { flex: 1, minWidth: 0 } },
                      h('div', { className: 'hk-ev-name' }, `${ev}　${EVENT_LABEL[ev]}`),
                      h('div', { className: 'hk-ev-desc' }, EVENT_DESC[ev]),
                    ),
                    h(
                      'div',
                      { className: 'hk-ev-cnt' },
                      on ? `生效 ${rawList.length} 条 · 已跑 ${counts[ev] || 0} 次` : rawList.length ? `${rawList.length} 条已停用` : '未配置',
                    ),
                  ),
                  rawList.length === 0
                    ? h('div', { className: 'hk-empty-sm' }, '还没有钩子')
                    : rawList.map((raw, i) => {
                        const v = asEntry(raw)
                        return h(
                          'div',
                          { className: 'hk-item', 'data-off': v.disabled ? 'true' : 'false', key: i },
                          h(
                            'div',
                            { className: 'hk-item-main' },
                            h('div', { className: 'hk-item-cmd' }, v.command || '（空命令，不会执行）'),
                            v.matcher || v.timeoutMs
                              ? h(
                                  'div',
                                  { className: 'hk-item-sub' },
                                  [v.matcher ? `匹配 ${v.matcher}` : '', v.timeoutMs ? `超时 ${v.timeoutMs}ms` : ''].filter(Boolean).join(' · '),
                                )
                              : null,
                          ),
                          h(
                            'button',
                            {
                              className: 'hk-mini',
                              type: 'button',
                              title: v.disabled ? '启用' : '停用',
                              'data-on': v.disabled ? 'false' : 'true',
                              disabled: busy,
                              onClick: () => toggleHook(ev, i),
                            },
                            v.disabled ? '○' : '●',
                          ),
                          h(
                            'button',
                            {
                              className: 'hk-mini',
                              type: 'button',
                              title: '删除',
                              disabled: busy,
                              onClick: () => removeHook(ev, i),
                            },
                            '✕',
                          ),
                        )
                      }),
                  adding === ev
                    ? renderForm(ev)
                    : h(
                        'button',
                        {
                          className: 'hk-act',
                          type: 'button',
                          style: { alignSelf: 'flex-start', marginTop: 2 },
                          disabled: busy,
                          onClick: () => {
                            setAdding(ev)
                            setForm({ command: '', matcher: '', timeoutMs: '' })
                          },
                        },
                        '＋ 添加钩子',
                      ),
                )
              }),
            ),

        h(
          'div',
          { className: 'hk-card' },
          h('h4', null, '配置文件'),
          h('p', null, '高级用法：直接编辑 JSON。保存时先校验语法，写坏不会落盘。'),
          h('textarea', {
            className: 'hk-editor',
            style: { marginTop: 10 },
            value: text,
            spellCheck: false,
            onChange: (e) => {
              setText(e.target.value)
              setDirty(true)
              setNote(null)
            },
          }),
          h(
            'div',
            { className: 'hk-bar' },
            h('button', { className: 'hk-act', 'data-primary': 'true', type: 'button', disabled: busy || !dirty, onClick: save }, dirty ? '保存并生效' : '已保存'),
            h('button', { className: 'hk-act', type: 'button', disabled: busy, onClick: reload }, '从磁盘重载'),
            h('button', {
              className: 'hk-act',
              type: 'button',
              disabled: busy,
              onClick: () => {
                setText(text)
                setDirty(false)
                loadAll()
              },
            }, '放弃改动'),
          ),
        ),

        h(
          'div',
          { className: 'hk-card' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('h4', null, '运行记录'),
            h('button', { className: 'hk-act', type: 'button', onClick: clear }, '清空'),
          ),
          h('p', null, '只保留本次启动以来的记录。'),
          h(
            'div',
            { className: 'hk-runs' },
            runs.length === 0
              ? h('div', { className: 'hk-empty' }, '暂无记录')
              : runs.map((run, i) =>
                  h(
                    'div',
                    { className: 'hk-row', key: `${run.ts}-${i}` },
                    h('span', { className: 'hk-dot', 'data-state': stateOf(run) }),
                    h(
                      'div',
                      { className: 'hk-main' },
                      h(
                        'div',
                        { className: 'hk-name' },
                        runTitle(run),
                        h('span', { className: 'hk-tag' }, relTime(run.ts)),
                      ),
                      h('div', { className: 'hk-meta', title: runSummary(run) }, runSummary(run)),
                    ),
                  ),
                ),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (slots === undefined) return

        slots.inject('conversation.chat.assistant-actions', () =>
          slots.register(
            { name: 'conversation.chat.assistant-actions', id: 'dsh-hooks', order: 40, label: '钩子' },
            HookActions,
          ),
        )

        slots.inject('settings.section', () =>
          slots.register({ name: 'settings.section', id: 'hooks', order: 26, label: '钩子' }, () =>
            React.createElement(HooksSettings),
          ),
        )
      },
    }
  },
})

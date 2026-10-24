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
      '.hk-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.hk-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.hk-btn[data-active="true"]{color:var(--dsw-alias-brand-primary)}',
      '.hk-badge{min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:10px;line-height:15px;text-align:center;font-variant-numeric:tabular-nums}',
      '.hk-pop{position:absolute;z-index:60;right:0;bottom:calc(100% + 6px);width:380px;max-height:340px;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.2);padding:8px;text-align:left}',
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
      '.hk-ev{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);margin-top:8px}',
      '.hk-ev[data-on="true"]{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}',
      '.hk-ev-name{font-weight:600;font-size:12px}',
      '.hk-ev-desc{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.hk-ev-cnt{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
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
      const timer = useRef(null)
      const box = useRef(null)

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

      useEffect(() => {
        if (!open) return undefined
        load()
        // 面板开着时轻量轮询，保证跑着的钩子能实时出现。
        const id = setInterval(load, 3000)
        return () => clearInterval(id)
      }, [open, load])

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
            type: 'button',
            title: '钩子运行记录',
            'data-active': open ? 'true' : 'false',
            onClick: () => setOpen((v) => !v),
          },
          '钩子',
          runs.length ? h('span', { className: 'hk-badge' }, String(runs.length > 99 ? '99+' : runs.length)) : null,
        ),
        open
          ? h(
              'div',
              { className: 'hk-pop' },
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

    // ── 设置页 ──────────────────────────────────────────────────────────
    function HooksSettings() {
      const [info, setInfo] = useState(null)
      const [text, setText] = useState('')
      const [dirty, setDirty] = useState(false)
      const [note, setNote] = useState(null)
      const [busy, setBusy] = useState(false)

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

      const events = info?.events || []
      const counts = info?.counts || {}
      const runs = (info?.runs || []).slice(-40).reverse()
      const all = Object.keys(EVENT_LABEL)

      return h(
        'div',
        { className: 'hk-sec' },
        h('style', null, CSS),

        h(
          'div',
          { className: 'hk-card' },
          h('h4', null, '钩子配置'),
          h('p', null, '与 Claude Code 的 hooks.json 格式一致。保存后立即生效，无需重启。'),
          h('div', { className: 'hk-path', style: { marginTop: 6 } }, info?.configFile || '~/.dsh/hooks/hooks.json'),
        ),

        h(
          'div',
          { className: 'hk-card' },
          h('h4', null, '事件总览'),
          h('p', null, '灰色表示当前配置里没有该事件。'),
          all.map((ev) =>
            h(
              'div',
              { className: 'hk-ev', 'data-on': events.includes(ev) ? 'true' : 'false', key: ev },
              h(
                'div',
                null,
                h('div', { className: 'hk-ev-name' }, `${ev}　${EVENT_LABEL[ev]}`),
                h('div', { className: 'hk-ev-desc' }, EVENT_DESC[ev]),
              ),
              h('div', { className: 'hk-ev-cnt' }, events.includes(ev) ? `已启用 · ${counts[ev] || 0} 次` : '未启用'),
            ),
          ),
        ),

        h(
          'div',
          { className: 'hk-card' },
          h('h4', null, '配置文件'),
          h('p', null, '直接编辑 JSON。保存时先校验语法，写坏不会落盘。'),
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
          note ? h('div', { className: 'hk-note', 'data-kind': note.kind, style: { marginTop: 10 } }, note.text) : null,
          info?.lastError ? h('div', { className: 'hk-note', 'data-kind': 'err', style: { marginTop: 8 } }, info.lastError) : null,
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

// Stop 示例：回合结束前做一次自省提醒，带冷却，避免每轮都被打断。
//
// 契约：输出文本即注入，并让本轮继续一步（相当于"拦下一次收尾"）。
// 防护：框架对同一轮最多拦 stopBlockLimit 次（默认 1），钩子写错也不会死循环。
// 冷却：Stop 每轮都会触发，无条件提醒会让每轮多走一步，所以用状态文件限流。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const COOLDOWN_MS = 90 * 60 * 1000 // 同一会话 90 分钟内最多提醒一次

const payload = await readStdin()
const sessionId = payload.session_id ?? payload.sessionId ?? 'default'
const stateDir = join(homedir(), '.dsh', 'hooks', 'state')
const stateFile = join(stateDir, `stop-nudge-${sessionId}.json`)

if (!payload.stop_hook_active && shouldNudge()) {
  markNudged()
  console.log('收尾前自检：本段有没有可泛化的结论、决策理由或踩过的坑值得沉淀？没有就直说无沉淀。')
}

function shouldNudge() {
  try {
    const { at } = JSON.parse(readFileSync(stateFile, 'utf8'))
    return Date.now() - Number(at) >= COOLDOWN_MS
  } catch {
    return true // 没有状态文件 = 本会话还没提醒过
  }
}

function markNudged() {
  try {
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(stateFile, JSON.stringify({ at: Date.now() }), 'utf8')
  } catch {
    // 写不了状态就退化成"每次都提醒"，不影响主流程
  }
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

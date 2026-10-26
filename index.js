// dsh-whale-memory
//
// 两件事：
//   1. 把 <工作区>/memory/persona/core.md 里 <!-- inject:begin --> 与 <!-- inject:end -->
//      之间的内容，每次组装提示词时读一遍，挂成 systemPrompt section。
//   2. 工作区里没有 memory/ 时，从包内 templates 落一套骨架；**已有的文件一个都不覆盖**。
//
// 改人格文件不用重启，下一个请求就生效。
// 零依赖：只用 node 内置模块，不 import 任何 @deepseek-ai/* 包。

import fs from 'node:fs'
import { createMemoryCore } from './lib/memory-core.mjs'
import { registerMemoryTools } from './lib/tools.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'whale-memory'
export const inject = ['systemPrompt', 'tools']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES = path.join(HERE, 'templates')
const BEGIN = '<!-- inject:begin -->'
const END = '<!-- inject:end -->'

// 一旦哪次成功读到人格，就记住那个根；工具和注入必须永远看同一个仓库。
let knownRoot = null

/** 工作区根：已知根 → config.root → workingDirectory.defaultDirectory → 进程 cwd */
function resolveRoot(ctx, config) {
  const candidates = []
  if (knownRoot) candidates.push(knownRoot)
  if (config.root) candidates.push(String(config.root))
  try {
    const wd = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined
    if (wd?.defaultDirectory) candidates.push(wd.defaultDirectory)
  } catch {
    /* 服务还没就绪，往下退 */
  }
  candidates.push(process.cwd())
  for (const c of candidates) {
    try {
      // DSH 的 profile 目录永远不是用户工作区，哪怕里面被种过副本
      if (c.replace(/\\\\/g, '/').includes('/.dsh/')) continue
      if (fs.existsSync(path.join(c, 'memory', 'persona', 'core.md'))) {
        knownRoot = c
        return c
      }
    } catch { /* ignore */ }
  }
  const clean = candidates.find((c) => !c.replace(/\\\\/g, '/').includes('/.dsh/'))
  return clean ?? candidates[0]
}

/** 把模板落进工作区；只补缺失的文件，绝不覆盖。返回写入数量。 */
function plant(root) {
  if (!fs.existsSync(TEMPLATES)) return 0
  let count = 0
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, entry.name)
      const relPath = rel ? path.join(rel, entry.name) : entry.name
      const to = path.join(root, relPath)
      if (entry.isDirectory()) {
        walk(from, relPath)
        continue
      }
      if (fs.existsSync(to)) continue
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
      count += 1
    }
  }
  walk(TEMPLATES, '')
  return count
}

/** 读注入段；去掉标题行，只留正文。读不到返回空串。 */
function readInject(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const start = text.indexOf(BEGIN)
    const stop = text.indexOf(END)
    if (start < 0 || stop <= start) return ''
    return text
      .slice(start + BEGIN.length, stop)
      .split(/\r?\n/)
      .filter((line) => !/^#{1,3}\s/.test(line))
      .join('\n')
      .trim()
  } catch {
    return ''
  }
}

// —— 做梦提醒：只看状态，不改任何文件 ——

const NUDGE_DEFAULT_HOURS = 12
const NUDGE_DEFAULT_COOLDOWN_MIN = 60
let lastNudgeAt = 0

/** inbox 里还有几条没整理（以「- [」开头的行计数）。 */
function countInbox(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'memory', 'inbox.md'), 'utf8')
    return text.split(/\r?\n/).filter((line) => /^-\s*\[/.test(line.trim())).length
  } catch {
    return 0
  }
}

/** 距最近一次动日记多少小时；没写过返回 Infinity。日期取「文件名日期」与 mtime 中较晚者。 */
function hoursSinceDiary(root) {
  try {
    const dir = path.join(root, 'memory', 'diary')
    const files = fs.readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    if (!files.length) return Infinity
    let newest = 0
    for (const file of files) {
      const nameTime = Date.parse(`${file.slice(0, 10)}T00:00:00`)
      const at = fs.statSync(path.join(dir, file)).mtimeMs
      const effective = Math.max(Number.isNaN(nameTime) ? 0 : nameTime, at)
      if (effective > newest) newest = effective
    }
    return (Date.now() - newest) / 3600000
  } catch {
    return Infinity
  }
}

/** 该不该提醒；提醒时返回一句话，否则空串。 */
function nudgeText(root, config) {
  if (config.nudge === false) return ''
  const entries = countInbox(root)
  if (!entries) return ''
  const after = Number(config.nudgeAfterHours ?? NUDGE_DEFAULT_HOURS)
  const age = hoursSinceDiary(root)
  if (Number.isFinite(after) && age < after) return ''
  const cooldown = Number(config.nudgeCooldownMinutes ?? NUDGE_DEFAULT_COOLDOWN_MIN) * 60000
  if (Date.now() - lastNudgeAt < cooldown) return ''
  lastNudgeAt = Date.now()
  const ago =
    age === Infinity ? '从来没写过' : age >= 48 ? `${Math.round(age / 24)} 天前` : `${Math.round(age)} 小时前`
  return `【记忆提示】inbox 还有 ${entries} 条没整理，最近一次动日记是 ${ago}。`
}

export function apply(ctx, config = {}) {  let planted = false
  const plantOnce = () => {
    if (planted) return
    planted = true
    try {
      const target = resolveRoot(ctx, config)
      // 绝不能把骨架种进 DSH 的 profile 目录（那不是用户工作区）
      if (target.replace(/\\\\/g, '/').includes('/.dsh/profiles/')) return
      plant(target)
    } catch {
      /* 落盘失败不该挡住对话 */
    }
  }

  plantOnce()
  if (config.inject === false) return

  const order = Number.isFinite(Number(config.order)) ? Number(config.order) : 9
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'whale-memory',
      order,
      interpolate: false,
      text: () => {
        plantOnce()
        const root = resolveRoot(ctx, config)
        const persona = readInject(path.join(root, 'memory', 'persona', 'core.md'))
        const nudge = nudgeText(root, config)
        return nudge ? `${persona}\n\n${nudge}` : persona
      },
    }),
  )
  // 记忆工具：装了就可用，不用再单独跑安装脚本
  try {
    if (config.tools !== false) {
      const tools = ctx.get('tools')
      if (tools) registerMemoryTools(ctx, () => createMemoryCore(resolveRoot(ctx, config)), tools)
    }
  } catch {
    /* 工具注册失败不该挡住对话 */
  }
}

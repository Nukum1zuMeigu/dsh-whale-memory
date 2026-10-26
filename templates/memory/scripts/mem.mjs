#!/usr/bin/env node
// 记忆之门 · 一扇门四个动词：recall / render / doctor / note
//
// 零依赖，只用 Node 自带模块。设计见 ../README.md、../AUTHORITY.md。
//
//   node scripts/mem.mjs recall "关键词" --limit 3
//   node scripts/mem.mjs recall "插件" --type lesson --domain work
//   node scripts/mem.mjs render
//   node scripts/mem.mjs doctor [--write]
//   node scripts/mem.mjs note "记一句" --channel qq

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SOURCES = [
  'persona/user.md',
  'persona/context.md',
  'long/facts.md',
  'long/promises.md',
  'long/lessons.md',
  'long/topics.md',
  'long/projects.md',
]

const TAU_DAYS = 45
const RECALL_BUDGET = 1500

// 类型权重：越"是我"的越重
const TYPE_W = {
  promise: 1.3,
  soul: 1.3,
  user: 1.15,
  rules: 1.1,
  lesson: 1.05,
  project: 1.0,
  topic: 0.95,
  fact: 0.9,
  event: 0.85,
}

const STOP = new Set([
  '一个', '一些', '什么', '这个', '那个', '这些', '那些', '我们', '你们', '他们',
  '自己', '时候', '现在', '今天', '昨天', '明天', '因为', '所以', '但是', '然后',
  '就是', '还是', '可以', '没有', '不是', '这里', '那里', '这样', '那样', '觉得',
  '知道', '已经', '出来', '起来', '一下', '有点', '真的', '应该', '可能', '如果',
  '虽然', '不过', '而且', '以及', '还有', '的话', '一样', '一直', '一起', '东西',
  '事情', '感觉', '看着', '说的', 'the', 'and', 'for', 'with', 'that', 'this',
])

const SYNONYMS = [
  ['暗号', '口令', '约定', '密码'],
  ['记忆', '记性', '记事', '记住'],
  ['插件', 'plugin', '扩展'],
  ['主人', 'user', '对方'],
  ['讨厌', '不喜欢', '反感', '烦'],
  ['结论', '直接', '铺垫', '重点'],
  ['做梦', '整理', '梦', '睡眠'],
  ['qq', '腾讯', '群'],
  ['b站', 'bilibili', '视频', '上网'],
  ['形态', 'q版', '变身'],
  ['人格', '人设', '性格', '灵魂'],
  ['门牌', '指针', '溯源', '证据'],
  ['预算', 'token', '开销'],
]

// ---------- 基础工具 ----------

const readText = (rel) => {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
  } catch {
    return ''
  }
}

const daysSince = (dateStr, now = Date.now()) => {
  if (!dateStr) return 0
  const t = Date.parse(String(dateStr).length === 10 ? `${dateStr}T00:00:00Z` : dateStr)
  if (Number.isNaN(t)) return 0
  return Math.max(0, (now - t) / 86400000)
}

const truncate = (s, max) => (s.length > max ? `${s.slice(0, max)}…` : s)

function tokenize(text) {
  const out = new Set()
  const raw = String(text ?? '').toLowerCase()
  for (const m of raw.matchAll(/[a-z0-9][a-z0-9._-]*/g)) out.add(m[0])
  const han = raw.replace(/[^\u4e00-\u9fff]+/g, ' ')
  for (const seg of han.split(/\s+/)) {
    if (!seg) continue
    if (seg.length === 1) {
      out.add(seg)
      continue
    }
    out.add(seg)
    for (let i = 0; i + 1 < seg.length; i += 1) out.add(seg.slice(i, i + 2))
  }
  return [...out].filter((t) => t.length >= 1 && !STOP.has(t))
}

function buildSynonymMap() {
  const map = new Map()
  for (const group of SYNONYMS) {
    const keys = group.map((w) => String(w).toLowerCase())
    for (const key of keys) {
      const set = map.get(key) ?? new Set()
      for (const other of keys) {
        if (other !== key) set.add(other)
      }
      map.set(key, set)
    }
  }
  return map
}

const SYN_MAP = buildSynonymMap()

function expand(tokens) {
  const out = new Set(tokens)
  for (const token of tokens) {
    for (const syn of SYN_MAP.get(token) ?? []) out.add(syn)
  }
  return [...out]
}

const weightOf = (token) => Math.min(4, Math.max(1, token.length))

// ---------- 解析一手文件 ----------

/**
 * 条目格式：
 *   ## mem-YYYYMMDD-XXX
 *   - key: value
 *   （空行）
 *   正文……
 */
function parseFile(rel) {
  const text = readText(rel)
  const lines = text.split(/\r?\n/)
  const entries = []
  const problems = []
  let cur = null

  const flush = () => {
    if (!cur) return
    const body = cur.body.join('\n').trim()
    if (!cur.fields.type) problems.push(`${rel} ${cur.id} 缺 type`)
    if (!cur.fields.src) problems.push(`${rel} ${cur.id} 缺 src（门牌）`)
    if (!cur.fields.evidence) problems.push(`${rel} ${cur.id} 缺 evidence`)
    entries.push({
      id: cur.id,
      file: rel,
      type: cur.fields.type ?? '',
      domain: cur.fields.domain ?? 'misc',
      sub: cur.fields.sub ?? null,
      goal: cur.fields.goal ?? null,
      salience: Number(cur.fields.salience ?? 0.5),
      status: cur.fields.status ?? 'active',
      src: cur.fields.src ?? '',
      evidence: cur.fields.evidence ?? '',
      created: cur.fields.created ?? '',
      updated: cur.fields.updated ?? '',
      hits: Number(cur.fields.hits ?? 0),
      last_hit: cur.fields.last_hit && cur.fields.last_hit !== 'null' ? cur.fields.last_hit : null,
      text: body,
    })
    cur = null
  }

  for (const line of lines) {
    const heading = line.match(/^##\s+(mem-\d{8}-\d{3})\s*$/)
    if (heading) {
      flush()
      cur = { id: heading[1], fields: {}, body: [], inBody: false }
      continue
    }
    if (/^##\s+/.test(line)) {
      // 非条目小节（如「待观察」）→ 结束当前条目
      flush()
      continue
    }
    if (!cur) continue
    const field = line.match(/^-\s+([a-zA-Z_]+):\s?(.*)$/)
    if (field && !cur.inBody) {
      cur.fields[field[1]] = field[2].trim()
      continue
    }
    if (!cur.inBody) {
      if (line.trim() === '') {
        if (Object.keys(cur.fields).length) cur.inBody = true
        continue
      }
      // 字段区里出现非字段行 → 视为正文开始
      cur.inBody = true
    }
    if (line.trim() === '---') continue
    cur.body.push(line)
  }
  flush()
  return { entries, problems }
}

function loadAll() {
  const entries = []
  const problems = []
  for (const rel of SOURCES) {
    const parsed = parseFile(rel)
    entries.push(...parsed.entries)
    problems.push(...parsed.problems)
  }
  return { entries, problems }
}

// ---------- 检索 ----------

function scoreEntry(entry, qTokens, expanded, now) {
  const hay = `${entry.text} ${entry.id}`.toLowerCase()
  let raw = 0
  const hit = new Set()
  let covered = 0
  for (const token of qTokens) {
    if (hay.includes(token)) {
      raw += weightOf(token) * 1.2
      hit.add(token)
      covered += 1
    }
  }
  if (!raw) return null
  for (const token of expanded) {
    if (qTokens.includes(token)) continue
    if (hay.includes(token)) {
      raw += weightOf(token) * 0.6
      hit.add(token)
    }
  }
  const coverage = qTokens.length ? covered / qTokens.length : 0
  const decay = Math.exp(-daysSince(entry.last_hit ?? entry.updated ?? entry.created, now) / TAU_DAYS)
  const salience = Number.isFinite(entry.salience) ? entry.salience : 0.5
  const typeWeight = TYPE_W[entry.type] ?? 1
  return {
    entry,
    score: raw * (0.35 + 0.65 * coverage) * Math.max(0.05, decay) * salience * typeWeight,
    hit: [...hit],
    decay,
    coverage,
  }
}

function searchDiary(query, limit = 3) {
  const tokens = tokenize(query).filter((t) => t.length >= 2)
  if (!tokens.length) return []
  const dir = path.join(ROOT, 'diary')
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse()
  } catch {
    return []
  }
  const hits = []
  for (const file of files.slice(0, 30)) {
    const lines = readText(path.join('diary', file)).split(/\r?\n/)
    lines.forEach((line, index) => {
      const low = line.toLowerCase()
      let score = 0
      for (const token of tokens) if (low.includes(token)) score += weightOf(token)
      if (score > 0) hits.push({ file: `diary/${file}`, line: index + 1, score, text: line.trim() })
    })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

function cmdRecall(args) {
  const query = args.query
  if (!query) {
    console.error('用法：node scripts/mem.mjs recall "关键词" [--type user] [--domain work] [--limit 3] [--all]')
    process.exit(1)
  }
  const { entries } = loadAll()
  const qTokens = tokenize(query)
  const expanded = expand(qTokens)
  const now = Date.now()

  const wantedStatus = args.all ? null : args.status ?? 'active'
  const pool = entries.filter((entry) => {
    if (wantedStatus && entry.status !== wantedStatus) return false
    if (args.type && entry.type !== args.type) return false
    if (args.domain && entry.domain !== args.domain) return false
    return true
  })

  const ranked = pool
    .map((entry) => scoreEntry(entry, qTokens, expanded, now))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)

  const limit = Math.min(10, Math.max(1, Number(args.limit ?? 3)))
  const picked = ranked.slice(0, limit)

  if (!picked.length) {
    const diaryHits = searchDiary(query, 3)
    if (diaryHits.length) {
      console.log(`未命中条目，退回日记原文（${diaryHits.length} 条）：`)
      for (const h of diaryHits) console.log(`  · ${h.file}#L${h.line}  ${truncate(h.text, 90)}`)
    } else {
      console.log('没有命中，也没有原文。标 evidence_gap —— 明说「我没记到」，不要编。')
    }
    return
  }

  let budget = RECALL_BUDGET
  picked.forEach((item, index) => {
    const { entry } = item
    const flag = entry.status === 'void' ? '（已吊销）' : entry.status === 'archived' ? '（很久没提起）' : ''
    const head = `[${index + 1}] ${entry.id}  ${entry.type}/${entry.domain}  s=${item.score.toFixed(2)} decay=${item.decay.toFixed(2)} ${flag}`
    const body = `    ${truncate(entry.text.replace(/\s+/g, ' '), 150)}`
    const tail = `    门牌 ${entry.src}   命中 ${item.hit.slice(0, 6).join(' ')}`
    const block = [head, body, tail].join('\n')
    if (block.length > budget) return
    budget -= block.length
    console.log(block)
  })
  if (ranked.length > picked.length) {
    console.log(`（还有 ${ranked.length - picked.length} 条，收窄关键词或加 --limit）`)
  }
}

// ---------- 渲染索引 ----------

function cmdRender() {
  const { entries, problems } = loadAll()
  const byType = new Map()
  for (const entry of entries) {
    const row = byType.get(entry.type) ?? { active: 0, archived: 0, other: 0 }
    if (entry.status === 'active') row.active += 1
    else if (entry.status === 'archived') row.archived += 1
    else row.other += 1
    byType.set(entry.type, row)
  }

  const lines = []
  lines.push('# 索引（生成视图）')
  lines.push('')
  lines.push('> ⚠️ **这是生成的文件，不要手改。** 运行 `node scripts/mem.mjs render` 重建。')
  lines.push('> 真想改内容，去改一手文件（`persona/`、`long/`、`diary/`）。')
  lines.push('')
  lines.push(`生成时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')} ｜ 条目：${entries.length}`)
  lines.push('')
  lines.push('## 按类型')
  lines.push('')
  lines.push('| 类型 | 活跃 | 归档 | 其它 |')
  lines.push('|---|---|---|---|')
  for (const [type, row] of [...byType.entries()].sort()) {
    lines.push(`| ${type} | ${row.active} | ${row.archived} | ${row.other} |`)
  }
  lines.push('')
  lines.push('## 条目')
  lines.push('')
  lines.push('| id | 类型 | 域 | 重要度 | 状态 | 门牌 | 摘要 |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const entry of entries) {
    const summary = truncate(entry.text.replace(/\s+/g, ' '), 48)
    lines.push(`| ${entry.id} | ${entry.type} | ${entry.domain} | ${entry.salience.toFixed(2)} | ${entry.status} | ${entry.src} | ${summary} |`)
  }
  if (problems.length) {
    lines.push('')
    lines.push('## 解析告警')
    lines.push('')
    for (const p of problems) lines.push(`- ${p}`)
  }
  lines.push('')

  const target = path.join(ROOT, 'long', 'index.md')
  fs.writeFileSync(target, lines.join('\n'), 'utf8')
  console.log(`已重建 ${path.relative(ROOT, target)}：${entries.length} 条`)
  if (problems.length) console.log(`注意：${problems.length} 条解析告警，跑 doctor 看细节。`)
}

// ---------- 体检 ----------

function cmdDoctor(args) {
  const { entries, problems } = loadAll()
  const results = []
  const ok = (name, msg) => results.push({ level: 'ok', name, msg })
  const warn = (name, msg) => results.push({ level: 'warn', name, msg })
  const bad = (name, msg) => results.push({ level: 'error', name, msg })

  // 1 一手可解析
  if (problems.length) bad('一手可解析', `${problems.length} 条：${problems.slice(0, 3).join('；')}`)
  else ok('一手可解析', `${SOURCES.length} 个文件全部可解析`)

  // 2 门牌可定位
  const broken = []
  for (const entry of entries) {
    const m = String(entry.src ?? '').match(/^(.+?)#L(\d+)$/)
    if (!m) {
      broken.push(`${entry.id} 门牌格式不对（${entry.src || '空'}）`)
      continue
    }
    const file = path.join(ROOT, m[1])
    if (!fs.existsSync(file)) {
      broken.push(`${entry.id} 指向不存在的文件 ${m[1]}`)
      continue
    }
    const total = fs.readFileSync(file, 'utf8').split(/\r?\n/).length
    if (Number(m[2]) > total) broken.push(`${entry.id} 行号越界 ${entry.src}`)
  }
  if (broken.length) bad('门牌可定位', `${broken.length} 条失效：${broken.slice(0, 3).join('；')}`)
  else ok('门牌可定位', `${entries.length} 条全部指得回原文`)

  // 3 索引与一手一致
  const indexText = readText('long/index.md')
  const indexCount = (indexText.match(/^\|\s*mem-\d{8}-\d{3}\s*\|/gm) ?? []).length
  if (!indexText || indexText.includes('尚未生成')) warn('索引一致', '索引还没生成，跑 render')
  else if (indexCount !== entries.length) bad('索引一致', `索引 ${indexCount} 条 vs 一手 ${entries.length} 条`)
  else ok('索引一致', `${entries.length} 条对得上`)

  // 4 无证据条目
  const noEvidence = entries.filter((entry) => !entry.evidence)
  if (noEvidence.length) bad('证据完整', `${noEvidence.length} 条没有 evidence：${noEvidence.map((e) => e.id).join(' ')}`)
  else ok('证据完整', `${entries.length} 条都有证据`)

  // 5 L1 变更可查
  const l1 = entries.filter((entry) => entry.file.startsWith('persona/'))
  const changelog = readText('persona/changelog.md')
  const unlogged = l1.filter((entry) => !changelog.includes(entry.id))
  if (!l1.length) warn('L1 留痕', 'L1 还是空的')
  else if (unlogged.length) bad('L1 留痕', `${unlogged.length} 条没进变更记录：${unlogged.map((e) => e.id).join(' ')}`)
  else ok('L1 留痕', `${l1.length} 条都能在 changelog 里查到`)

  // 6 预算：只算「真正会注入的那一段」+ L1 里最重要的两条
  const coreText = readText('persona/core.md')
  const begin = coreText.indexOf('<!-- inject:begin -->')
  const end = coreText.indexOf('<!-- inject:end -->')
  const injected = begin >= 0 && end > begin ? coreText.slice(begin, end) : coreText
  const coreBytes = Buffer.byteLength(injected, 'utf8')
  const topL1 = l1
    .filter((entry) => entry.status === 'active')
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 2)
  const l1Bytes = topL1.reduce(
    (sum, entry) => sum + Buffer.byteLength(truncate(entry.text, 120), 'utf8'),
    0,
  )
  const budget = coreBytes + l1Bytes
  if (budget > 4096) warn('注入预算', `条文摘要+L1 前二 约 ${budget}B，超过 4 KB 软顶`)
  else ok('注入预算', `条文摘要 ${coreBytes}B + L1 前二 ${l1Bytes}B = ${budget}B（顶 4096B）`)

  // 7 最近一次整理
  let latest = ''
  try {
    latest = fs.readdirSync(path.join(ROOT, 'diary'))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().pop() ?? ''
  } catch { /* ignore */ }
  if (!latest) warn('整理新鲜度', '还没有日记')
  else {
    const days = daysSince(latest.slice(0, 10))
    const msg = `最近一篇日记 ${latest.slice(0, 10)}（${days.toFixed(0)} 天前）`
    if (days > 3) warn('整理新鲜度', `${msg} —— 该做梦了`)
    else ok('整理新鲜度', msg)
  }

  // 8 墓碑一致
  const deleted = entries.filter((entry) => entry.status === 'deleted')
  const tombstones = readText('tombstones.md')
  const missing = deleted.filter((entry) => !tombstones.includes(entry.id))
  if (missing.length) bad('墓碑一致', `${missing.length} 条已删但没立墓碑`)
  else if (!deleted.length) ok('墓碑一致', '没有删除条目')
  else ok('墓碑一致', `${deleted.length} 条删除都有墓碑`)

  // 输出
  const icon = { ok: '✅', warn: '⚠️ ', error: '❌' }
  for (const r of results) console.log(`${icon[r.level]} ${r.name}：${r.msg}`)
  const errors = results.filter((r) => r.level === 'error').length
  const warns = results.filter((r) => r.level === 'warn').length
  console.log(`\n合计：${results.length} 项，${errors} 错、${warns} 警。`)

  if (args.write) {
    const lines = []
    lines.push('# 体检（生成视图）')
    lines.push('')
    lines.push('> ⚠️ 由 `node scripts/mem.mjs doctor --write` 生成，不要手改。')
    lines.push('')
    lines.push(`体检时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')}`)
    lines.push('')
    lines.push('| # | 检查项 | 结果 | 说明 |')
    lines.push('|---|---|---|---|')
    results.forEach((r, i) => {
      const text = { ok: '通过', warn: '警告', error: '错误' }[r.level]
      lines.push(`| ${i + 1} | ${r.name} | ${text} | ${r.msg} |`)
    })
    lines.push('')
    lines.push('## 八项检查的来历')
    lines.push('')
    lines.push('1. 一手可解析 —— 日记损坏')
    lines.push('2. 门牌可定位 —— 索引说谎')
    lines.push('3. 索引一致 —— 丢过写入')
    lines.push('4. 证据完整 —— 脑补混进来')
    lines.push('5. L1 留痕 —— 漂移无痕')
    lines.push('6. 注入预算 —— 预算失控')
    lines.push('7. 整理新鲜度 —— 「三小时前」和「三天没做」是两种状态')
    lines.push('8. 墓碑一致 —— 「忘掉」没真忘')
    lines.push('')
    fs.writeFileSync(path.join(ROOT, 'health.md'), lines.join('\n'), 'utf8')
    console.log('已写入 health.md')
  }
  process.exitCode = errors ? 1 : 0
}

// ---------- 待整理 ----------

function cmdNote(args) {
  const text = args.query
  if (!text) {
    console.error('用法：node scripts/mem.mjs note "一句话" [--channel qq]')
    process.exit(1)
  }
  const now = new Date()
  const day = now.toISOString().slice(0, 10)
  const channel = args.channel ?? 'dsh-web'
  const line = `- [${day}] (${channel}) ${text} —— 来源：scripts/mem.mjs\n`
  fs.appendFileSync(path.join(ROOT, 'inbox.md'), line, 'utf8')
  console.log(`已记入 inbox：${line.trim()}`)
}

// ---------- CLI ----------

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--all') args.all = true
    else if (item === '--write') args.write = true
    else if (item.startsWith('--')) {
      const key = item.slice(2)
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
      args[key] = value
    } else args._.push(item)
  }
  args.query = args._.slice(1).join(' ')
  return args
}

const HELP = `记忆之门 · 一扇门四个动词

  recall  "关键词" [--type user] [--domain work] [--limit 3] [--all]
  render                       重建 long/index.md
  doctor  [--write]            八项体检，--write 写 health.md
  note    "一句话" [--channel qq]  记入 inbox.md
`

const [verb, ...rest] = process.argv.slice(2)
const args = parseArgs([verb, ...rest])

switch (verb) {
  case 'recall':
    cmdRecall(args)
    break
  case 'render':
    cmdRender()
    break
  case 'doctor':
    cmdDoctor(args)
    break
  case 'note':
    cmdNote(args)
    break
  default:
    console.log(HELP)
    break
}

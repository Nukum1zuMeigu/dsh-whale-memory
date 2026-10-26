// 记忆核心：所有工具背后的纯函数。与 MCP 版共用同一套规则。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const STOP = new Set(['一个', '一些', '什么', '这个', '那个', '我们', '他们', '自己', '时候', '现在', '今天', '因为', '所以', '但是', '然后', '就是', '还是', '可以', '没有', '不是'])

export function createMemoryCore(root) {
  const MEMORY = path.join(root, 'memory')
  const TASKS = path.join(root, 'tasks')
  const FILES = path.join(root, 'inbox_files')
  const INSPIRATION = path.join(MEMORY, 'inspiration.md')
  const FFMPEG = path.join(root, 'tools', 'ffmpeg', 'ffmpeg.exe')
  const SOURCES = ['persona/user.md', 'persona/context.md', 'long/facts.md', 'long/promises.md', 'long/lessons.md', 'long/topics.md', 'long/projects.md']
  const IMAGE_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }
  const VIEW_MAX = 6 * 1024 * 1024
  const VIEW_TTL_MS = 60 * 60 * 1000

  function tokenize(text) {
    const out = new Set()
    const raw = String(text ?? '').toLowerCase()
    for (const m of raw.matchAll(/[a-z0-9][a-z0-9._-]*/g)) out.add(m[0])
    for (const seg of raw.replace(/[^\u4e00-\u9fff]+/g, ' ').split(/\s+/)) {
      if (!seg) continue
      if (seg.length === 1) out.add(seg)
      else {
        out.add(seg)
        for (let i = 0; i + 1 < seg.length; i += 1) out.add(seg.slice(i, i + 2))
      }
    }
    return [...out].filter((t) => t.length >= 1 && !STOP.has(t))
  }

  function parseEntries() {
    const entries = []
    for (const rel of SOURCES) {
      let text = ''
      try { text = fs.readFileSync(path.join(MEMORY, rel), 'utf8') } catch { continue }
      let cur = null
      const flush = () => {
        if (!cur) return
        entries.push({ ...cur, text: cur.body.join('\n').trim(), file: rel })
        cur = null
      }
      for (const line of text.split(/\r?\n/)) {
        const h = line.match(/^##\s+(mem-\d{8}-\d{3})\s*$/)
        if (h) { flush(); cur = { id: h[1], fields: {}, body: [] }; continue }
        if (/^##\s+/.test(line)) { flush(); continue }
        if (!cur) continue
        const f = line.match(/^-\s+([a-zA-Z_]+):\s?(.*)$/)
        if (f && !cur.body.length) { cur.fields[f[1]] = f[2].trim(); continue }
        cur.body.push(line)
      }
      flush()
    }
    return entries
  }

  function recall(query, limit = 3, type = '') {
    const q = tokenize(query)
    if (!q.length) return []
    const scored = []
    for (const e of parseEntries()) {
      if (type && e.fields.type !== type) continue
      if ((e.fields.status ?? 'active') !== 'active') continue
      const hay = `${e.text} ${e.id}`.toLowerCase()
      let raw = 0
      let hit = 0
      for (const t of q) if (hay.includes(t)) { raw += Math.min(4, Math.max(1, t.length)); hit += 1 }
      if (!raw) continue
      scored.push({ e, score: raw * (0.35 + 0.65 * (hit / q.length)) })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, Math.max(1, Math.min(10, limit))).map(({ e, score }) => ({
      id: e.id, type: e.fields.type ?? '', domain: e.fields.domain ?? '', src: e.fields.src ?? '',
      score: Number(score.toFixed(2)), text: e.text.replace(/\s+/g, ' ').slice(0, 300),
    }))
  }

  function note(text, channel = 'dsh-web', domain = 'misc') {
    const clean = String(text ?? '').trim()
    if (!clean) throw new Error('text 不能为空')
    const day = new Date().toISOString().slice(0, 10)
    fs.mkdirSync(MEMORY, { recursive: true })
    fs.appendFileSync(path.join(MEMORY, 'inbox.md'), `- [${day}] (${channel}) [${domain}] ${clean} —— 来源：whale-memory\n`, 'utf8')
    return `已记入 inbox：${clean}`
  }

  function taskAdd(text, channel = 'dsh-web') {
    const clean = String(text ?? '').trim()
    if (!clean) throw new Error('text 不能为空')
    fs.mkdirSync(TASKS, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const line = `- [ ] ${stamp} (${channel}) ${clean}\n`
    fs.appendFileSync(path.join(TASKS, 'pending.md'), line, 'utf8')
    return `任务卡已投递：${line.trim()}`
  }

  function taskList() {
    try {
      const t = fs.readFileSync(path.join(TASKS, 'pending.md'), 'utf8').trim()
      return t || '（没有待办任务）'
    } catch { return '（没有待办任务）' }
  }

  function parseInspiration() {
    const out = []
    let text = ''
    try { text = fs.readFileSync(INSPIRATION, 'utf8') } catch { return out }
    let cur = null
    const flush = () => { if (cur) out.push(cur); cur = null }
    for (const line of text.split(/\r?\n/)) {
      const h = line.match(/^##\s+(insp-\d{8}-\d{3})\s*$/)
      if (h) { flush(); cur = { id: h[1], source: '', used: false, text: [] }; continue }
      if (/^##\s+/.test(line)) { flush(); continue }
      if (!cur) continue
      const f = line.match(/^-\s+(source|used):\s?(.*)$/)
      if (f) {
        if (f[1] === 'source') cur.source = f[2].trim()
        if (f[1] === 'used') cur.used = f[2].trim() === 'true'
        continue
      }
      if (line.trim()) cur.text.push(line.trim())
    }
    flush()
    return out.map((x) => ({ ...x, text: x.text.join(' ') }))
  }

  function inspirationAdd(text, source = '') {
    const clean = String(text ?? '').trim()
    if (!clean) throw new Error('text 不能为空')
    const items = parseInspiration()
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const id = `insp-${day}-${String(items.filter((x) => x.id.startsWith(`insp-${day}`)).length + 1).padStart(3, '0')}`
    fs.mkdirSync(MEMORY, { recursive: true })
    fs.appendFileSync(INSPIRATION, `## ${id}\n- source: ${String(source ?? '').trim() || '未标注'}\n- used: false\n\n${clean}\n\n`, 'utf8')
    return `${id}：${clean}`
  }

  function inspirationList(limit = 10, includeUsed = false) {
    const items = parseInspiration().filter((x) => includeUsed || !x.used)
    if (!items.length) return '（灵感池空了。别硬找话说。）'
    return items.slice(0, Math.max(1, Math.min(20, Number(limit) || 10)))
      .map((x, i) => `[${i + 1}] ${x.id}${x.used ? '（用过了）' : ''}\n${x.text}\n来源 ${x.source}`)
      .join('\n\n')
  }

  function inspirationUse(id) {
    const want = String(id ?? '').trim()
    if (!want) throw new Error('id 不能为空')
    let text = ''
    try { text = fs.readFileSync(INSPIRATION, 'utf8') } catch { throw new Error('灵感池还不存在') }
    const re = new RegExp(`(## ${want}\\n- source: [^\\n]*\\n- used: )false`)
    if (!re.test(text)) throw new Error(`没找到这条未用的灵感：${want}`)
    fs.writeFileSync(INSPIRATION, text.replace(re, '$1true'), 'utf8')
    return `已标记用过：${want}`
  }

  function safeJoinInbox(name) {
    const raw = String(name ?? '').trim()
    if (!raw) throw new Error('name 不能为空')
    const base = path.basename(raw)
    if (base !== raw || /[\\/]/.test(raw) || raw.includes('..')) throw new Error('只接受 inbox_files 里的文件名，不能带路径')
    const full = path.join(FILES, base)
    if (!path.resolve(full).startsWith(path.resolve(FILES) + path.sep)) throw new Error('越界')
    if (!fs.existsSync(full)) { let names = []; try { names = fs.readdirSync(FILES).slice(0, 5) } catch { /* ignore */ } throw new Error(`找不到这个文件：${base}（查的是 ${FILES}，里面有：${names.join(", ") || "空"}）`) }
    return full
  }

  function fileList() {
    try {
      const names = fs.readdirSync(FILES).filter((n) => !n.startsWith('.'))
      return names.length ? names.join('\n') : '（inbox_files 是空的）'
    } catch { return '（inbox_files 还不存在）' }
  }

  function fileRead(name) {
    const full = safeJoinInbox(name)
    const ext = path.extname(full).toLowerCase()
    if (!['.txt', '.md', '.json', '.csv', '.log', '.yml', '.yaml', ''].includes(ext)) throw new Error(`只读文本类文件，${ext || '无扩展名'} 读不了`)
    const size = fs.statSync(full).size
    if (size > 200 * 1024) throw new Error(`文件太大（${Math.round(size / 1024)}KB），上限 200KB`)
    return fs.readFileSync(full, 'utf8')
  }

  function imageSize(buf) {
    try {
      if (buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2
        while (i < buf.length - 9) {
          if (buf[i] !== 0xff) { i += 1; continue }
          const marker = buf[i + 1]
          const len = buf.readUInt16BE(i + 2)
          if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
          i += 2 + len
        }
      }
      if (buf.slice(0, 8).toString('binary') === '\x89PNG\r\n\x1a\n') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
      if (buf.slice(0, 3).toString('ascii') === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    } catch { /* ignore */ }
    return null
  }

  /** 清掉超过 1 小时没被读走的临时预览文件（.view-*.jpg）。 */
  function cleanupOldViews() {
    try {
      const now = Date.now()
      for (const name of fs.readdirSync(FILES)) {
        if (!name.startsWith('.view-')) continue
        const full = path.join(FILES, name)
        try { if (now - fs.statSync(full).mtimeMs > VIEW_TTL_MS) fs.unlinkSync(full) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  function describeImage(full, mimeType, note) {
    const buf = fs.readFileSync(full)
    const s = imageSize(buf) || {}
    return { path: full, width: s.width ?? 0, height: s.height ?? 0, bytes: buf.length, mimeType, note: note || '' }
  }

  /**
   * 把图准备成「可以直接读的本地文件」，**不返回图像内容**。
   * 返回 { path, width, height, bytes, mimeType, note }；调用方用 read_image 打开 path。
   * 超长图按段切、大图先压小，临时文件留在 inbox_files 里（点开头，fileList 看不见），一小时后自动清。
   */
  function imageView(name, part = 0) {
    const full = safeJoinInbox(name)
    const ext = path.extname(full).toLowerCase()
    if (!IMAGE_EXT[ext]) throw new Error(`不是支持的图片格式（jpg/png/webp/gif）：${ext || '无扩展名'}`)
    cleanupOldViews()
    const buf = fs.readFileSync(full)
    const size = imageSize(buf)
    const tmp = path.join(path.dirname(full), `.view-${Date.now()}.jpg`)
    try {
      if (size && size.width > 0 && size.height / size.width > 6) {
        const sliceH = Math.min(2000, Math.max(800, size.width * 2))
        const parts = Math.max(1, Math.ceil(size.height / sliceH))
        const idx = Math.min(parts - 1, Math.max(0, Number(part) || 0))
        const r = spawnSync(FFMPEG, ['-y', '-i', full, '-vf', `crop=iw:'min(ih,${sliceH})':0:${idx * sliceH},scale='min(1280,iw)':-1`, '-q:v', '4', tmp], { stdio: 'ignore', windowsHide: true, timeout: 60000 })
        if (r.status !== 0 || !fs.existsSync(tmp)) throw new Error(`切段失败（ffmpeg 退出码 ${r.status}）`)
        return describeImage(tmp, 'image/jpeg', `超长图（${size.width}×${size.height}）已切成 ${parts} 段，这是第 ${idx + 1} 段；要看别段传 part=${Math.min(parts - 1, idx + 1)}。`)
      }
      const needShrink = !size || size.height > 2000 || size.width > 1280 || buf.length > VIEW_MAX
      if (!needShrink) {
        return { path: full, width: size.width, height: size.height, bytes: buf.length, mimeType: IMAGE_EXT[ext], note: '原图，未压缩。' }
      }
      const r = spawnSync(FFMPEG, ['-y', '-i', full, '-vf', "scale='min(1280,iw)':'min(2000,ih)':force_original_aspect_ratio=decrease", '-q:v', '4', tmp], { stdio: 'ignore', windowsHide: true, timeout: 60000 })
      if (r.status !== 0 || !fs.existsSync(tmp)) throw new Error(`图片太大（${(buf.length / 1024 / 1024).toFixed(1)}MB）且压不下来（ffmpeg 退出码 ${r.status}），可以让主人截图。`)
      return describeImage(tmp, 'image/jpeg', '（原图较大，已压小成 JPEG）')
    } catch (error) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* ignore */ }
      throw error
    }
  }

  return { recall, note, taskAdd, taskList, inspirationAdd, inspirationList, inspirationUse, fileList, fileRead, imageView }
}

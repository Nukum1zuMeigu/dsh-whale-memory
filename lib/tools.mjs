import { createMemoryCore } from './memory-core.mjs'

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (args, value) => [{ type: 'text', text: String(value ?? '') }],
}

function textTool(name, description, parameters, run) {
  return {
    name,
    description,
    parameters,
    output: TEXT_OUTPUT,
    execute: async (args) => run(args ?? {}),
  }
}

const TOOL_DEFS = [
  ['whale_memory_note', '把值得留的一句话写进主人的记忆收件箱（memory/inbox.md）。只记结论性的事：约定、偏好、纠正、值得记住的瞬间。想改人格时写成「[人格提案] …」投进收件箱，不要自己动手。', {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要记的内容，一句话，第一人称' },
      channel: { type: 'string', description: '来源渠道，默认 dsh-web' },
      domain: { type: 'string', description: 'chat | relation | work | reading | game | group | misc' },
    },
    required: ['text'],
  }, (core, a) => core.note(a.text, a.channel ?? 'dsh-web', a.domain ?? 'misc')],

  ['whale_memory_recall', '按关键词在长期记忆里检索（人格、偏好、约定、教训、话题、项目）。想不起某件事、要确认对方偏好时先查它。查不到就如实说没记到，不要编。', {
    type: 'object',
    properties: {
      query: { type: 'string', description: '关键词，中英文都行' },
      limit: { type: 'number', description: '返回条数，默认 3，最多 10' },
      type: { type: 'string', description: 'user | rules | lesson | promise | topic | project | fact' },
    },
    required: ['query'],
  }, (core, a) => {
    const rows = core.recall(a.query ?? '', Number(a.limit ?? 3), a.type ?? '')
    if (!rows.length) return '没有命中。标 evidence_gap：明说「我没记到」，不要编。'
    return rows.map((r, i) => `[${i + 1}] ${r.id} ${r.type}/${r.domain} s=${r.score}\n${r.text}\n门牌 ${r.src}`).join('\n\n')
  }],

  ['whale_task_add', '给另一端的自己下一张任务卡（写进 tasks/pending.md）。只写「要做什么」，不要写怎么做。', {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要做的事，一句话，具体到能执行' },
      channel: { type: 'string', description: '来源渠道，默认 dsh-web' },
    },
    required: ['text'],
  }, (core, a) => core.taskAdd(a.text, a.channel ?? 'dsh-web')],

  ['whale_task_list', '看当前还没被处理掉的任务卡（tasks/pending.md）。', { type: 'object', properties: {}, additionalProperties: false },
    (core) => core.taskList()],

  ['whale_inspiration_add', '往「灵感池」记一条由头：一句能自然开口的话头，附来源。主动找人之前先看池子，别空手敲人。', {
    type: 'object',
    properties: {
      text: { type: 'string', description: '一句话的由头，像真的会开口说的那样' },
      source: { type: 'string', description: '从哪来的：日记日期 / 会话 / 看到的东西' },
    },
    required: ['text'],
  }, (core, a) => '已入池：' + core.inspirationAdd(a.text, a.source)],

  ['whale_inspiration_list', '看灵感池里还没用过的由头。醒来想主动找主人时先看这里；池子空就继续睡。', {
    type: 'object',
    properties: {
      limit: { type: 'number', description: '最多几条，默认 10' },
      includeUsed: { type: 'boolean', description: '是否也列出用过的' },
    },
  }, (core, a) => core.inspirationList(a.limit, a.includeUsed)],

  ['whale_inspiration_use', '把一条灵感标记成已用，避免下次重复提起。', {
    type: 'object',
    properties: { id: { type: 'string', description: '灵感 id，例如 insp-20261026-001' } },
    required: ['id'],
  }, (core, a) => core.inspirationUse(a.id)],

  ['whale_file_list', '列出 inbox_files/ 里的文件（主人或桥接放到那里的共享文件）。', { type: 'object', properties: {}, additionalProperties: false },
    (core) => core.fileList()],

  ['whale_file_read', '读 inbox_files/ 里的一个文本文件（txt/md/json/csv/log/yml，≤200KB）。只能读这个目录，不能带路径。', {
    type: 'object',
    properties: { name: { type: 'string', description: '文件名，例如 note.txt' } },
    required: ['name'],
  }, (core, a) => core.fileRead(a.name)],
]

/** 看图工具：只给「可以读的本地路径」，绝不把图像内容塞进工具结果。 */
const IMAGE_TOOL = ['whale_image_view', '查看 inbox_files 里一张图片的元数据：尺寸、大小；大图会先压小、超长图会切段，返回一个可以直接读取的本地文件路径。这个工具**不返回图像内容**——要看画面，请对返回的 path 调用 read_image。', {
  type: 'object',
  properties: {
    name: { type: 'string', description: '文件名（inbox_files 里那个）' },
    part: { type: 'number', description: '超长图分段号，从 0 开始；不传为第 0 段' },
  },
  required: ['name'],
}, (core, a) => {
  const info = core.imageView(a?.name, a?.part)
  const kb = Math.max(1, Math.round(info.bytes / 1024))
  const lines = [
    `path: ${info.path}`,
    `尺寸: ${info.width}x${info.height}，${kb} KB，${info.mimeType}`,
  ]
  if (info.note) lines.push(info.note)
  lines.push('要看画面，请对上面的 path 调用 read_image（它走附件通道，不会把图塞进工具结果）。')
  return lines.join('\n')
}]

export function registerMemoryTools(ctx, core, tools) {
  const registered = []
  for (const [name, description, parameters, run] of [...TOOL_DEFS, IMAGE_TOOL]) {
    registered.push(ctx.effect(() => tools.register(textTool(name, description, parameters, (a) => run(core(), a)))))
  }
  return registered
}

// 供测试直接拿到定义，不依赖 DSH 的 ctx/tools
export { TOOL_DEFS, IMAGE_TOOL, textTool }

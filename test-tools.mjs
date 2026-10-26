import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryCore } from './lib/memory-core.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tools-'))
const core = createMemoryCore(root)

fs.mkdirSync(path.join(root, 'memory', 'persona'), { recursive: true })
fs.mkdirSync(path.join(root, 'memory', 'long'), { recursive: true })
fs.writeFileSync(path.join(root, 'memory', 'persona', 'user.md'), '## mem-YYYYMMDD-001\n- type: user\n- status: active\n- src: diary/x.md#L1\n\n测试用的印象，随便写一句。\n')
fs.writeFileSync(path.join(root, 'memory', 'inbox.md'), '')
fs.mkdirSync(path.join(root, 'inbox_files'), { recursive: true })
fs.writeFileSync(path.join(root, 'inbox_files', 'a.txt'), 'hello 文件')

console.log('note:', core.note('测试一条', 'dsh-web', 'work'))
console.log('recall:', core.recall('印象').map((r) => r.id).join(',') || '未命中')
console.log('task:', core.taskAdd('把书架整理一遍'))
console.log('tasks:', core.taskList().trim())
console.log('insp:', core.inspirationAdd('要不要现在开工', '测试'))
const first = core.inspirationList().match(/insp-\d{8}-\d{3}/)[0]
console.log('inspList:', core.inspirationList().split('\n')[0])
console.log('inspUse:', core.inspirationUse(first))
console.log('inspAfter:', core.inspirationList())
console.log('files:', core.fileList())
console.log('read:', core.fileRead('a.txt'))
try { core.fileRead('../config.json') } catch (e) { console.log('越界拦截:', e.message) }

fs.rmSync(root, { recursive: true, force: true })
console.log('测试通过')

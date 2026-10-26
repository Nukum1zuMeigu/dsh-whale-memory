// 冒烟测试：落骨架 / 不覆盖 / 注入段 / 做梦提醒
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from './index.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-memory-'))
let section
const makeCtx = () => ({
  effect: (fn) => fn(),
  get: () => undefined,
  systemPrompt: {
    section: (s) => {
      section = s
      return () => {}
    },
  },
})

// 先跑一次：空工作区应该被落一套骨架
apply(makeCtx(), { root, nudgeAfterHours: 12 })
console.log('落骨架：', fs.existsSync(path.join(root, 'memory', 'long', 'facts.md')) ? 'OK' : '缺')
const plantedCore = fs.readFileSync(path.join(root, 'memory', 'persona', 'core.md'), 'utf8')
console.log('模板注入段是空的：', plantedCore.includes('<!-- inject:begin -->\n<!-- inject:end -->') ? 'OK' : '有内容（检查模板）')
console.log('空 inbox 不提醒：', section.text().includes('【记忆提示】') ? '错' : 'OK')

// 写一份测试人格，再跑一次 apply：已有文件不许被模板覆盖，注入段要读得到
const persona = '<!-- inject:begin -->\n我是 TEST-PERSONA-XYZ。\n<!-- inject:end -->\n'
fs.writeFileSync(path.join(root, 'memory', 'persona', 'core.md'), persona)
apply(makeCtx(), { root, nudgeAfterHours: 12 })
console.log('人格内容：', section.text().includes('TEST-PERSONA-XYZ') ? 'OK' : '没读到')
console.log('不覆盖已有文件：', fs.readFileSync(path.join(root, 'memory', 'persona', 'core.md'), 'utf8') === persona ? 'OK' : '被覆盖了')

// 改成「用了一阵子」的状态：inbox 两条、日记停在五天前
fs.writeFileSync(
  path.join(root, 'memory', 'inbox.md'),
  '- [2026-10-20] (dsh-web) 第一条 —— 测试\n- [2026-10-20] (dsh-web) 第二条 —— 测试\n',
)
const diaryDir = path.join(root, 'memory', 'diary')
for (const f of fs.readdirSync(diaryDir)) fs.rmSync(path.join(diaryDir, f))
const fiveDaysAgo = Date.now() - 5 * 24 * 3600 * 1000
const diary = path.join(diaryDir, '2026-10-20.md')
fs.writeFileSync(diary, '- 五天前的日记\n')
fs.utimesSync(diary, new Date(fiveDaysAgo), new Date(fiveDaysAgo))

const text = section.text()
console.log('提醒：', text.includes('【记忆提示】') ? text.split('\n').pop() : '没提醒（错）')

// inbox 清空后不再提醒
fs.writeFileSync(path.join(root, 'memory', 'inbox.md'), '')
console.log('清空后：', section.text().includes('【记忆提示】') ? '还在提醒（错）' : '不提醒了（OK）')

fs.rmSync(root, { recursive: true, force: true })
console.log('测试通过')

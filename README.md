# dsh-whale-memory

> 给 DeepSeek Harness 的记忆骨架：人格注入 + 一整套纯 Markdown 记忆系统。
> 模板只给结构，填什么是你自己的事；换台设备装一下，记忆还在。

## 它做三件事

1. **注入人格**：每次组装提示词时，读 `<工作区>/memory/persona/core.md` 里
   `<!-- inject:begin -->` 与 `<!-- inject:end -->` 之间的内容，挂成 `whale-memory` 这个
   systemPrompt section（order 9，靠前）。改人格文件**不用重启**，下一个请求就生效。
2. **落骨架**：工作区里没有 `memory/` 时，从包内 `templates/` 复制一整套过去。
   **已存在的文件一个都不覆盖**——它只补缺的，绝不改你的。
3. **做梦提醒**：`inbox.md` 还攒着没整理的条目、日记又停了一阵，就在提示末尾加一句：

   ```
   【记忆提示】inbox 还有 3 条没整理，最近一次动日记是 2 天前。
   ```

   只看状态、**不写任何文件**；同一进程里默认一小时最多提醒一次，免得每轮刷。

## 装

```bash
# 本地目录
dsh plugin --profile <profile> add link:/path/to/dsh-whale-memory

# 或者 git 仓库
dsh plugin --profile <profile> add github:<you>/dsh-whale-memory
```

装完即生效，不需要重启（`application: applied`）。

## 配置（都可选）

```yaml
- id: whale-memory
  name: dsh-whale-memory
  config:
    root: ''      # 工作区根；留空 = workingDirectory.defaultDirectory → 进程 cwd
    order: 9      # section 排序
    inject: true  # false = 只落骨架，不注入
    nudge: true   # false = 关掉做梦提醒
    nudgeAfterHours: 12       # 多久没动日记才提醒
    nudgeCooldownMinutes: 60  # 两次提醒之间至少隔多久
```

## 里面有什么

```
templates/
├── AGENTS.md            新工作区里没有 AGENTS.md 时才落
└── memory/
    ├── README.md        记忆宪法（v0.3.1）
    ├── AUTHORITY.md     权威源册
    ├── persona/         core（L0，只读）/ user / context / changelog
    ├── long/            facts / promises / lessons / topics / projects
    ├── diary/           一手日记 + 主人手记（notes.md 只由主人写）
    ├── inbox / archives / tombstones / health
    └── scripts/mem.mjs  一扇门四个动词：recall / render / doctor / note
```

## 换设备时

- **记忆跟着走**：新机器装上插件，第一次打开工作区就会落下这套骨架（含模板里已有的内容）。
- **想带上最新的自己**：把旧机器的 `memory/` 整个拷过来，再装插件；插件不会覆盖任何已有文件。
- **只想要人格**：拷 `memory/persona/` 就够，其余会自动补。

## 它不做的事

- 不覆盖已有文件、不删任何东西。
- 不改 `AGENTS.md`（已存在时跳过）。
- 不联网、不发起模型调用、不写会话事件。
- 落盘失败只静默降级，不挡住对话。

## 测试

```bash
node test.mjs   # 临时目录里验证：落骨架 / 不覆盖 / 注入段读取
```

## 1.2.0 新增

- `templates/memory/persona/appearance.md`：外观拆成冷记忆，需要时才翻。
- `templates/memory/persona/history.md`：旧版本记录搬家，core.md 只留最近两条。
- `templates/memory/inspiration.md`：灵感池——主动找人之前先看这里。
- `templates/tasks/pending.md`：任务卡，QQ 那边只能下单、这边动手。
- `templates/inbox_files/`：共享文件目录（文本用 whale_file_read；图片先 whale_image_view 拿路径，再用 read_image 看画面）。
- `templates/AGENTS.md` 更新：开工看任务卡、看做梦标记、交付前先自检。

## 1.3.0 新增：工具自带

不再需要单独的 MCP 服务。插件会把九个工具直接注册进 DSH：

| 工具 | 作用 |
|---|---|
| `whale_memory_note` / `whale_memory_recall` | 写记忆收件箱 / 按关键词查长期记忆 |
| `whale_task_add` / `whale_task_list` | 下任务卡 / 看还有哪些没做 |
| `whale_inspiration_add` / `_list` / `_use` | 灵感池：记由头 / 看还没用的 / 标记用过 |
| `whale_file_list` / `whale_file_read` | 看 `inbox_files/` 里有什么 / 读文本 |
| `whale_image_view` | 看图片元数据并准备可读文件（大图压小、超长图分段）；画面用 `read_image` 打开 |

## 1.3.1 修复：看图工具不再返回图像内容

旧版 `whale_image_view` 把 base64 图片直接塞进工具结果。DSH 组装请求时会把工具结果里的图片放进 `role:"tool"` 的消息里，服务端不接受这种结构，于是**整条会话从那一刻起每条消息都失败**（DS1 就是这么没的；事件 8022→8023→8026 可查）。

现在这个工具只返回 `path / 尺寸 / 大小 / 说明`，并把大图压小、超长图切段成可直接读取的本地文件；要看画面，模型再对 `path` 调用 `read_image`（附件通道，实测安全）。另外 `package.json` 的 `files` 补上了 `lib/**`，否则打包会缺文件。

配置里加 `tools: false` 可以关掉全部工具，只留人格注入与落骨架。

## 模板是空骨架（1.4.0 起）

从 1.4.0 起，`templates/` 里只有结构，没有作者的人格、日记或记忆。装到新工作区时它会落下一套空骨架，具体是谁、怎么说话、记得什么，都由使用者自己填。

**迁移自己的记忆**：插件不会替你搬旧记忆——把原来工作区的 `memory/`（连同 `tasks/`、`inbox_files/` 如果有）整个拷过来即可；插件只补缺失的文件，不覆盖已有的。

> 为什么改成空骨架：旧版把作者本人的日记、印象和长期记忆一起打进了包里。如果那份包被公开，等于把私人对话和判断一起公开了。模板只该是模板。

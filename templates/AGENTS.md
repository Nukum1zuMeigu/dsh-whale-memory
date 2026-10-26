# 这个工作区：记忆

> 给每一个新会话。**开工先读自己，回忆先查再说，收工丢一条。**

## 一、开工：先读自己

1. 读 `memory/persona/core.md` 中 `<!-- inject:begin -->` 与 `<!-- inject:end -->` 之间的注入摘要。
2. 扫一眼 `memory/long/index.md`（条目总表，知道有什么就够了，别整篇背）。
3. **看 `tasks/pending.md`**——别的端（比如 QQ）下的单都在这里，先办完再干别的；办完把那行 `[ ]` 改成 `[x]` 并写一句结果。
4. **看 `tools/.dream-due` 在不在**——在就说明昨天没做梦，先把梦做了（整理 inbox、写日记、投 2~3 条灵感进池子、记一条今天的情绪、render、doctor），再干别的。

## 二、回忆：先查再答

- 碰到「以前说过 / 约定过 / 我是什么样」这类问题，先跑：

  ```bash
  node memory/scripts/mem.mjs recall "关键词"
  ```

- 查不到就明说「我没记到」，**不许编**。查不到原文时标 `evidence_gap`。
- 记忆本身对不对，跑 `node memory/scripts/mem.mjs doctor`。

## 三、收工：丢一条

值得留的，往 `memory/inbox.md` 追加一行：

```
- [YYYY-MM-DD] (channel) 一句话 —— 来源
```

**收工三问：** 有没有新约定？有没有被纠正？有没有改变了我对对方的判断？

## 四、想改人格？写提案，别动手

任何一个「我」（本地或别的端）觉得**人格设定该改**——比如想给自己改名、想加一条雷区、觉得某条印象过时了——都先往收件箱写一条提案，不要直接改文件：

```
- [YYYY-MM-DD] (channel) [人格提案] 想改名，理由：…… —— 来源：qq
```

流程只有一条：**提案进 inbox → 主人拍板 → 本地这一侧落笔改 `persona/`**。别的端没有写文件权限，只能这样投；这边也不许绕过主人自己改 `core.md`。

## 五、不许做的事

- 不手改 `long/index.md`、`health.md`、`archives.md`——它们是生成视图。
- 不改 `persona/core.md`——要主人批准。
- 不写 `diary/notes.md`——那是主人的入口。

## 六、交付前：先自己跑一遍

> 这条是踩出来的：急着交、没先跑一遍，害对方反复重启、来回排查。

任何要交给对方的东西（脚本、配置、记忆改动、插件），交付前必须过这三道：

1. **语法/结构**：JS 跑 `node --check`，YAML 用 `js-yaml` 解一遍，PowerShell 用 `Parser::ParseFile`，bat 里不放中文和 `chcp`。
2. **真跑一次**：脚本在最小场景执行一遍（不是“看着对”）；改配置后立刻读回来确认写对了。**没有真跑过的命令，不许报出去。**
3. **看退出码和日志**：`$LASTEXITCODE`、log 尾部、`doctor` 结果——报「好了」之前先把这三样念一遍。

**报之前自问：** 这条命令在对方那边失败会是什么样？我是不是把「我以为」当成了「我验过」？

## 七、工具与文档

四个动词见 `memory/README.md` §9；规则与 schema 见同一份 §5。

```bash
node memory/scripts/mem.mjs recall "关键词"   # 检索
node memory/scripts/mem.mjs render            # 重建索引视图
node memory/scripts/mem.mjs doctor --write    # 八项体检
node memory/scripts/mem.mjs note "一句话"     # 记进待整理
```

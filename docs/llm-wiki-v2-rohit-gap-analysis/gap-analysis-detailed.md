# LLM Wiki v2 — Rohit Gist 对照差距分析（详解版）

> 本文是 `gap-analysis.md` 的逐项展开版。主报告结论精简、条目清单清楚；本文详解**每一处差距的代码证据、后果场景、根因和立场**。两份配合看。

---

## 阅读顺序

- 先看 [`gap-analysis.md`](./gap-analysis.md)：15 项对照表 + 执行摘要
- 想深挖哪一项再查本文对应章节
- 想落地修复直接跳到 [第四部分：修复建议详解](#四修复建议详解)

---

# 一、4 处语义漂移（字面实现，语义偏离）

## ① Confidence decay —— 静态固化 vs 持续衰减

### Rohit 原意

gist 里的原话：

> "Facts should carry confidence scores reflecting source count, recency, and contradictions. **Confidence decays over time but resets with reinforcement.**"

这句读起来，confidence 是个**活的**数字：今天写入是 0.85，三个月不动它自己降到 0.6，下次有新来源 reinforce 一次又跳回 0.9。用户脑子里的模型是"记忆会褪色"。

### 代码实际怎么写的

关键函数在 `src/lib/lifecycle.ts:87-183` 的 `calculateLifecycleMetadata()`：

```
confidence = baseScore
           - agePenalty(ageDays, halfLife)
           - contradictionPenalty
           + reinforcementBonus
```

**关键点：这是个纯函数**。它被调用的时机只有两处：

1. `src/lib/ingest.ts:896` —— **ingest 时调用一次**，把算出来的数字**写死进 YAML frontmatter**
2. 用户手动点 Settings → Maintenance → Run patrol —— 才会对所有 page 重跑这个函数

中间这段时间（可能几个月），frontmatter 里的 confidence 就是写死那天的值。没有定时器、没有后台线程、没有 cron、没有 setInterval。

用 ageDays 算 penalty 的那一行：

```ts
// lifecycle.ts 附近
const ageDays = (today - last_confirmed) / DAY_MS
const agePenalty = Math.min(0.22, Math.max(0, ageDays) / halfLife * 0.08)
```

`today` 是**传入参数**，不是 `Date.now()`。调用方（ingest / patrol）决定"今天是哪天"，所以纯粹是个**按需查询**的数学函数。

### 差距的后果

具体场景：

- 你 2026-01 ingest 了一篇论文，confidence 算出来 0.90，写进 frontmatter
- 接下来 4 个月没动这页
- 2026-05 你在 chat 里问相关问题，搜索命中这页，用来回答你
- **此时这页在 context 里呈现的 confidence 仍然是 0.90**——不是理论上应该有的 0.70+ 衰减值
- LLM 把 0.90 当成"最近验证过"的信号去权衡，实际这已经是 4 个月前的判断

**除非**你这 4 个月里点过一次 patrol，否则系统没机会 re-score。

### 为什么出现这种差距

旧的实现边界把 daemon 也一起砍掉了。这样虽然保护了 Markdown 不被后台任务偷偷改写，但也导致 schedule 维护缺位：没有固定周期的本地 due check，就没有稳定的重评分入口，只能靠用户主动触发或现有 event-threshold auto patrol。

这和缺口 #10（schedule 事件缺失）是**一枚硬币的两面**。要保住 local-first 和 Git-friendly，反对的应该是远程 memory server、OS 级常驻服务和后台静默改 Markdown；不应该反对 app 运行期的本地维护循环。

**修复方向**：两层一起做。第一，让"过期"这件事在 UI 可见；第二，补一个 app-resident local maintenance daemon，app 运行或隐藏时默认每 15 分钟做轻量 due check。是否真正跑 patrol 仍受 `autoPatrolEnabled`、cooldown 和 due 条件控制，且不自动重写 Markdown。

---

## ② Post-ingest lint hints —— 写入后缺健康反馈

### Rohit 原意

gist 的 automation 部分明确提出：

> "On new source: auto-ingest, extract entities, update graph, update index"

它的 quality/self-correction 部分又强调 lint/self-healing 不该只靠用户想起来才跑。严格说，raw gist 没有把 `auto-lint` 写成一个精确的 ingest 阶段；但从 Rohit v2 的方向看，新 source 写入后至少应该有本地健康反馈，而不是完全依赖用户手动打开 Lint 面板。

### 代码实际怎么写的

`src/lib/ingest.ts` 1828 行，完整 grep 关键字 "lint"：

- **0 处** `runStructuralLint(` 调用
- **0 处** `runSemanticLint(` 调用
- 唯一出现 lint 字样的是行 1473 的注释："which means the lint view's orphan-page sweep eventually..."

而 `src/lib/lint.ts:153-299` 的 `runStructuralLint` 和 `runSemanticLint`：

```ts
export async function runStructuralLint(projectPath: string): Promise<LintResult[]>
export async function runSemanticLint(projectPath: string, ...): Promise<LintResult[]>
```

都是"显式调用"设计——需要传 `projectPath`，返回 `LintResult[]` 让调用方决定怎么用。实际调用方只有 `src/components/lint/` 下的 UI 组件（用户在侧边栏点"Lint"才跑）。

ingest 的真实管道：

```
LLM 分析 → LLM 生成 → parse FILE blocks → page-merge →
enrich lifecycle frontmatter → claim extraction →
pre-write conflict gate → 写磁盘 → 写 audit event
```

**post-ingest structural lint hints 完全没有**。

### 差距的后果

具体场景：

- 你 ingest 一篇讲"李飞飞离开斯坦福"的新论文
- LLM 生成了新的 `wiki/entities/li-feifei.md`
- 但它在 body 里写了 `[[stanford-ai-lab-roster]]` 这个 wikilink
- 而你的 wiki 里从来没有这个页面 —— 这是个 **broken wikilink**
- Activity Panel 显示"ingest 成功 ✅"
- 你完全不知道出了个死链
- 直到某天你**想起来**打开 Settings → Lint，扫一遍，才看到这个问题

orphan page（没人链接它的新页）、broken wikilink（指向不存在的页）、以及低质量 metadata（缺 title、缺 tags）—— 这三类问题都是 ingest 那一刻**最容易捕捉、也最容易修复**的，却被推到了用户主动触发的 lint 面板里。

### 为什么出现这种差距

我的推测：担心 ingest 路径太重。ingest 本身已经有两次 LLM 调用 + embedding + pre-write conflict gate + audit，再加 lint 可能让"Activity Panel 一直转圈"的问题恶化。

但这个担心过度了——structural lint 是**纯本地文件扫描**，没有 LLM 调用，几百毫秒量级。完全可以在 ingest 末尾 fire-and-forget 跑一次，结果写到 `.llm-wiki/ingest-lint-hints.json`，UI 异步读取。

**这个是最该修的一条**。P0 优先级、代码量不大、收益很直接。注意只跑 structural lint，不在 ingest 路径里跑 LLM semantic lint。

---

## ③ Contradiction detection —— 元数据驱动 vs 语义理解

### Rohit 原意

gist 里 Lint Operations 部分：

> "Lint operations: Fix orphan pages, mark stale claims, repair broken references, **flag contradictions**"

还有 Memory lifecycle 部分：

> "Confidence decays over time but resets with reinforcement. This prevents equal weighting of 'I saw this once' versus **'confirmed twelve times.'**"

读起来像：系统能看出"页 A 说 X=true、页 B 说 X=false"，然后给你报个冲突。

### 代码实际怎么写的

contradiction 在这个项目里**完全是元数据驱动**。证据链：

**在 `src/lib/prewrite-conflict-resolver.ts`**：

```ts
// 判断一个 evidence 是不是矛盾证据
function isContradictionEvidence(evidence) {
  return evidence.status === "contradicted"
      || evidence.relation === "contradicts"
}
```

`status` 和 `relation` 这两个字段来自**已经存在的 claim 记录**——也就是说，系统只看 "别人已经标过这是矛盾"，不做任何自己的判断。

**在 `src/lib/lifecycle.ts:151-154`**：

```ts
if (contradicts.length > 0 || reviewStatus === "contradicted") {
  // 降低 confidence、加 review_status tag...
}
```

同样，`contradicts` 是 frontmatter 里的数组字段（page 作者/LLM 填的），`review_status` 是显式值（"ok" | "needs-review" | "stale" | "contradicted"）。

**这两个字段是谁填的？**

1. 用户手动编辑 frontmatter —— 罕见
2. ingest 时 LLM 按 prompt 要求生成 —— 主要路径
3. pre-write conflict gate 检测到"两个 claim 关于同一 entity 但 status 不同"时填 —— 确定性规则匹配

**关键点**：第 3 种路径里的"检测"也是**规则匹配**，不是语义理解。它看的是：

- claim A 关于 entity `"Python GIL"`
- claim B 也关于 entity `"Python GIL"`
- A.assertion = "removed in 3.13"
- B.assertion = "still present in 3.12"
- 字符串相等？**不等，所以不报冲突**

真正的语义对比（"A 说移除了 B 说还在，这明显矛盾"）需要 LLM，系统**从不调用 LLM 来做这件事**。

### 差距的后果

具体场景：

- ingest 论文 1 —— LLM 生成 claim "LLM 的 scaling law 在 100B 参数后收益递减"，写入 `wiki/concepts/scaling-law.md`
- 几个月后 ingest 论文 2 —— LLM 生成 claim "Chinchilla 表明 scaling law 仍然线性，只是数据量需求被低估"
- 两个 claim **语义上是冲突的**（一个说收益递减，一个说仍线性）
- 但它们的 `contradicts` 字段都是空数组
- 系统不会标这个矛盾
- 用户查询 "scaling law 现在怎么理解" —— LLM 同时拿到两段话作为 context，自己去调和

**反面**：如果第二次 ingest 时 LLM 聪明地写 `contradicts: ["scaling-law-claim-2024-06"]`，系统就能检测。**这完全取决于 LLM 那一下是否主动标了**。

### 为什么出现这种差距

这是 **gnusupport 派的明确选择**。评论区原话：

> "numeric confidence scores mask weak evidence chains, and auto-write hooks corrupt wikis with LLM hallucinations"

他的立场是：**不要让 LLM 决定"这俩矛盾"**，因为 LLM 会幻觉——让人类或显式规则决定，LLM 只做提议。

llm_wiki_v2 采纳了这个立场：contradiction 必须通过显式元数据标注才成立。**好处**是 Markdown 不会被 LLM 莫名其妙添上"矛盾"标签；**代价**是真正语义级的矛盾检测不存在。

**是否该修**：见 P2 建议——可以加一个"Deep contradiction scan"按钮，专门跑一次 LLM 语义对比，但结果只**建议**（写到 review 队列），不自动改 Markdown。保住了 gnusupport 立场，又补上了语义层的能力。

---

## ④ Output formats —— 只导审计日志，不导 wiki 内容

### Rohit 原意

gist 里明确列出：

> "The document references: **comparison tables, timeline visualizations, dependency graphs, slide decks, JSON/CSV exports, structured briefs for team members.**"

用户读完会以为："我可以让 LLM 生成'这三篇论文对比表'然后导出成 CSV"、"关于 XX 主题的 wiki 片段导出成 slide deck 去汇报"。

### 代码实际怎么写的

唯一的导出路径在 `src/lib/audit-export.ts`：

```ts
export type AuditExportFormat = "json" | "csv"

export async function exportAuditEvents(
  projectPath: string,
  format: AuditExportFormat,
  filters: AuditFilter,
): Promise<string> {
  // 读 .llm-wiki/audit.jsonl
  // 过滤、格式化
  // 写到 .llm-wiki/exports/audit-{timestamp}.{json|csv}
}
```

这个函数**只导出审计事件**（比如"2026-03-15 user applied lifecycle patch to page X"）。

全仓库 grep 以下关键词：
- `marp` —— 0 处
- `slide` —— 0 处（除了 UI 术语）
- `matplotlib` —— 0 处
- `dot graph` / `graphviz` —— 0 处
- `comparison table export` —— 0 处
- `timeline export` —— 0 处

**一个都没有**。

### 差距的后果

用户视角：

- ingest 了 10 篇关于"分布式训练"的论文
- 在 chat 里问"帮我对比这些论文的 pipeline parallelism 策略"
- LLM 给出了一个漂亮的 markdown 表格
- 用户想把这个表放到周报里
- 只能**手动复制粘贴**（markdown 在 PPT 里不渲染成表格）
- 或者用 Obsidian 打开 vault，用 Marp 插件自己搞

这个缺口**最刺痛**——因为 gist 里 "comparison tables" 和 "slide decks" 是用来论证 **wiki 的价值不只是保存、而是生产**的核心例子。没有这一层，wiki 变成了一个"看得见但用不出去"的黑箱。

Obsidian 兼容性填补了一部分——把项目目录当 vault 打开，Obsidian 插件链可以做 Marp、Dataview 表等。但**这属于"你自己去折腾"**，不是产品交付。

### 为什么出现这种差距

这是**纯粹的功能缺口**，不像 ①②③ 是立场取舍。我的推测：团队先把 ingest / search / graph / lifecycle 这些**更底层的**东西做扎实了，上层的"知识变现"功能还没排到议程。

**是否该修**：P1 优先级。哪怕只做一个能力——"把一个 markdown page / 一组 query 答案导出成 Marp slide"——就能覆盖 80% 的实际需求。Marp 本身是纯 markdown + frontmatter，技术栈完全吻合，工作量不大。

---

# 二、2 处产品/架构缺口

## ❌ Mesh sync / shared-private scoping

### Rohit 原意

Rohit 的 Implementation Spectrum 里，第 6 级（最后一级）：

> "**Add collaboration**: mesh sync, shared/private scoping"

设想：两个用户各自维护 wiki，某些 page 标 `scope: shared` 自动同步到对方，`scope: private` 留本地。团队协作就不用共享 Obsidian vault 了。

### 现状

- `lifecycle.ts` 里有 `scope: "private" | "shared"` 字段定义
- `audit-redaction.ts` 在导出时会 mask private scope 的字段（防止导出时泄漏）
- `coordination-summary.ts` 显示本地 actor 活动汇总

**但**：
- 没有任何网络代码去同步 shared page
- 没有多实例的 conflict resolution
- 没有 ACL（谁能看什么 page）

### SPEC 立场

明确写死：

```
## Non-Goals
- No remote backend, new database, auth system, or multi-user ACL.
- No full multi-agent mesh sync.
```

### 评价

**属于明示放弃，不是遗漏。** 而且保留 `scope` 字段是正确的——将来真要接同步，frontmatter schema 不用改，直接加同步后端就行。

对单用户场景完全没影响。如果你的使用场景是团队协作，这个项目**目前不是正确选择**（Obsidian + Git + sync plugin 更合适）。

---

## ❌ Schedule 事件 / 定期衰减 / 自动巡检

### Rohit 原意

Lifecycle Events 列表里：

> "On schedule: periodic lint, retention decay, consolidation"

设想：每周/每月跑一次 lint，衰减所有 page 的 confidence，把旧的 working memory 压缩成 episodic memory。

### 现状

`wiki-automation-events.ts` 里定义的事件类型：

```
session.start / session.end
memory.write
schema.scan
quality.scan
digest.preview / digest.save
```

**没有 `schedule` 事件**。

Auto patrol 的触发机制是"**用户操作累积**触发"而不是"**时间**触发"：

```
用户 query / search / review 活动
→ 标记 "patrol due"
→ 达到阈值 + cooldown 满足
→ 下次用户打开 Maintenance 面板时提示
```

没有默认 15 分钟的 app-resident maintenance loop。

### Local-first 立场

应反对的是远程 memory server、app 完全退出后的 OS 级常驻服务、以及后台静默改 Markdown；不应反对 app 运行期的本地维护循环。

### 评价

**和漂移 ① 是一枚硬币的两面**：

- 没有 schedule 事件 → confidence 无法持续衰减 → 只能静态固化
- 想让 confidence 更接近"活"，就必须引入某种 schedule → 本期应做 app-resident local daemon，而不是远程/OS 级 daemon

**第三条路**（P2 建议）：app 运行期间默认每 15 分钟做一次轻量 due check；如果超过 patrol threshold，就弹非阻塞通知；如果 policy 允许并且 cooldown 满足，再调度 deterministic patrol。这是 local app daemon，app 退出后停止，仍然不自动改写 Markdown。

这个模式很成熟（VS Code 的扩展更新检查就是这个套路），值得加。

---

# 三、评论区之争：这个实现站在哪一派？

Rohit gist 的评论区有一场关键辩论。把两派立场对比一下：

| 争议点 | Rohit 原派 | gnusupport 派 | llm_wiki_v2 实际选择 |
|-------|-----------|--------------|------------------|
| **LLM 自动写入 wiki** | ✅ 信任 LLM，自动写 | ❌ 人类闸门，LLM 只建议 | **人类闸门**（`prewrite-conflict*.ts` 的 5 个文件） |
| **Confidence 持续衰减** | ✅ 后台 decay 曲线 | ❌ 显式 supersession 靠 Git | **静态固化 + 手动巡检**（漂移 ①） |
| **Contradiction 检测** | LLM 语义对比 | 显式元数据标注 | **显式标注**（漂移 ③） |
| **Crystallization** | 自动压缩所有 session | 用户逐条审核 | **event 预生成 + 用户点 save**（`session-crystallization.ts`） |
| **Background maintenance** | ✅ on-schedule | ❌ 显式触发 | **本期补 app-resident local daemon**，不自动写 Markdown |

**写入闸门、contradiction 和 crystallization 明显站 gnusupport；maintenance schedule 则应该吸收 Rohit 的自动化方向，但用 local-first 方式落地。**

### 为什么这个立场是正确的

gnusupport 立场的核心论点：

> "auto-write hooks corrupt wikis with LLM hallucinations"

具体场景：

- 你 ingest 一篇论文，LLM 幻觉出一个 claim "Transformer 是 Google 2014 年发明的"（实际 2017）
- 如果是自动写入：这个错误 claim 直接进 Markdown，reinforce 其他页引用它，污染传播
- Git 里：你要 diff 30 个文件才能找到污染源
- 如果是 pre-write gate：gate 发现这个 claim 和现有 "Transformer (2017)" 页冲突 → 弹到 review 队列 → 你一眼看见，拒绝

**Markdown-first + Git-friendly** 的核心诉求是：**任何写入都应该是 Git 可追溯的、可 revert 的**。所以 daemon 可以存在，但只能做 due check、提醒、审计和 policy-gated deterministic patrol；不能绕过 review 自动判真或静默重写 Markdown。

### 问题：这个立场没告诉用户

用户读 README 会按 **Rohit 原派** 的心智模型去理解（因为 README 引用了 Rohit gist），体验到的是 **gnusupport 风味**。落差就来自这里。

**最低成本的修复**就是在 README 开头加一段：

```
## Design philosophy

Markdown-first, human-gated, local app daemon, no remote memory server. This is an opinionated
choice: LLMs generate, humans approve, Git tracks everything.
Confidence scores are snapshots at write time, not live decaying values.
Contradictions are explicit metadata, not LLM semantic judgments.
Crystallization requires a user click, not automatic session compression.
The local daemon can remind and run policy-gated maintenance while the app is
running, but it does not rewrite Markdown without review.

If you want fully autonomous memory that "feels alive," this is not that
system. That's by design—we believe explicit is safer than auto-magic.
```

这段话加上去，期望一致了，所有"语义漂移"从"产品 bug"变成"设计特性"。

---

# 四、修复建议详解

按 **ROI（成本 vs 价值）** 排序：

## P0：低成本、高价值

### 修复 1：Post-ingest lint hints（修复漂移 ②）

**改动位置**：`src/lib/ingest.ts` 结尾（audit event 写完之后）

**伪代码**：

```ts
// 在 ingest 的 finally 分支添加
try {
  const lintHints = await runStructuralLint(projectPath)
  if (lintHints.length > 0) {
    await writeFile(
      `${projectPath}/.llm-wiki/ingest-lint-hints.json`,
      JSON.stringify({
        ingestId,
        timestamp: Date.now(),
        hints: lintHints
      })
    )
  }
} catch (err) {
  // best-effort, don't fail ingest
  console.warn("post-ingest lint failed:", err)
}
```

**UI 侧**：Activity Panel 订阅这个文件，检测到就显示一个小徽章"X hints from last ingest"，点击跳转到 Lint 面板。

**工作量**：~100 行代码 + 1 个 UI 组件
**风险**：几乎零——structural lint 是纯本地扫描，出错也不影响 ingest 主流程
**收益**：broken link / orphan page 第一时间可见，避免"数月后才发现"

### 修复 2：README 立场声明

**改动位置**：README.md 最前面（"What is this?" 之前）

**内容**：上面 gnusupport 段落那一坨

**工作量**：10 行文档
**风险**：零
**收益**：消除用户期望错位，之后所有"为什么不自动"的 issue 都能被这段话回答

---

## P1：中成本、高产品价值

### 修复 3：Wiki 内容导出（修复缺口 ④）

**选一个最窄的切入点**：**Marp slide deck 导出**。

原因：
- Marp 本身是 markdown + frontmatter，技术栈完全吻合
- 一个 query page（`wiki/queries/*.md`）就是一个答案，天然适合变 slide
- Milkdown 已经有 math / markdown 渲染，可以复用

**改动**：

1. 新建 `src/lib/marp-export.ts`：
   ```ts
   export function pageToMarp(page: WikiPage): string {
     return [
       "---\nmarp: true\ntheme: default\n---\n",
       `# ${page.title}\n`,
       splitBodyIntoSlides(page.body),  // 按 H2 切片
     ].join("\n")
   }
   ```

2. 新建"Export to Marp"按钮在 preview 面板
3. 调用 Tauri `dialog.save` 让用户选位置

**工作量**：~200 行 + UI
**风险**：低（纯字符串处理）
**收益**：覆盖 gist 明说但完全没实现的最重要场景

**进一步**（可选）：comparison table 类型的 query 导出为 CSV（已经是 markdown 表格，解析成 CSV 直接）。

### 修复 4：Confidence 过期 UI 提示（缓解漂移 ①）

**改动位置**：`src/components/editor/frontmatter-panel.tsx`

**逻辑**：

```ts
const staleDays = (Date.now() - lastConfirmed) / DAY_MS
if (staleDays > halfLife) {
  show <Badge variant="warning">
    Last confirmed {staleDays}d ago. Confidence may be stale.
    <Button onClick={runPatrol}>Refresh</Button>
  </Badge>
}
```

**工作量**：~50 行
**风险**：零
**收益**：静态固化带来的问题**变得可见**——用户知道该刷新了就会刷新

**关键**：这不是让 confidence "变活"，而是让"confidence 是死的"这件事**对用户透明**。成本低得多，效果类似。

---

## P2：高成本、战略性

### 修复 5：App-resident local maintenance daemon（缓解缺口 ❌ schedule）

**改动位置**：新增 `src/lib/local-maintenance-daemon.ts`，并在 `src/App.tsx` / layout store 中接入 project lifecycle

**逻辑**：

```ts
startLocalMaintenanceDaemon(project, {
  intervalMs: 15 * 60 * 1000,
  onReminder: showMaintenanceBanner,
})

// 每 15 分钟只做轻量 due check。
// 是否真正调度 patrol 继续由 autoPatrolEnabled、cooldown、event/time due 控制。
```

**工作量**：~150 行核心 + 通知 UI + 测试
**风险**：中（需要避免重复 interval、project switch 泄漏、高频扫描）
**收益**：介于"远程/OS daemon"和"纯手动"之间的 local-first 第三条路，缓解 confidence 静态固化和用户忘记巡检的问题

### 修复 6：Deep contradiction scan（后续手动增强 ③）

**改动位置**：新建 `src/lib/deep-contradiction-scan.ts`

**逻辑**：

```
for each pair of claims in the same entity cluster:
  if both mention same subject + different predicates:
    ask LLM "are these contradictory? yes/no + reason"
    if yes: write to .llm-wiki/contradiction-suggestions.jsonl
```

**工作量**：~300 行 + Memory Ops 面板按钮
**风险**：中（LLM 调用成本、误报率）
**收益**：补齐 gist 承诺的"语义级 contradiction 检测"

**关键设计**：**结果只写到 review 队列**，不自动改 Markdown。保住 gnusupport 立场。

---

## 建议不修的（继续 Non-Goal）

- **Mesh sync** —— 改变项目定位，单用户场景不需要
- **OS 级常驻 daemon / app 退出后后台服务** —— 权限、升级、卸载、日志和资源边界都需要单独设计；本期只做 app-resident local daemon
- **Span-level claim provenance** —— 价值/复杂度不成比例

---

# 五、回到最原始的问题：这实现得怎么样？

**我的判断**：这是少数真正**把 v2 理念做扎实的项目**，而不是停在"copy gist → 生成几个 entity page"这种表面层。

证据：
- `src/lib/` 里 150+ 个模块，几乎每个都有对应测试
- 1082 个 mock 测试 + 55 个 Rust 测试全绿
- pre-write conflict gate 是真的做了一整套 classifier（7 种 verdict），不是占位符
- 关系类型有 8 种（related_to / uses / depends_on / contradicts / supersedes / supports / derived_from / mentions），每种都在 typed-graph / frontmatter-relations / page-merge / wiki-page-delete 四个地方保持一致——这需要大量工程纪律
- audit.jsonl 的 redaction + export + timeline 完整

**但**它不是 Rohit 原派的"任由记忆自己活、自己写"的系统。它应该是 local-first 派：记忆维护可以有 app 内后台循环，但写入仍是快照、人类闸门和 Git 可追踪。

这两者都不错，各有各的受众。问题只在**没讲清楚自己是哪一派**。

**如果让我打分**：
- 对照 Rohit gist 原意：**7/10**（4 处漂移 + 2 处未实现）
- 对照自家 SPEC：**10/10**（14 条 Done，工程质量高）
- 作为 local-first / human-gated v2 的参考实现：**9/10**（值得作为范本）

**一句话总结**：这不是"没做完的 Rohit v2"，而是"local-first、human-gated 的 Rohit v2"——把这件事在 README 里讲清楚，并补上 app-resident daemon，它就从"差点意思"变成"有立场的精品"。

---

*生成时间：2026-05-10*
*配套主报告：[`gap-analysis.md`](./gap-analysis.md)*
*分析对象：llm_wiki_v2 @ main (6b344e4)*

# LLM Wiki v2 — Rohit Gist 对照差距分析

> 方法：以 Rohit gist（https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2）的设计意图为基准，逐项对照 `src/lib/` 和 `src-tauri/` 的实际代码深度。后续执行按 **local-first** 收口：允许 app 运行期本地后台维护循环，不引入远程 memory server、mesh sync、多用户 ACL 或静默 Markdown 改写。

---

## 执行摘要

**总体分数：7/10。** 这个实现已经远超"把 gist 抄一遍"的水平，是少数真的把 v2 理念拆成确定性、本地优先、Git 友好工件的项目。15 个核心概念里，**9 个实现到位**、**4 个字面实现但语义漂移**、**2 个明确产品/架构缺口**。

核心取舍正确：
- Markdown 保持为唯一 source of truth，所有 lifecycle / graph / vector 是 **derived**
- 冲突 gate 站在 gnusupport 那一派（人类闸门 + 显式 supersession），而不是 Rohit 原派（自动写入 + decay 曲线）

主要差距集中在三处：
- **Confidence decay 是静态固化的，不是持续衰减**——写入时算一次，之后不会随时间自动贬值
- **Post-ingest lint hints 完全没有**——Rohit 的 automation/self-healing 方向要求新 source 写入后有健康反馈，实际 ingest 成功后没有 structural lint 出口
- **Mesh sync / 输出格式多样性（Marp、timeline、comparison table 导出）完全缺失**
- **Schedule 维护缺少本地 daemon 形态**——已有 event-threshold auto patrol，但没有 app-resident 15 分钟本地维护循环

---

## 逐项对照表

| # | Rohit 概念 | 实现状态 | 深度 | 关键文件 |
|---|----------|---------|------|---------|
| 1 | Memory lifecycle / confidence score | ⚠️ 字面实现，语义漂移 | 静态固化，非持续衰减 | `src/lib/lifecycle.ts`, `src/lib/claim-confidence.ts` |
| 2 | Supersession over deletion | ✅ 到位 | 双向字段 + 合并 union | `src/lib/frontmatter-relations.ts`, `src/lib/page-merge.ts` |
| 3 | Consolidation tiers (working/episodic/semantic/procedural) | ✅ 到位 | 四层 + 各自 half-life | `src/lib/lifecycle.ts` |
| 4 | Knowledge graph with typed relationships | ✅ 到位 | 8 种边类型 + 邻接缓存 | `src/lib/typed-graph.ts` |
| 5 | Audit trail | ✅ 到位 | append-only + redaction | `src/lib/audit-timeline.ts` |
| 6 | Hybrid search (BM25 + vector + graph + RRF) | ✅ 到位 | 三路并行 + RRF 融合 | `src/lib/search.ts`, `src/lib/search-bm25.ts` |
| 7 | Ingest automation + self-healing lint | ⚠️ 写入做了，post-ingest structural lint 缺失 | 成功后没有健康反馈出口 | `src/lib/ingest.ts`, `src/lib/lint.ts` |
| 8 | Query process (三路融合 + 上下文注入) | ✅ 到位 | 60/20/5/15 预算分配 | `src/lib/search.ts` |
| 9 | Lint operations (orphan/stale/broken/contradiction) | ⚠️ 做了但 contradiction 只是元数据驱动 | 无 LLM 语义对比 | `src/lib/lint.ts` |
| 10 | Lifecycle events (session/memory/schedule 钩子) | ⚠️ 事件有，app-resident schedule daemon 缺失 | 有 policy auto patrol，无 15 分钟本地维护循环 | `src/lib/wiki-automation-events.ts`, `src/lib/memory-ops.ts` |
| 11 | Crystallization | ✅ 到位 | event 预览 + user 确认 | `src/lib/crystallize.ts`, `src/lib/session-crystallization.ts` |
| 12 | Mesh sync / shared-private scoping | ❌ 仅本地 scope 字段 | 无远程同步 | `src/lib/lifecycle.ts` (scope only) |
| 13 | Human write-gate（评论区争议点） | ✅ 到位且立场清晰 | 冲突 gate 作为主路径 | `src/lib/prewrite-conflict*.ts` |
| 14 | Schema as contract | ✅ 到位 | 机器可读 YAML block + drift scan | `src/lib/schema-contract.ts` |
| 15 | Output formats (Marp/table/timeline/CSV) | ❌ 仅审计事件 JSON/CSV | 无 wiki 内容导出 | `src/lib/audit-export.ts` |

---

## 4 处语义漂移（字面实现，但偏离原意）

### ① Confidence decay —— 静态固化 vs 持续衰减

**Rohit 原意**：`"Confidence decays over time but resets with reinforcement"`——暗示一个**持续的、后台的**衰减过程。你三个月不看某页，它的 confidence 应该自己变低。

**实际实现**：
- `src/lib/lifecycle.ts:87-183` 的 `calculateLifecycleMetadata()` 是**纯函数**，写入时计算一次 confidence 值，**固化**到 frontmatter
- 之后没有固定周期的 app-resident daemon 重跑这个函数
- 用户可以去 Settings → Maintenance 手动点"Run Memory Ops patrol"，也可能由现有 event-threshold auto patrol 触发
- 但现有触发是活动阈值 + cooldown，不是默认 15 分钟本地维护循环

**语义差距**：如果用户没有触发 patrol，一个半年前写的页面 confidence 还是半年前那个值。Rohit gist 给人的感觉是"时间流逝本身就会贬值"，实际是"时间流逝+用户活动/手动维护触发巡检才会贬值"。

**能接受吗**：作为 local-first 取舍可以接受，但应该补一个 app-resident local maintenance daemon：app 运行或隐藏时默认每 15 分钟做轻量 due check；是否自动跑 patrol 继续受 `autoPatrolEnabled`、cooldown 和 due 条件控制。不要做远程 daemon 或 OS 级常驻服务，也不要让后台任务绕过 review 自动改 Markdown。

---

### ② Post-ingest lint hints —— 成功写入后缺健康反馈

**Rohit 原意**：gist 的 automation 部分强调 `"On new source: auto-ingest, extract entities, update graph, update index"`，quality/self-correction 部分又强调 lint/self-healing 应该让 wiki 持续趋于健康。合在一起看，新 source 写入后至少应该有本地健康反馈，而不是把 lint 完全留给用户记忆。

**实际实现**：
- 扫遍 `src/lib/ingest.ts` 1828 行，**没有任何对 `runStructuralLint` / `runSemanticLint` 的调用**
- `lint.ts` 里那两个函数都是纯导出给 UI 用的（Settings → Maintenance → Lint）
- ingest 的真实管道是：`extract → build conflict preview → enrich lifecycle → write pages → record audit`

**语义差距**：Rohit v2 的方向是降低 wiki maintenance bookkeeping；实际要用户自己去开 Lint 面板跑一次。很多用户根本不知道这个面板存在。

**影响**：新 ingest 的内容可能引入了 orphan page / broken wikilink / 与现有页冲突的 claim，没有任何出口告诉用户。只有冲突 gate（#13）在 ingest 时主动拦截，**结构性 lint 完全无事件触发**。

**修复建议**：在 `src/lib/ingest.ts` 的成功路径末尾加一个 best-effort structural lint 调用，把结果写到 `.llm-wiki/ingest-lint-hints.json`，UI 检测到就在 Activity Panel 显示一个徽章。成本低、价值高。不要在 ingest 路径跑 LLM semantic lint。

---

### ③ Contradiction detection —— 元数据驱动 vs 语义理解

**Rohit 原意**：`"Lint Operations: ... flag contradictions"`——读起来像是系统能**语义级**发现两个 claim 互斥。

**实际实现**（`src/lib/prewrite-conflict-resolver.ts`, `src/lib/lifecycle.ts`）：
- contradiction 的标记**完全来自** frontmatter 字段：`contradicts: []` 数组 或 `review_status: contradicted`
- 这两个字段由谁填？(a) 用户手动；(b) ingest 时 LLM 生成 prompt 里要求的产出；(c) conflict resolver 根据已有 claim metadata 做**规则匹配**
- **系统从不**拿两段文本丢给 LLM 问"这俩矛盾吗"

**语义差距**：如果 LLM 在第一次 ingest 时没把 `contradicts` 字段填对，后面就永远不会被标为矛盾了。真正的语义对比**从不发生**。

**能接受吗**：能。这是 gnusupport 那派的立场——`"numeric confidence scores mask weak evidence chains"`，不相信 LLM 的语义判断，只相信显式标注。站队清晰，**但和 gist 的 flag contradictions 表述有落差**。

---

### ④ Output formats —— 只导审计日志，不导 wiki 内容

**Rohit 原意**：`"comparison tables, timeline visualizations, dependency graphs, slide decks, JSON/CSV exports, structured briefs for team members"`

**实际实现**（`src/lib/audit-export.ts`）：
- 唯一的导出路径是 `exportAuditEvents()`，格式 `"json" | "csv"`
- 导出的是 `.llm-wiki/audit.jsonl` 里的**审计事件**，不是 wiki 页面内容
- 没有 Marp / slide / matplotlib / dot graph / comparison table 导出

**语义差距**：用户看 README 可能以为"我可以把关于 XX 的 wiki 片段导出成 slide"。实际完全做不到。要导出 wiki 内容只能用 Obsidian 兼容性（打开为 vault，手动搞）。

**能接受吗**：这是最大的**产品价值缺口**。Rohit gist 用 comparison table / timeline / slide deck 这些例子来展示"wiki 是知识的生产资料，不只是容器"，这个承诺没兑现。

---

## 2 处产品/架构缺口

### ❌ Mesh sync / shared-private scoping

**Rohit 原意**：`"Add collaboration: mesh sync, shared/private scoping"` —— 实现阶梯的最后一级。

**现状**：
- `lifecycle.ts` 有 `scope: private | shared` 字段
- `audit-redaction.ts` 在导出时 mask private scope 的字段
- **没有任何远程同步、多实例协作、ACL**

**SPEC 立场**：明确写在 Non-Goals：`"No remote backend, new database, auth system, or multi-user ACL. No full multi-agent mesh sync."`

**评价**：属于**明示放弃**，不是遗漏。scope 字段留着是正确的——未来接入同步时不用改 frontmatter schema。

---

### ⚠️ Schedule 事件 / 本地 daemon / 定期维护

**Rohit 原意**：`"On schedule: periodic lint, retention decay, consolidation"`

**现状**：
- `wiki-automation-events.ts` 有 `session.start/end`、`memory.write`、`schema.scan`、`quality.scan`、`digest.preview/save` —— **没有 `schedule` 事件**
- auto patrol 的机制是"用户操作达到阈值 + cooldown 满足"触发，**不是固定周期时间驱动**
- 没有 app-resident 维护循环按默认 15 分钟检查 due state

**local-first 立场**：不做远程 memory server，不做 app 完全退出后的 OS 级常驻服务；但 app 运行期本地 daemon 是合理的。它只做轻量 due check、提醒和 policy-gated deterministic patrol，不自动判真、不静默重写 Markdown。

**评价**：这不是应该继续放弃的项，而是本期要补的 local-first 缺口。默认 15 分钟检查一次 maintenance state，是否自动 patrol 继续由 `autoPatrolEnabled` 和 cooldown 决定。

---

## 评论区争议：这个实现站在哪一派？

Rohit gist 的评论区有一场关键辩论：

- **gnusupport 派**：`"auto-write hooks corrupt wikis with LLM hallucinations; use Git-based supersession and human write-gates instead"`
- **Rohit 原派**：decay 曲线 + 自动 supersession + 自动写入

**这个实现明显站在 gnusupport 一派**：

| 争议点 | Rohit 派 | gnusupport 派 | llm_wiki_v2 的选择 |
|-------|---------|--------------|------------------|
| LLM 自动写入 wiki | ✅ 自动 | ❌ 人类闸门 | **人类闸门**（pre-write conflict gate） |
| Confidence 持续衰减 | ✅ 后台跑 | ❌ 显式 supersession | **显式 + 手动巡检**（静态固化） |
| Contradiction 检测 | LLM 语义 | 显式标注 | **显式标注** |
| Crystallization | 自动 | 用户审核 | **event 预生成 + 用户点 save** |
| Background maintenance | schedule daemon | 显式触发 | **本期补 app-resident local daemon**，但不自动写 Markdown |

**这是一个有立场的工程选择**，不是遗漏。它让系统在"Markdown 不会被 LLM 莫名其妙改掉"这件事上变得可信——代价是 Rohit gist 读起来那种"memory 自己会活"的感觉没了。

**建议**：在 README 最前面加一段"Design philosophy"，明确这个立场：Markdown-first、human-gated、local app daemon、no remote memory server。现在用户读 README 会以为是完整 Rohit 实现，体验到的却是 gnusupport 风味。

---

## 优先级修复建议（如果要继续推进）

按 ROI 排序：

### P0（成本低、价值大）
1. **post-ingest structural lint hints**（修复漂移 ②）—— ingest 成功路径末尾加一次 best-effort structural lint，把 orphan/broken 输出到 Activity Panel。~100 行代码。
2. **README 立场声明** —— 开头加 "Design philosophy: Markdown-first, human-gated, local app daemon, no remote memory server"，避免用户按 Rohit 原意去理解。

### P1（中等成本、产品价值高）
3. **Wiki 内容导出**（修复缺口 ④）—— 至少支持：
   - 选一组页面 → 导出 Marp slide deck（用 Milkdown 已有的渲染能力）
   - 选一页 → 导出 matplotlib/Chart 占位（或直接丢给 LLM 生成 SVG）
   - Comparison table 类型的 query page 导出为 CSV
4. **Confidence 贬值的 UI 提示**（缓解漂移 ①）—— 在 frontmatter panel 显示 `"Last confirmed X days ago, confidence may be stale. [Run patrol]"`，让静态固化带来的问题可见。

### P2（高成本、战略投入）
5. **App-resident local maintenance daemon** —— app 运行期默认每 15 分钟做一次轻量 due check；超过阈值时提醒，policy 允许且 cooldown 满足时才调度 deterministic patrol。
6. **Contradiction 的 LLM 语义检测**（后续手动增强 ③）—— 单独做"Deep contradiction scan"按钮，拿候选 claim pair 丢给 LLM 问"是否矛盾"，结果只进入 review 队列。不自动写入，不进入本轮主线。

Mesh sync (缺口 12) 和 OS 级常驻 daemon 属于架构级投入，按 local-first 立场，**建议继续保持本轮 Non-Goal**。

---

## 结论

这是一个**已经把 Rohit 原意 70% 工程化落地**的项目。剩下 30% 分两类：
- **12/15（mesh sync）**：远程/协作能力明示放弃，合理取舍
- **10/15（schedule hooks）**：应补成 app-resident local daemon，而不是远程或 OS 级服务
- **1/7/9/15（decay 固化、post-ingest lint hints 缺失、contradiction 元数据驱动、输出格式单薄）**：可以且应该补齐的具体差距

仓库自己的 `plans/llm-wiki-v2-completion-audit.md` 宣称 14 条 SPEC 需求全部 Done —— 这是**对照自家 SPEC**的 Done。**对照 Rohit gist 原意**，上述 4 项漂移和 2 项缺口仍然存在。

工程取舍清晰、代码质量扎实、测试覆盖到位（1082 个 mocks 测试通过）。主要的产品体验问题不在于"没做完"，而在于**README 没把这些取舍讲清楚**，用户期望和实际交付之间有误差。

---

*生成时间：2026-05-10*
*分析对象：llm_wiki_v2 @ main (6b344e4)*

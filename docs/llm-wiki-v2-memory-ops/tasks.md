# 任务列表 — LLM Wiki v2.1 Memory Ops

**关联需求**: [`requirements.md`](./requirements.md)
**估算量级**: 中 (审核轮数：5)
**总体进度**: 🚧 11 / 18

---

## 状态图例

| Emoji | 状态 | 含义 |
|-------|------|------|
| ⏳ | 待开始 | 还没开始 |
| 🚧 | 进行中 | 当前正在做 |
| ✅ | 已完成 | 自检通过、commit/push 完毕 |
| ⚠️ | 阻塞中 | 等待外部决策 / 修不动 |
| 🔍 | 待审核 | 自己做完了等用户 review |

---

## 里程碑依赖图

```mermaid
graph TD
  M1[M1: Audit + governance foundation] --> M2[M2: Patrol runner + lifecycle rules]
  M1 --> M3[M3: Crystallization candidates + search eval]
  M2 --> M4[M4: UI integration]
  M3 --> M4
  M4 --> M5[M5: Verification + final review]
```

---

## Milestone 1: Audit + Governance Foundation

**目标**: 把 audit、redaction、dry-run/rollback 基础能力先做成纯函数和可测试模块。
**依赖**: 无
**状态**: ✅

### Task 1.1 ✅ Define unified audit timeline schema

**描述**: 新建 `src/lib/audit-timeline.ts`，定义统一 `AuditEvent`、append/read/filter、bad-line tolerance，并兼容现有 lifecycle audit shape。

**依赖**: 无
**阻塞**: T1.2, T1.3, T2.1, T4.1

**预估**: 3h

**关联文件 / 模块**:
- `src/lib/audit-timeline.ts` (新建)
- `src/lib/lifecycle.ts`
- `src/lib/lifecycle.test.ts`
- `src/lib/audit-timeline.test.ts` (新建)

**验收**:
- [ ] 可 append/read `.llm-wiki/audit.jsonl`。
- [ ] 坏 JSONL 行不会导致整个读取失败。
- [ ] 现有 `appendLifecycleAuditEvent` 兼容或委托新模块。

#### 备注

- 🐛 **遇到的问题**: `docs/` 被 `.gitignore` 忽略，后续提交文档需要 `git add -f`；实现中还发现 lifecycle 原有 audit helper 需要保留旧调用入口。
- 🔧 **最终实现逻辑**: 新增 `src/lib/audit-timeline.ts`，提供统一 audit path、append、read、bad-line warning 和 action/path filter；`appendLifecycleAuditEvent` 委托到新模块保持兼容。
- 🎯 **关键决策**: T1.1 只做 schema/read/write/filter，不做 secret redaction；redaction 留给 T1.2，避免把两个行为混在一个测试周期里。

---

### Task 1.2 ✅ Add secret redaction utilities

**描述**: 新建 secret redaction helper，覆盖 API key/token/password/private block 等常见敏感模式，用于 audit 和 suggestions。

**依赖**: T1.1
**阻塞**: T1.3, T2.3, T4.1

**预估**: 2h

**关联文件 / 模块**:
- `src/lib/audit-redaction.ts` (新建)
- `src/lib/audit-redaction.test.ts` (新建)
- `src/lib/audit-timeline.ts`

**验收**:
- [ ] 常见 secret 模式被替换为稳定占位符。
- [ ] 非敏感普通文本不被大面积误伤。
- [ ] `scope: private` 事件默认只保留摘要。

#### 备注

- 🐛 **遇到的问题**: Secret 可能出现在普通字符串、嵌套 audit payload、敏感字段名或 `<private>` block 中，单一正则不够覆盖。
- 🔧 **最终实现逻辑**: 新增 `src/lib/audit-redaction.ts`，提供 `redactSensitiveText` 和递归 `redactAuditEvent`；`appendAuditEvent` 在写入 JSONL 前统一调用 redaction。
- 🎯 **关键决策**: `scope: private` 的 audit event 默认收缩成最小摘要，只保留 action、路径、reasons 和 redaction 标记，避免正文或 before/after 泄露。

---

### Task 1.3 ✅ Implement safe operation dry-run and rollback shape

**描述**: 新建 `memory-ops-executor` 的纯函数层，支持 metadata/frontmatter patch 的 dry-run diff、apply plan、rollback report 结构。

**依赖**: T1.1, T1.2
**阻塞**: T2.3, T4.2

**预估**: 4h

**关联文件 / 模块**:
- `src/lib/memory-ops-executor.ts` (新建)
- `src/lib/memory-ops-executor.test.ts` (新建)
- `src/lib/frontmatter.ts`

**验收**:
- [ ] Dry-run 不写文件。
- [ ] Metadata-only patch 能生成 before/after 和 rollback。
- [ ] 执行失败返回 partial result，不吞错误。

#### 备注

- 🐛 **遇到的问题**: 维护动作后续会来自 UI/runner，必须先避免“写一半失败后看不到部分结果”的情况。
- 🔧 **最终实现逻辑**: 新增 `src/lib/memory-ops-executor.ts`，支持 metadata patch dry-run、frontmatter diff、原内容 rollback snapshot，以及顺序执行时的 partial result。
- 🎯 **关键决策**: T1.3 只处理 metadata/frontmatter patch，不碰正文重写或删除；rollback 以 restore-content 快照表达，后续 UI 可以先展示再执行。

---

## Milestone 2: Patrol Runner + Lifecycle Rules

**目标**: 做出不依赖 LLM 的 Memory Ops 巡检核心，先生成建议，不直接改文件。
**依赖**: M1
**状态**: ✅

### Task 2.1 ✅ Build project snapshot scanner

**描述**: 新建 scanner，读取 wiki pages、frontmatter、typed graph、review items、audit events、chat/research summary，为 patrol 规则提供统一输入。

**依赖**: T1.1
**阻塞**: T2.2, T2.3, T3.1

**预估**: 4h

**关联文件 / 模块**:
- `src/lib/memory-ops.ts` (新建)
- `src/lib/typed-graph.ts`
- `src/lib/persist.ts`
- `src/stores/research-store.ts`
- `src/lib/memory-ops.test.ts` (新建)

**验收**:
- [ ] 空项目、无 `.llm-wiki`、坏 audit 行都能返回稳定 snapshot。
- [ ] 不读取 `raw/sources/` 大文件。
- [ ] project path/dataVersion 能用于缓存或去重，避免跨项目污染。

#### 备注

- 🐛 **遇到的问题**: Snapshot 需要聚合多种状态文件，但 `.llm-wiki/` 文件缺失或损坏都不能阻塞维护巡检。
- 🔧 **最终实现逻辑**: 新增 `src/lib/memory-ops.ts`，只扫描 `wiki/` markdown 和 `.llm-wiki` audit/review/chat 状态，并用 `extractTypedGraphFromPages` 构建 typed graph。
- 🎯 **关键决策**: 不读取 `raw/sources/`，避免巡检触发 PDF/Office 大文件提取；缺失状态全部降级为空数组，坏 audit 行保留 warning。

---

### Task 2.2 ✅ Implement deterministic lifecycle patrol rules

**描述**: 新建 `memory-ops-rules.ts`，基于 lifecycle、confidence、last_confirmed、reinforcement、supersession、audit usage 生成 stale/archive/promote/review 建议。

**依赖**: T2.1
**阻塞**: T2.3, T4.2

**预估**: 5h

**关联文件 / 模块**:
- `src/lib/memory-ops-rules.ts` (新建)
- `src/lib/lifecycle.ts`
- `src/lib/memory-ops-rules.test.ts` (新建)

**验收**:
- [ ] 固定 today 时输出稳定。
- [ ] 不直接改写 wiki content。
- [ ] 可解释 reasons 覆盖年龄、来源、reinforcement、supersession。

#### 备注

- 🐛 **遇到的问题**: 同一页面可能同时触发 stale、reinforcement、promotion 等不同维护信号，需要保持建议粒度清晰，避免单个规则做太多事。
- 🔧 **最终实现逻辑**: 新增 `src/lib/memory-ops-rules.ts`，复用 lifecycle scoring，结合 audit 事件统计 reinforcement，输出 metadata-update suggestions 和 `metadata-patch` operation。
- 🎯 **关键决策**: 规则只生成建议，不写文件；promotion 仅在 episodic 页面同时有多来源和足够 reinforcement 时触发，避免过度巩固。

---

### Task 2.3 ✅ Wire patrol runner and activity status

**描述**: 聚合 scanner + rules + audit，暴露 `runMemoryOpsPatrol(projectPath, options)`，并把运行状态接入 Activity store。

**依赖**: T1.3, T2.1, T2.2
**阻塞**: T4.1, T4.2

**预估**: 4h

**关联文件 / 模块**:
- `src/lib/memory-ops.ts`
- `src/stores/activity-store.ts`
- `src/lib/memory-ops.test.ts`

**验收**:
- [ ] Patrol report 包含 stats、suggestions、warnings。
- [ ] 运行完成写入 `memory_ops.patrol` audit event。
- [ ] 异常路径更新 activity 为 error。

#### 备注

- 🐛 **遇到的问题**: Activity store 原来没有维护任务类型，patrol 如果复用 lint/query 会让 UI 语义不清。
- 🔧 **最终实现逻辑**: `runMemoryOpsPatrol` 组合 snapshot scanner 与 lifecycle rules，返回 report/stats/warnings/suggestions，运行时写入 `memory_ops.patrol` audit event，并更新 Activity 状态。
- 🎯 **关键决策**: Activity type 新增 `maintenance`；audit 写失败视为 patrol 失败并标记 error，确保“完成的 patrol 必有 audit 痕迹”。

---

### Task 2.4 ✅ Add relation cleanup suggestions

**描述**: 基于 typed graph 和 alias resolver 识别 broken typed relation、dangling supersession、孤立但应连接页面，生成建议而非自动修复。

**依赖**: T2.1, T2.2
**阻塞**: T4.2

**预估**: 3h

**关联文件 / 模块**:
- `src/lib/memory-ops-rules.ts`
- `src/lib/typed-graph.ts`
- `src/lib/wiki-alias-index.ts`

**验收**:
- [ ] 能识别 `uses`/`supports`/`supersedes` 等 typed relation 的 broken target。
- [ ] 能解释 suggestion 的目标字段和候选目标。
- [ ] 不重复现有 structural lint 的简单 broken wikilink 输出。

#### 备注

- 🐛 **遇到的问题**: Typed graph 只保留已解析成功的关系边，因此 broken frontmatter target 必须单独扫描 frontmatter；普通正文 wikilink 则应继续交给 structural lint，避免重复噪声。
- 🔧 **最终实现逻辑**: 新增 `evaluateRelationCleanupSuggestions`，扫描 `uses`/`supports`/`supersedes` 等 typed relation 字段，用 slug/title/alias resolver 判断是否能解析，并为近似匹配页面补 candidate。
- 🎯 **关键决策**: T2.4 只生成 relation-cleanup suggestion，不自动删除或改写关系；`supersedes` / `superseded_by` 断链升为 warning，其余 typed relation 先作为 info。

---

## Milestone 3: Crystallization Candidates + Search Evaluation

**目标**: 让探索成果可被建议保存，同时用评估保护检索质量。
**依赖**: M1
**状态**: ✅

### Task 3.1 ✅ Score crystallization candidates

**描述**: 新建 `crystallize-candidates.ts`，对 chat/research/review 输出进行确定性评分和去重，生成 Save to Wiki 建议。

**依赖**: T2.1
**阻塞**: T3.2, T4.3

**预估**: 4h

**关联文件 / 模块**:
- `src/lib/crystallize-candidates.ts` (新建)
- `src/lib/crystallize.ts`
- `src/stores/chat-store.ts`
- `src/stores/research-store.ts`
- `src/stores/review-store.ts`

**验收**:
- [ ] 短内容、无引用、已保存内容不会重复提示。
- [ ] 长内容、有引用、有结论的输出能生成 candidate。
- [ ] Candidate reasons 可显示给用户。

#### 备注

- 🐛 **遇到的问题**: Research task 目前没有像 chat/review 一样持久化到 `.llm-wiki/`，且 Deep Research 成功后通常已经自动保存，因此候选收集要支持 live task 输入并跳过 `savedPath`。
- 🔧 **最终实现逻辑**: 新增 `src/lib/crystallize-candidates.ts`，提供 deterministic scorer、content dedupe key、chat/research/review collector；评分基于长度、显式引用、结构、结论和 decision/recommendation 信号。
- 🎯 **关键决策**: T3.1 只生成候选，不写 Wiki、不接 UI；无引用或内容过短直接跳过，已保存/已 dedupe 的内容不重复提示。

---

### Task 3.2 ✅ Reuse confirmed crystallization write path

**描述**: 将用户确认后的 candidate 接到现有 `writeCrystallizedQueryPage`，记录 candidate score/reasons 到 audit。

**依赖**: T3.1
**阻塞**: T4.3

**预估**: 3h

**关联文件 / 模块**:
- `src/lib/crystallize.ts`
- `src/lib/crystallize-candidates.ts`
- `src/lib/crystallize.test.ts`

**验收**:
- [ ] 不新增第二套 query page 写入逻辑。
- [ ] Audit event 包含 candidate score/reasons。
- [ ] 路径冲突继续使用现有 Unicode-safe timestamp 策略。

#### 备注

- 🐛 **遇到的问题**: 如果直接在 UI 里各自拼写入逻辑，容易绕过现有 query page metadata、filename/source/supports 处理和 audit 行为。
- 🔧 **最终实现逻辑**: 扩展 `writeCrystallizedQueryPage` 的可选 candidate audit metadata，并新增 `writeConfirmedCrystallizationCandidate`，把确认后的 candidate 原样转交给现有 crystallized query 写入路径。
- 🎯 **关键决策**: Candidate score/reasons/dedupeKey 记录在 `crystallize.query` audit 的 `after.candidate` 中；写入 origin 默认使用 `<source>-candidate`，不新增第二套 query page writer。

---

### Task 3.3 ✅ Add deterministic search evaluation harness

**描述**: 新建 `search-eval.ts` 和 scenario tests，覆盖 exact title、alias、typed relation、graph-only、vector-only、CJK query，形成检索回归保护。

**依赖**: 无
**阻塞**: T3.4, T5.1

**预估**: 4h

**关联文件 / 模块**:
- `src/lib/search-eval.ts` (新建)
- `src/lib/search.ts`
- `src/lib/search-rrf.test.ts`
- `src/lib/search-eval.test.ts` (新建)

**验收**:
- [ ] Evaluation 可在 mock FS/temp wiki 下运行。
- [ ] Embedding disabled/enabled mock 都有覆盖。
- [ ] 报告 top-k/rank failures，便于定位退化。

#### 备注

- 🐛 **遇到的问题**: 现有 search tests 能验证具体实现，但缺少一个可复用的“场景输入 → ranked results → rank/top-k 失败报告”层，后续调参难以统一解释退化。
- 🔧 **最终实现逻辑**: 新增 `src/lib/search-eval.ts`，提供 `runSearchEval` 和 `runSearchWikiEval`，支持 expected top ranks、top-k 包含和 excluded path 检查，并输出 ranked paths + failure summary。
- 🎯 **关键决策**: Harness 不绑定真实 embedding 服务；测试用 temp wiki、mock embedding 和 mock typed graph 覆盖 exact title、alias、CJK、vector-only、graph-only 场景。

---

### Task 3.4 ✅ Tune lexical scoring only if evaluation exposes gaps

**描述**: 如果 T3.3 暴露明显 lexical 排名问题，做不新增依赖的 BM25-like scoring 或局部 scoring 修正；否则记录无需改动。

**依赖**: T3.3
**阻塞**: T5.1

**预估**: 2h

**关联文件 / 模块**:
- `src/lib/search.ts`
- `src/lib/search-rrf.test.ts`
- `src/lib/search-eval.test.ts`

**验收**:
- [ ] exact filename/title 强匹配不退化。
- [ ] CJK token behavior 不退化。
- [ ] 不恢复读取 `raw/sources/` 大文件的慢路径。

#### 备注

- 🐛 **遇到的问题**: T3.3 新增的 evaluation 没有暴露 exact title、alias、graph-only、vector-only 或 CJK 场景的 lexical 排名缺口。
- 🔧 **最终实现逻辑**: 未改 `src/lib/search.ts`；用 `search-eval`、`search-rrf` 和 fixture scenarios 作为本轮调参门禁。
- 🎯 **关键决策**: 暂不引入 BM25-like scoring，避免在无失败样本时改动稳定检索权重；后续只有 evaluation 出现可复现 gap 再调。

---

## Milestone 4: UI Integration

**目标**: 把 Memory Ops 做成可用的现有界面扩展，而不是隐藏在库函数中。
**依赖**: M2, M3
**状态**: ⏳

### Task 4.1 ⏳ Add Memory Ops block in Maintenance settings

**描述**: 在 Settings → Maintenance 增加 Patrol 卡片，展示运行按钮、状态、summary、warnings 和最近 audit 摘要。

**依赖**: T2.3
**阻塞**: T4.2, T4.4

**预估**: 5h

**关联文件 / 模块**:
- `src/components/settings/sections/maintenance-section.tsx`
- `src/lib/memory-ops.ts`
- `src/i18n/en.json`
- `src/i18n/zh.json`

**验收**:
- [ ] 无项目、运行中、完成、失败、空建议状态可见。
- [ ] 中英双语文案齐全。
- [ ] 不破坏现有 duplicate detection UI。

#### 备注

- 🐛 **遇到的问题**:
- 🔧 **最终实现逻辑**:
- 🎯 **关键决策**:

---

### Task 4.2 ⏳ Render suggestions and confirm/ignore actions

**描述**: 展示 patrol suggestions，支持 ignore、confirm metadata-only operation、open target page、查看 dry-run diff。

**依赖**: T1.3, T2.3, T2.4, T4.1
**阻塞**: T4.4

**预估**: 6h

**关联文件 / 模块**:
- `src/components/settings/sections/maintenance-section.tsx`
- `src/lib/memory-ops-executor.ts`
- `src/stores/review-store.ts`

**验收**:
- [ ] Confirm 前能看到影响页面和字段。
- [ ] Ignore 不写 wiki，只更新本地 suggestion state 或 audit。
- [ ] 执行后刷新 dataVersion/file tree。

#### 备注

- 🐛 **遇到的问题**:
- 🔧 **最终实现逻辑**:
- 🎯 **关键决策**:

---

### Task 4.3 ⏳ Surface crystallization candidates in existing flows

**描述**: 在 chat/research/review 的现有保存入口附近显示 Save to Wiki 建议，用户确认后复用 crystallization helper。

**依赖**: T3.1, T3.2
**阻塞**: T4.4

**预估**: 5h

**关联文件 / 模块**:
- `src/components/chat/chat-message.tsx`
- `src/lib/deep-research.ts`
- `src/components/review/review-view.tsx`
- `src/lib/crystallize-candidates.ts`

**验收**:
- [ ] 不在每条普通短回复上打扰用户。
- [ ] Candidate reasons 和引用页面可见。
- [ ] 保存成功后不重复提示同一内容。

#### 备注

- 🐛 **遇到的问题**:
- 🔧 **最终实现逻辑**:
- 🎯 **关键决策**:

---

### Task 4.4 ⏳ UI polish, a11y, and i18n parity

**描述**: 收尾 UI 状态、键盘可达性、窄面板布局、i18n parity test。

**依赖**: T4.1, T4.2, T4.3
**阻塞**: T5.1

**预估**: 3h

**关联文件 / 模块**:
- `src/i18n/en.json`
- `src/i18n/zh.json`
- `src/i18n/i18n-parity.test.ts`
- UI touched files

**验收**:
- [ ] 新增 key 通过 i18n parity test。
- [ ] 操作按钮有明确 label，不只靠颜色表达状态。
- [ ] 窄面板下文本不重叠。

#### 备注

- 🐛 **遇到的问题**:
- 🔧 **最终实现逻辑**:
- 🎯 **关键决策**:

---

## Milestone 5: Verification + Final Review

**目标**: 跑完整验证，并按中量级要求完成 5 轮最终审核。
**依赖**: M4
**状态**: ⏳

### Task 5.1 ⏳ Run focused tests and full mock suite

**描述**: 跑 typecheck、focused Vitest、`npm run test:mocks`；如果 Rust 文件被改动则跑 `cargo test`。

**依赖**: T3.4, T4.4
**阻塞**: T5.2

**预估**: 2h

**关联文件 / 模块**:
- touched test suites
- `package.json`
- `src-tauri/` (如有 Rust 改动)

**验收**:
- [ ] `npm run typecheck` 通过。
- [ ] Focused tests 通过。
- [ ] `npm run test:mocks` 通过。
- [ ] 如改 Rust，`cargo test` 通过。

#### 备注

- 🐛 **遇到的问题**:
- 🔧 **最终实现逻辑**:
- 🎯 **关键决策**:

---

### Task 5.2 ⏳ Update docs and completion audit

**描述**: 更新 README/plan 文档中对 Memory Ops 的说明，并写本期 completion audit。

**依赖**: T5.1
**阻塞**: T5.3

**预估**: 2h

**关联文件 / 模块**:
- `README.md`
- `README_CN.md`
- `docs/llm-wiki-v2-memory-ops/completion-audit.md` (新建)
- `docs/llm-wiki-v2-memory-ops/tasks.md`

**验收**:
- [ ] 文档说明不夸大为 multi-agent memory server。
- [ ] Completion audit 映射每个功能点到文件和测试证据。
- [ ] tasks.md 备注和状态已更新。

#### 备注

- 🐛 **遇到的问题**:
- 🔧 **最终实现逻辑**:
- 🎯 **关键决策**:

---

### Task 5.3 ⏳ Phase 4 final review rounds

**描述**: 按中量级要求跑 5 轮最终审核，并为每轮写报告。

**依赖**: T5.2
**阻塞**: 无

**预估**: 5h

**关联文件 / 模块**:
- `docs/llm-wiki-v2-memory-ops/review-round-1.md`
- `docs/llm-wiki-v2-memory-ops/review-round-2.md`
- `docs/llm-wiki-v2-memory-ops/review-round-3.md`
- `docs/llm-wiki-v2-memory-ops/review-round-4.md`
- `docs/llm-wiki-v2-memory-ops/review-round-5.md`

**验收**:
- [ ] Round 1 功能视角完成并修复发现。
- [ ] Round 2 类型安全/静态分析完成并修复发现。
- [ ] Round 3 性能视角完成并修复发现。
- [ ] Round 4 安全/隐私视角完成并修复发现。
- [ ] Round 5 UX/a11y 视角完成并修复发现。

#### 备注

- 🐛 **遇到的问题**:
- 🔧 **最终实现逻辑**:
- 🎯 **关键决策**:

---

## 进度总览 (开发中实时维护)

| 里程碑 | 任务 | 完成 | 总数 | 状态 |
|--------|------|------|------|------|
| M1 | Audit + Governance Foundation | 3 | 3 | ✅ |
| M2 | Patrol Runner + Lifecycle Rules | 4 | 4 | ✅ |
| M3 | Crystallization Candidates + Search Evaluation | 4 | 4 | ✅ |
| M4 | UI Integration | 0 | 4 | ⏳ |
| M5 | Verification + Final Review | 0 | 3 | ⏳ |
| **总计** | | **11** | **18** | **🚧** |

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-05-07 | 初稿，18 个任务，默认选择 app 内 Memory Ops，不引入外部 memory server |

---

## 最终审核索引 (Phase 4 期间填)

| Round | 视角 | 状态 | 报告 |
|-------|------|------|------|
| 1 | 功能 | ⏳ | `review-round-1.md` |
| 2 | 类型 & 静态分析 | ⏳ | `review-round-2.md` |
| 3 | 性能 | ⏳ | `review-round-3.md` |
| 4 | 安全 | ⏳ | `review-round-4.md` |
| 5 | UX & a11y | ⏳ | `review-round-5.md` |

# Completion Audit — LLM Wiki v2 写入前冲突处理

**日期**: 2026-05-08
**状态**: 完成
**范围**: Spec B — Pre-Write Conflict Handling

## 需求对照

| 需求 | 状态 | 证据 |
|------|------|------|
| F1 写入候选集建模 | Done | `src/lib/prewrite-conflict.ts` 定义 `PreWriteCandidate` / evidence / preview，候选 id 稳定，正文摘要脱敏并限长。 |
| F2 本地相关证据解析 | Done | `src/lib/prewrite-conflict-resolver.ts` 从 claim index 与 bounded wiki page summaries 解析 claim/page/relation evidence。 |
| F3 冲突分类 | Done | `classifyPreWriteConflict` 覆盖 new、reinforcement、update、duplicate、possible-contradiction、supersession、uncertain，并有纯函数测试。 |
| F4 写入决策与保守降级 | Done | 高风险和 uncertain 统一 `review-only`；resolver 异常走 `buildUncertainPreWritePreview`，不回退到直接覆盖。 |
| F5 Review queue 集成 | Done | `preWriteConflictToReviewItem` 生成可去重 review item；ingest 风险分支使用 `addItemsAndReturn` 记录 review item id。 |
| F6 Audit timeline 集成 | Done | `conflict.preview`、`conflict.accept`、`conflict.review` 写入 audit；timeline 支持 `conflict` category 与 `review-only` status。 |
| F7 Ingest 写入路径集成 | Done | `writeFileBlocks` 在 content-page 写入前预检；safe block 继续写入，risk block 跳过并进入 review，其他 block 不受影响。 |
| F8 Crystallization / Review-created page 集成 | Done | `writeCrystallizedQueryPage` 和 review-created page helper/UI 分支均在落盘前预检；风险写入不静默落盘。 |
| F9 文档和运行手册 | Done | README/README_CN、deep-dive plan、completion audit 和 5 轮 review 报告均说明边界与后续项。 |

## 最终审核

| Round | 视角 | 报告 | 结果 |
|-------|------|------|------|
| 1 | 功能 | [review-round-1.md](./review-round-1.md) | 补齐 `conflict.preview` audit 和 review item id 追踪。 |
| 2 | 类型 & 静态分析 | [review-round-2.md](./review-round-2.md) | 补 `addItemsAndReturn` 返回语义测试，整理 ingest catch 可读性。 |
| 3 | 性能 | [review-round-3.md](./review-round-3.md) | 增加单次 ingest resolver cache，避免多 FILE block 重复读取。 |
| 4 | 安全 | [review-round-4.md](./review-round-4.md) | 补 audit 不写 `claimText` / `pageExcerpt` 的泄漏测试。 |
| 5 | UX & a11y | [review-round-5.md](./review-round-5.md) | 修复 review description 多行可读性，补 conflict/review-only 过滤入口与 i18n。 |

## 验证命令

最终通过的验证：

- `npx vitest run src/lib/prewrite-conflict.test.ts src/lib/prewrite-conflict-resolver.test.ts src/lib/prewrite-conflict-review.test.ts src/lib/prewrite-conflict-audit.test.ts src/lib/ingest-execute-writes.test.ts src/lib/crystallize.test.ts src/lib/review-page.test.ts src/lib/audit-timeline.test.ts src/lib/audit-timeline-ui.test.ts src/components/review/review-card.test.tsx src/stores/review-store.test.ts`
- `npm run typecheck`
- `npm run test:mocks`

阶段内额外 focused 验证：

- Round 1: ingest/crystallize/review-store focused suites、`npm run typecheck`
- Round 2: review-store/ingest focused suites、`npm run typecheck`
- Round 3: resolver/ingest focused suites、`npm run typecheck`
- Round 4: conflict audit/audit redaction/ingest/crystallize focused suites、`npm run typecheck`
- Round 5: review-card/audit-timeline-ui focused suites、`npm run typecheck`

## 边界确认

- Markdown pages 仍是 source of truth；claim index、audit、review item 都是 derived/local maintenance layer。
- Pre-write conflict gate 是确定性、bounded、本地检查，不做远程 LLM 事实裁决。
- `new`、`reinforcement`、同路径 `update` 可以继续写入；`duplicate`、`possible-contradiction`、`supersession`、`uncertain` 默认转 review-only。
- Review-only 表示“不能静默覆盖”，不是自动判定新旧事实真假。
- 本期不做全库历史冲突重扫；后续 Memory Ops 可复用同一 resolver 做手动巡检。

## 后续入口

- 为 review queue 增加目标页 diff 预览，降低人工判断成本。
- 将 pre-write conflict resolver 作为 Memory Ops 的一个手动 patrol 项，发现历史遗留重复页或过期 claim。
- 扩展 evidence resolver 的 alias/typed relation 利用率，但继续保持 bounded 和本地可重建。

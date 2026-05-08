# Review Round 1 — 功能审核

**日期**: 2026-05-08
**视角**: 功能完整性 / 需求对齐
**状态**: 已完成

## 检查范围

- 对照 `requirements.md` 的 F1-F9。
- 检查 ingest、crystallization、review-created page 三条写入路径。
- 检查 review queue 和 audit timeline 是否覆盖 preview / accept / review handoff。
- 复跑 focused tests 与 typecheck。

## 发现与修复

### F1: `conflict.preview` 没有实际落 audit

**问题**: 需求 F6 明确要求 preview / accept / review handoff 都可审计。实现已经有 `conflict.accept` 和 `conflict.review`，但写入路径没有单独记录 `conflict.preview`。

**修复**:

- ingest content-page 写入前，先写 `conflict.preview`，再按决策写 `conflict.accept` 或 `conflict.review`。
- crystallization 保存页同样先写 `conflict.preview`。
- 补充 `src/lib/ingest-execute-writes.test.ts` 和 `src/lib/crystallize.test.ts` 断言。

### F2: Review handoff audit 缺少 review item id

**问题**: `conflict.review` 能记录分类和证据，但不能直接追踪到创建或合并后的 review item。

**修复**:

- `useReviewStore` 新增 `addItemsAndReturn`，复用 pending 去重语义，并返回新增或合并后的 `ReviewItem`。
- ingest risk 分支把 `reviewItemId` 写入 `conflict.review` audit。

### F3: 任务表总数不一致

**问题**: 任务表顶部写 `13 / 15`，但最终审核实际有 5 个任务，合计应为 18。

**修复**:

- 将总进度校正为 `13 / 18`。
- 将 M6 总数从 2 改为 5。
- 变更记录补充任务数校正说明。

## 验证

- `npx vitest run src/lib/ingest-execute-writes.test.ts src/lib/crystallize.test.ts src/stores/review-store.test.ts`
  - 3 files passed
  - 28 tests passed
- `npm run typecheck`
  - passed

## 结论

功能需求已对齐：controlled write paths 会构建 candidate、写 preview audit、按 safe/risk 分流，并在 risk ingest 中创建 review handoff。Round 1 发现的问题已修复。

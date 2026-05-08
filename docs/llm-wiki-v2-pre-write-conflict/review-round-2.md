# Review Round 2 — 类型与静态分析审核

**日期**: 2026-05-08
**视角**: TypeScript 类型安全 / 导出边界 / 测试类型覆盖
**状态**: 已完成

## 检查范围

- `src/lib/prewrite-conflict*.ts`
- `src/lib/ingest.ts`
- `src/lib/crystallize.ts`
- `src/lib/review-page.ts`
- `src/components/review/review-view.tsx`
- `src/stores/review-store.ts`

## 检查结果

- 未发现新增 `any`、`as any`、`@ts-ignore` 或 `@ts-expect-error`。
- `PreWriteCandidate`、`PreWriteEvidence`、`PreWriteConflictPreview`、review draft、audit helper 均有显式类型。
- `npm run typecheck` 通过。

## 发现与修复

### F1: `addItemsAndReturn` 缺少返回值语义测试

**问题**: Round 1 新增了 `useReviewStore.addItemsAndReturn`，用于把 `conflict.review` audit 关联到 review item id。实现类型正确，但缺少针对“新增返回 id”和“合并返回旧 id”的直接测试。

**修复**:

- 在 `src/stores/review-store.test.ts` 增加两条测试：
  - 新增 item 时返回带 generated id 的 `ReviewItem`。
  - merge existing pending item 时返回原 id，并合并 affected pages。

### F2: ingest catch 缩进不一致

**问题**: `appendPreWriteConflictAuditEvent(...).catch` 内部缩进偏移，影响可读性。

**修复**: 只调整缩进，无行为变更。

## 验证

- `npx vitest run src/stores/review-store.test.ts src/lib/ingest-execute-writes.test.ts`
  - 2 files passed
  - 24 tests passed
- `npm run typecheck`
  - passed

## 结论

类型边界可接受；新增 store API 已有返回值语义测试。没有发现需要继续修复的类型或静态分析问题。

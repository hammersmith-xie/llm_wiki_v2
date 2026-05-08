# Review Round 4 — 安全审核

**日期**: 2026-05-08
**视角**: 路径边界 / 脱敏 / raw content 泄漏 / 失败降级
**状态**: 已完成

## 检查范围

- `src/lib/prewrite-conflict.ts`
- `src/lib/prewrite-conflict-resolver.ts`
- `src/lib/prewrite-conflict-audit.ts`
- `src/lib/prewrite-conflict-review.ts`
- `src/lib/ingest.ts`
- `src/lib/crystallize.ts`
- `src/lib/review-page.ts`
- `src/components/review/review-view.tsx`

## 检查结果

- ingest 仍使用 `parseFileBlocks` 的 path sanitizer，pre-write gate 没有新增可绕过 `wiki/` 边界的写入入口。
- crystallization 与 review-created page target 仍由既有 path builder 生成。
- candidate summary 经过 `redactSensitiveText`，并有长度上限。
- conflict audit 不写完整 candidate body。
- review-only 分支在 ingest/crystallization/review-created page 中均不会直接 `writeFile` 目标页。
- resolver 异常会通过 `buildUncertainPreWritePreview` 进入 review-only。

## 发现与修复

### F1: conflict audit 缺少显式“不复制 evidence 长文本”测试

**问题**: `appendPreWriteConflictAuditEvent` 实现只写 evidence summary，但测试没有明确锁住 `claimText` / `pageExcerpt` 不进入 audit 的行为。

**修复**:

- 在 `src/lib/prewrite-conflict-audit.test.ts` 增加断言：
  - audit event JSON 不包含 `claimText`
  - 不包含 `pageExcerpt`
  - 不包含完整 page excerpt 文本

## 验证

- `npx vitest run src/lib/prewrite-conflict-audit.test.ts src/lib/audit-redaction.test.ts src/lib/ingest-execute-writes.test.ts src/lib/crystallize.test.ts`
  - 4 files passed
  - 15 tests passed
- `npm run typecheck`
  - passed

## 剩余风险

- Review item description 会展示 bounded reason/evidence 文本。当前 evidence formatter 不包含完整 page excerpt 或 claim text，但未来若扩展 UI 文案，需要继续保持“摘要而非原文复制”原则。

## 结论

安全边界可接受。路径、脱敏、review-only 不写入和 audit 摘要边界均有测试或代码检查覆盖。

# Review Round 1 - 功能完整性

**视角**: 对照 `requirements.md` / `tasks.md` 检查功能链路是否闭合。
**日期**: 2026-05-08
**结果**: 发现并修复 1 个功能问题。

## 检查范围

- Claim data model、anchors、confidence scoring、JSONL read/write。
- Ingest、crystallization、review-created page 的 claim 写入路径。
- Search/chat claim evidence lookup 和 UI 接入。
- Memory Ops claim health、claim suggestions、claim index scan/rebuild。
- README/plans/migration notes 与当前实现边界。

## 发现与处理

### R1-F1: claim index rebuild apply 未保证 `.llm-wiki/` 目录存在

**严重度**: Important

**证据**:
- `applyClaimIndexRebuild()` 直接 `writeFile("${project}/.llm-wiki/claims.jsonl", ...)`。
- 老项目或手工项目如果缺少 `.llm-wiki/`，rebuild apply 可能失败。

**修复**:
- 在 `src/lib/claim-ops.ts` 写入 `claims.jsonl` 前显式 `createDirectory("${project}/.llm-wiki")`。
- 在 `src/lib/claim-ops.test.ts` 增加调用顺序断言，确保目录创建发生在 claim index 写入前。

**验证**:
- `npx vitest run src/lib/claim-ops.test.ts`: 3 tests passed。
- `npm run typecheck`: passed。

## 剩余观察

- `ClaimEvidenceList` 仍有英文硬编码文案，影响 T4.1 的“中英文文案齐全”。该问题归入 Round 5 UX/a11y 修复。

## 结论

功能链路基本闭合；已修复 rebuild apply 在旧项目目录缺失时的失败风险。

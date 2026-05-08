# Review Round 5 - UX 与 a11y

**视角**: Search/chat claim evidence 的可读性、状态表达、长文本布局、i18n/a11y。
**日期**: 2026-05-08
**结果**: 发现并修复 1 个 UX/i18n 问题。

## 检查范围

- `ClaimEvidenceList` 在 Search 和 Chat references 中的默认展示。
- 状态、置信度、redacted/source 是否以文本表达，不只靠颜色。
- 长 claim/path 是否用 `break-words` / `truncate` 控制布局。
- 中英文文案是否进入 i18n bundle 且 key parity 通过。

## 发现与处理

### R5-F1: Claim evidence 组件存在英文硬编码文案

**严重度**: Important

**证据**:
- `ClaimEvidenceList` 默认 label、`Status`、`Confidence`、`Redacted`、`Source`、`more` 均为组件内英文硬编码。
- T4.1 验收要求“中英文文案齐全”。

**修复**:
- 新增 `claims.*` i18n keys 到 `src/i18n/en.json` 和 `src/i18n/zh.json`。
- `ClaimEvidenceList` 使用 `useTranslation()` 读取默认 label、status、confidence、source、redacted 和 more 文案。
- 保留 `label` prop，允许 Chat 继续传入短 label。
- 增加中文默认 label 渲染测试。

**验证**:
- `npx vitest run src/components/claims/claim-evidence-list.test.tsx src/i18n/i18n-parity.test.ts`: 2 files, 6 tests passed。
- `npm run typecheck`: passed。

## 已确认边界

- 状态和置信度仍是可见文本标签，不依赖颜色。
- Private claim 显示 redacted 状态文本。
- 长 claim 文本使用 `break-words`，source path 使用 `truncate`，避免撑破 Search/Chat 卡片。

## 结论

UX/a11y 要求已补齐；claim evidence 在英文和中文界面中都有明确文本标签。

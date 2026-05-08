# Review Round 4 - 安全与隐私

**视角**: Private scope、audit redaction、claim warning、search/chat evidence 泄漏面。
**日期**: 2026-05-08
**结果**: 发现并修复 1 个隐私问题。

## 检查范围

- Private claim 在 audit summary、search/chat evidence、review handoff 中的脱敏行为。
- `.llm-wiki/claims.jsonl` 坏行 warnings 是否可能暴露 private content 或 secret。
- `claim.write` / `claim.rebuild` audit payload 是否只写 summary/count。
- Memory Ops private scope 既有 redaction 测试。

## 发现与处理

### R4-F1: claim index warning raw line 未脱敏

**严重度**: Important

**证据**:
- `readClaimIndex()` 对坏 JSONL 行会把原始行写入 `ClaimIndexWarning.raw`。
- 如果坏行包含 `<private>...</private>` 或 token 字段，后续 UI/日志展示 warning 时可能外泄。

**修复**:
- `src/lib/claims.ts` 在写入 warning raw 前调用 `redactSensitiveText()`。
- `src/lib/claims.test.ts` 增加坏行 private block 和 secret token 的回归测试。

**验证**:
- `npx vitest run src/lib/claims.test.ts src/lib/claim-evidence.test.ts src/lib/audit-redaction.test.ts src/lib/audit-timeline.test.ts`: 4 files, 27 tests passed。
- `npm run typecheck`: passed。

## 已确认边界

- Private claim evidence 在 search/chat 中显示 `[private claim text redacted]`，并清空 source refs。
- Private claim audit summary 不包含 claim text 或 snippet hash。
- Private-scope audit event 会被压缩为最小 locator summary。

## 结论

安全边界符合本阶段目标；坏 JSONL 行 warnings 已补齐脱敏，避免异常路径泄漏 private text 或 secret。

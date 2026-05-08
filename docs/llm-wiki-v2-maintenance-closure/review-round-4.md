# Review Round 4 — 安全审核

**日期**: 2026-05-08
**视角**: path normalize、private content redaction、audit/report 泄漏、无自动改写边界
**状态**: ✅ 完成

## 结论

本轮发现并修复 1 个自定义 Search Health path 边界问题；未发现 historical conflict patrol 自动改写、audit 原文泄漏或后台扫描问题。

## 发现与修复

| 级别 | 问题 | 修复 |
|------|------|------|
| Important | Custom Search Health scenario path normalize 会把项目外绝对路径如 `/other/wiki/a.md` 归一为相对字符串，`//server/...` 也会在去掉前导 slash 后通过校验。 | `normalizeScenarioPath` 改为先识别绝对路径和 UNC 样式路径；只有位于当前 project root 下的绝对路径才转项目相对路径，项目外绝对路径、UNC、`../`、空路径和 Windows drive escape 都转 skipped/warning。 |

## 泄漏检查

- Historical conflict suggestion 的 `detail/reasons` 只包含 classification、decision、target path 和 evidence summary；不复制 `claimText`、`pageExcerpt` 或完整 page content。
- Pre-write conflict audit 仍通过 `evidenceSummary` 写入结构化元数据，不写入 `claimText` / `pageExcerpt`；已有测试覆盖该边界。
- Search Health report 包含 scenario query、expected paths、top result paths、title、score 和 stream contribution；不包含 Markdown 正文或 search snippet。Audit 只写 summary/source counts/skipped 信息。
- `.llm-wiki/search-health-scenarios.json` 是用户显式保存的本地配置；本轮收紧 path 后不会把项目外路径作为 eval expectation 保存。

## 自动改写边界

- Historical conflict suggestions 不设置 `proposedOperation`。
- `isBatchApplicableMemoryOpsSuggestion` 只接受 `proposedOperation.kind === "metadata-patch"`，所以 historical review-action suggestion 在 batch preview/apply 中保持 ineligible。
- Patrol reminder 只记录 marker/cooldown 并显示提醒；`wiki-automation-events` 测试覆盖 memory.write event 不会调用 `runMemoryOpsPatrol`。

## 验证

- `npx vitest run src/lib/search-health-scenarios.test.ts src/lib/search-health.test.ts`
- `npm run typecheck`

## 残余风险

- Search Health report 仍会记录用户自定义 query 和预期路径，这是 eval/report 的设计行为；如果未来支持 private scenario profile，需要单独增加报告级别的 scope/redaction 策略。

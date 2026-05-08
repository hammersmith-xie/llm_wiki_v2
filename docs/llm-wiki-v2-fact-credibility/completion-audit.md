# Completion Audit - LLM Wiki v2 事实级可信度

**日期**: 2026-05-08
**状态**: 完成
**范围**: Spec A - Fact-Level Credibility

## 需求对照

| 需求 | 状态 | 证据 |
|------|------|------|
| F1 ClaimRecord contract | Done | `src/lib/claims.ts` 定义 claim id、source refs、confidence、reasons、reinforcement、relations、scope/status/lifecycle；`src/lib/claims.test.ts` 覆盖 normalize、stable id、JSONL、redaction。 |
| F2 Markdown claim anchors | Done | `src/lib/claim-anchors.ts` 支持 `<!-- claim:claim_xxx -->` 插入、解析、heading fallback、orphan resolution；`src/lib/claim-anchors.test.ts` 覆盖 CRLF/CJK。 |
| F3 Controlled extraction | Done | `src/lib/claim-extract.ts` 从 digest decisions/lessons 和 claim-friendly Markdown 中提取 bounded candidates；ingest/crystallize/review-created page 已接入。 |
| F4 Claim confidence scoring | Done | `src/lib/claim-confidence.ts` 按 source support、reinforcement、age、contradiction、supersession、scope 输出 confidence/status/reasons。 |
| F5 Claim index operations | Done | `src/lib/claims.ts` 提供 JSONL read/append/merge；`src/lib/claim-ops.ts` 提供 scan/rebuild dry-run/apply、orphan/stale/recovered stats 和 `claim.rebuild` audit。 |
| F6 Search/chat claim evidence | Done | `src/lib/claim-evidence.ts` 和 `src/lib/search.ts` 将 claim evidence 附加到 top results；Search 和 Chat references 复用 `ClaimEvidenceList`。 |
| F7 Claim-level Memory Ops patrol | Done | `src/lib/memory-ops.ts` 读取 claim index 并计算 claim health；`src/lib/memory-ops-rules.ts` 生成 stale/contradicted/superseded review-only suggestions；Maintenance patrol block 展示 claim summary。 |
| F8 Schema/template/prompt updates | Done | `src/lib/schema-contract.ts` 增加 `claimLayer`；TS templates、Rust scaffold、ingest prompt 都说明 anchors、derived claim index 和 high-value-only 约束。 |
| F9 Migration and rebuild notes | Done | README/README_CN、v2 plans 和 requirements 说明旧项目 fallback、claim index rebuild、不读 `raw/sources/`、pre-write conflict gate 非本期。 |
| F10 Review and audit integration | Done | `claim.write`、`claim.rebuild` 进入 audit category；private claim summaries/evidence/warnings 脱敏；contradicted/superseded claim 可生成 review-only handoff。 |

## 最终审核

| Round | 视角 | 报告 | 结果 |
|-------|------|------|------|
| 1 | 功能 | [review-round-1.md](./review-round-1.md) | 修复 rebuild apply 缺少 `.llm-wiki/` 目录创建。 |
| 2 | 类型 & 静态分析 | [review-round-2.md](./review-round-2.md) | 未发现阻塞问题。 |
| 3 | 性能 | [review-round-3.md](./review-round-3.md) | 未发现阻塞问题，确认不读大型 `raw/sources/`。 |
| 4 | 安全 | [review-round-4.md](./review-round-4.md) | 修复 claim index warning raw line 未脱敏。 |
| 5 | UX & a11y | [review-round-5.md](./review-round-5.md) | 修复 claim evidence 英文硬编码，补齐中英文 i18n。 |

## 验证命令

最终通过的验证：

- `npx vitest run src/lib/claims.test.ts src/lib/claim-anchors.test.ts src/lib/claim-confidence.test.ts src/lib/claim-extract.test.ts src/lib/crystallize.test.ts src/lib/crystallization-digest.test.ts src/lib/ingest-execute-writes.test.ts src/lib/review-page.test.ts src/lib/audit-timeline.test.ts src/lib/claim-review.test.ts src/lib/claim-evidence.test.ts src/lib/search-rrf.test.ts src/lib/memory-ops.test.ts src/lib/memory-ops-rules.test.ts src/components/settings/sections/memory-ops-patrol-block.test.tsx src/lib/claim-ops.test.ts src/components/claims/claim-evidence-list.test.tsx src/lib/schema-contract.test.ts src/lib/templates.test.ts src/lib/ingest.prompt.test.ts`
- `npm run typecheck`
- `npm run test:mocks`
- `cd src-tauri && cargo test`

阶段内额外 focused 验证：

- Round 1: `npx vitest run src/lib/claim-ops.test.ts`、`npm run typecheck`
- Round 2: `git diff --check`、`npm run typecheck`、schema/i18n/claim-ops focused suites
- Round 3: claim evidence/search/Memory Ops/rebuild performance focused suites
- Round 4: claims/claim-evidence/audit redaction focused suites、`npm run typecheck`
- Round 5: `ClaimEvidenceList` + i18n parity focused suites、`npm run typecheck`

## 边界确认

- Markdown pages 仍是 source of truth；`.llm-wiki/claims.jsonl` 是 derived, rebuildable index。
- Claim confidence 是 evidence/maintenance signal，不自动裁决事实真假。
- 本期不做历史全量 claim extraction，不做 span/PDF-coordinate provenance，不做自动删除或正文重写。
- Pre-write conflict handling 是 Spec B 的范围，本期只提供 claim records 和 evidence interface。

## 后续状态

后续 **Pre-Write Conflict Handling** 已完成，见 [`../llm-wiki-v2-pre-write-conflict/completion-audit.md`](../llm-wiki-v2-pre-write-conflict/completion-audit.md)。当前事实级 claim 层已经被写入前冲突 gate 复用，用于在 ingest、crystallization 和 review-created page 落盘前识别 duplicate、possible-contradiction、supersession 和 uncertain 写入，并将高风险候选转为 review-only。

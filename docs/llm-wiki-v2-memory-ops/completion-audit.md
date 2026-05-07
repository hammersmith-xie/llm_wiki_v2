# Completion Audit — LLM Wiki v2.1 Memory Ops

**日期**: 2026-05-07
**范围**: T1.1 - T5.1 已完成实现与验证证据
**原则**: Markdown 仍是 durable source of truth；Memory Ops 是本地派生维护层，不是外部 memory server，也不是多 agent memory mesh。

---

## 功能点对照

| 需求 | 落地结果 | 关键文件 | 测试 / 验证 |
|------|----------|----------|-------------|
| F1 Operation Timeline Registry | `.llm-wiki/audit.jsonl` 统一 append/read/filter，坏行容忍，兼容 lifecycle audit | `src/lib/audit-timeline.ts`, `src/lib/lifecycle.ts` | `src/lib/audit-timeline.test.ts`, `src/lib/lifecycle.test.ts` |
| F1/F5 Secret redaction | audit 写入前脱敏 API key/token/password/private block；`scope: private` 事件收缩为摘要 | `src/lib/audit-redaction.ts`, `src/lib/audit-timeline.ts` | `src/lib/audit-redaction.test.ts`, focused tests |
| F2 Memory Ops Patrol Runner | 扫描 wiki pages、typed graph、review/chat/audit 状态，生成 patrol report 并写 `memory_ops.patrol` audit | `src/lib/memory-ops.ts`, `src/stores/activity-store.ts` | `src/lib/memory-ops.test.ts` |
| F3 Lifecycle rules | 基于 lifecycle、confidence、last_confirmed、reinforcement、supersession 生成 metadata suggestions | `src/lib/memory-ops-rules.ts`, `src/lib/lifecycle.ts` | `src/lib/memory-ops-rules.test.ts` |
| F3 Relation cleanup | 对 typed relation 和 supersession 断链生成 review-only cleanup suggestion | `src/lib/memory-ops-rules.ts`, `src/lib/typed-graph.ts`, `src/lib/wiki-alias-index.ts` | `src/lib/memory-ops-rules.test.ts` |
| F4 Crystallization candidates | 对 chat/research/review 输出做确定性评分、去重、reasons/reference 展示 | `src/lib/crystallize-candidates.ts` | `src/lib/crystallize-candidates.test.ts` |
| F4 Confirmed write path | 用户确认后复用 `writeCrystallizedQueryPage`，audit 记录 candidate score/reasons/dedupeKey | `src/lib/crystallize.ts` | `src/lib/crystallize.test.ts` |
| F5 Dry-run / rollback shape | metadata-only operation 支持 dry-run diff、apply result、rollback snapshot、partial failure | `src/lib/memory-ops-executor.ts` | `src/lib/memory-ops-executor.test.ts` |
| F6 Search evaluation | 新增 deterministic eval harness，覆盖 exact title、alias、typed relation、graph-only、vector-only、CJK | `src/lib/search-eval.ts`, `src/lib/search-eval.test.ts` | `src/lib/search-eval.test.ts`, `src/lib/search-rrf.test.ts` |
| F7 UI integration | Settings -> Maintenance 展示 patrol、suggestions、diff preview、apply/ignore/open 和 recent audit | `src/components/settings/sections/maintenance-section.tsx`, `src/components/settings/sections/memory-ops-patrol-block.tsx`, `src/lib/memory-ops-ui.ts` | `src/lib/memory-ops-ui.test.ts`, i18n parity |
| F7 Crystallization UI | Chat/Review/Research 保留低干扰 Save to Wiki 建议，保存后不重复提示 | `src/components/chat/chat-message.tsx`, `src/components/review/review-view.tsx`, `src/components/layout/research-panel.tsx` | `src/lib/crystallize-candidates.test.ts`, `src/lib/crystallize.test.ts` |
| F7 i18n parity | Memory Ops 和 candidate UI 中英文 key 对齐 | `src/i18n/en.json`, `src/i18n/zh.json` | `src/i18n/i18n-parity.test.ts` |

---

## 验证证据

T5.1 新鲜执行结果：

- `npm run typecheck`：退出码 0。
- Focused Vitest：10 个测试文件、40 条用例通过。
- `npm run test:mocks`：88 个测试文件、1117 条用例通过。
- `cargo test`：未运行；本期提交未修改 `src-tauri/` 或 Rust 文件。

Focused 命令覆盖：

```bash
npx vitest run \
  src/i18n/i18n-parity.test.ts \
  src/lib/audit-timeline.test.ts \
  src/lib/audit-redaction.test.ts \
  src/lib/memory-ops-executor.test.ts \
  src/lib/memory-ops.test.ts \
  src/lib/memory-ops-rules.test.ts \
  src/lib/memory-ops-ui.test.ts \
  src/lib/crystallize-candidates.test.ts \
  src/lib/crystallize.test.ts \
  src/lib/search-eval.test.ts
```

---

## 非目标 / 保留边界

- 未引入 `agentmemory`、`iii-engine`、Neo4j、Postgres、Qdrant 或常驻 memory server。
- 未实现自动破坏性删除；archive/stale/promote 都先以 suggestion 和 metadata patch 呈现。
- 未做 claim/span-level provenance；本期仍按 page-level metadata、references、audit event 工作。
- 未把所有 chat session 自动保存；只对高分 candidate 给用户确认入口。
- 未大规模拆分历史 UI 大文件；T4.4 只把新增 Memory Ops 面板职责拆出，`chat-message.tsx` 和 `review-view.tsx` 的更细拆分应另列重构任务。

---

## 后续审核入口

Phase 4 仍需要 5 轮最终审核报告：

- Round 1: 功能视角
- Round 2: 类型安全 / 静态分析
- Round 3: 性能视角
- Round 4: 安全 / 隐私视角
- Round 5: UX / a11y 视角

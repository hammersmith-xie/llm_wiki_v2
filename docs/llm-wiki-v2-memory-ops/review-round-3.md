# Review Round 3 — 性能视角

**日期**: 2026-05-07
**视角**: 巡检扫描范围、重复计算、检索评估成本、UI 刷新成本
**状态**: 完成

---

## 检查范围

- `scanMemoryOpsProject()`
- `runMemoryOpsPatrol()`
- `evaluateLifecycleSuggestions()`
- `evaluateRelationCleanupSuggestions()`
- `runSearchEval()`
- Maintenance UI state refresh path

---

## 结论

性能风险在本期可接受：巡检只读取 `wiki/**/*.md` 与 `.llm-wiki` 状态，不触碰 `raw/sources/` 大文件；规则是确定性单次扫描；search eval 只在测试/评估场景中显式运行。

---

## 发现与处理

| 发现 | 严重度 | 处理 |
|------|--------|------|
| `appendAuditEvent()` 当前通过 read + rewrite 追加 JSONL，大 audit 文件下不是最优 | 低 | 记录为残余风险；当前 Tauri FS wrapper 没有 append primitive，本期 audit 体量较小且 T5.1 mock suite 覆盖通过。后续如果 audit 增长明显，应在 Rust/TS FS 层补 append-only command |
| Maintenance 页运行 patrol 后会重新 `listDirectory(project.path)` 刷新树 | 低 | 保持现状；这是现有 UI 刷新模式，metadata patch 完成后需要刷新 file tree/dataVersion |

---

## 证据

- `src/lib/memory-ops.test.ts` 明确断言 scanner 不读取 `/raw/`。
- `src/lib/search-eval.test.ts` 使用 temp/mock scenario，不依赖真实 embedding 服务。
- `npm run test:mocks` 在 T5.1 通过。

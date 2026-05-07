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
| `appendAuditEvent()` 当前通过 read + rewrite 追加 JSONL，大 audit 文件下不是最优 | 低 | 已在后续补 `append_file` / `appendFile` append-only 通道，`appendAuditEvent()` 不再读取并重写整份 audit 文件 |
| Maintenance 页运行 patrol 后会重新 `listDirectory(project.path)` 刷新树 | 低 | 保持现状；这是现有 UI 刷新模式，metadata patch 完成后需要刷新 file tree/dataVersion |

---

## 证据

- `src/lib/audit-timeline.test.ts` 明确断言 `appendAuditEvent()` 调用 append-only 写入，不读旧 audit、不重写历史。
- `src-tauri/src/commands/fs.rs` 覆盖 `append_file` 连续追加和自动建父目录。
- `src/lib/memory-ops.test.ts` 明确断言 scanner 不读取 `/raw/`。
- `src/lib/search-eval.test.ts` 使用 temp/mock scenario，不依赖真实 embedding 服务。
- `npm run test:mocks` 在 T5.1 通过。

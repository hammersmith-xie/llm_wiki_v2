# Review Round 3 - 性能

**视角**: Claim 读写、search/chat evidence、Memory Ops patrol、rebuild 的扫描范围和回归风险。
**日期**: 2026-05-08
**结果**: 未发现需要本轮修复的性能问题。

## 检查范围

- Search claim evidence 是否只附加到 top results，且不改变 RRF 排序。
- Memory Ops claim health 是否避免读取大型 `raw/sources/`。
- Claim index scan/rebuild 是否只扫描 `wiki/**/*.md` 和 `.llm-wiki/claims.jsonl`。
- JSONL 读取坏行容忍、缺失文件空结果、rebuild dry-run 不写文件。

## 验证

- `npx vitest run src/lib/claim-evidence.test.ts src/lib/search-rrf.test.ts src/lib/memory-ops.test.ts src/lib/claim-ops.test.ts`: 4 files, 25 tests passed。

## 发现与处理

- 无新增阻塞问题。

## 性能边界确认

- Search 在 RRF 排序和 `MAX_RESULTS` slice 后才调用 `attachClaimEvidence()`；claim evidence 不参与 page ranking。
- Claim evidence lookup 接收 top page results 和已有 page paths，不触发全库 Markdown 正文扫描。
- Memory Ops claim health 测试显式禁止读取 `raw/`。
- Claim rebuild 测试显式禁止读取 `raw/`，dry-run 不写 index/audit。

## 后续可选优化

- 大型项目如出现数万 claim，可在后续加 project-local claim index cache 或按 page path 建内存索引；当前 JSONL 方案对本阶段目标足够简单且可审计。

## 结论

当前实现符合本阶段“轻量派生索引，不做后台全量重扫”的性能边界。

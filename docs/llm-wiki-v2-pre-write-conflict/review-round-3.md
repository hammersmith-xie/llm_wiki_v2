# Review Round 3 — 性能审核

**日期**: 2026-05-08
**视角**: bounded resolver / 多 FILE block 写入路径 / 热点扫描
**状态**: 已完成

## 检查范围

- `src/lib/prewrite-conflict-resolver.ts`
- `src/lib/ingest.ts`
- `src/lib/crystallize.ts`
- `src/lib/prewrite-conflict-resolver.test.ts`

## 检查结果

- resolver 默认上限符合需求：
  - claims: 40
  - pages: 20
  - evidence: 10
  - page excerpt: 220 chars
- resolver 不做 embedding、远程 LLM 调用或全量 raw source 扫描。
- claim/page evidence 都在分类前裁剪并排序。

## 发现与修复

### F1: ingest 多 FILE block 会重复读取 claim index 和 wiki page summaries

**问题**: 单个 candidate resolver 有上限，但 `writeFileBlocks` 中每个 FILE block 都会重新调用 `readClaimIndex` 和 `listDirectory/wiki page reads`。大批量 ingest 时这会造成重复 IO。

**修复**:

- 新增 `createPreWriteEvidenceResolverCache()`。
- `previewPreWriteConflict` 支持 `options.cache`。
- 同一次 `writeFileBlocks` 创建一个 `conflictCache`，传给每个 content-page candidate。
- 补测试断言两个 preview 只读取一次 claim index 和一次 page summaries。

## 验证

- `npx vitest run src/lib/prewrite-conflict-resolver.test.ts src/lib/ingest-execute-writes.test.ts`
  - 2 files passed
  - 13 tests passed
- `npm run typecheck`
  - passed

## 剩余风险

- 当前 page evidence 仍会读取最多 20 个 Markdown 页面摘要。这个上限可接受，但未来如果加入 alias/BM25/vector evidence，应继续通过 cache 复用项目级快照。
- Crystallization 单次保存通常只有一个 candidate，未额外引入 cache。

## 结论

性能边界可接受。Round 3 发现的重复扫描问题已修复并有回归测试。

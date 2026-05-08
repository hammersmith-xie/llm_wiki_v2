# Review Round 3 — 性能审核

**日期**: 2026-05-08
**视角**: patrol resolver cache、bounded scan、Search Health scenario 数量、UI 高频路径
**状态**: ✅ 完成

## 结论

本轮未发现需要修复的性能问题。

## 检查项

- Historical conflict patrol 只在 `runMemoryOpsPatrol` 中调用，不在 project open、Maintenance render、search/query 或 automation event 高频路径调用。
- `previewMemoryOpsHistoricalConflicts` 为单次 patrol 创建并复用 `createPreWriteEvidenceResolverCache()`，避免每个页面重复读取 claim index 和 page summaries。
- Pre-write resolver 默认上限保持 bounded：
  - `DEFAULT_MAX_CLAIMS = 40`
  - `DEFAULT_MAX_PAGES = 20`
  - `DEFAULT_MAX_EVIDENCE = 10`
  - `DEFAULT_PAGE_EXCERPT_LENGTH = 220`
- Memory Ops historical conflict candidate 遍历复用 `scanMemoryOpsProject` 已读入的 wiki pages，不额外读取 raw sources，不触发远程/LLM 调用。
- Search Health custom scenarios 只在用户点击 Run Search Health 时执行；加载/保存配置只读写 `.llm-wiki/search-health-scenarios.json`。
- UI 渲染层对长列表已有截断：skipped scenarios 最多展示 5 条，failed scenarios 最多展示 4 条，每个 scenario failures 最多展示 3 条。

## 残余风险

- 历史冲突候选目前覆盖 snapshot 中全部 wiki pages。大型项目下 CPU 成本与 page count 线性相关，但最重的 claim/page evidence 读取已缓存并有上限。若未来项目规模明显增大，可增加 patrol policy 中的 candidate cap 或按 stale/risk/recent-use 优先级采样。
- Custom Search Health scenarios 当前没有硬性数量上限。由于它是显式用户运行的 eval 工具，暂不限制；未来可在 UI 增加场景数量提示和软上限。

## 验证

- 代码路径审查：`src/lib/memory-ops.ts`、`src/lib/memory-ops-conflicts.ts`、`src/lib/prewrite-conflict-resolver.ts`、`src/lib/search-health.ts`、`src/components/settings/sections/maintenance-section.tsx`。
- Round 1 后已通过 focused Search Health tests 和 `npm run typecheck`。

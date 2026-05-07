# Review Round 3 — 性能视角

**日期**: 2026-05-07
**视角**: 性能
**审核范围**: LLM Wiki v2 产品化治理闭环全部已完成任务
**关联需求**: [`requirements.md`](./requirements.md)
**关联任务**: [`tasks.md`](./tasks.md)

---

## 审核清单

- [x] 检查 Timeline、Search Health、batch、policy 面板的高频路径。
- [x] 检查默认列表是否有渲染上限。
- [x] 检查是否存在输入变化触发昂贵文件扫描或 eval 的路径。
- [x] 运行 `npm run typecheck`。
- [x] 运行 `npx vitest run src/lib/audit-timeline-ui.test.ts src/lib/search-health.test.ts src/lib/memory-ops-batch.test.ts`。

---

## 发现

### 🔴 P0 — 必须立刻修

无。

### 🟡 P1 — 应该尽快修

无。

### 🟢 P2 — 改进建议

#### Finding #1: Timeline 过滤在命中 limit 后仍继续扫描剩余事件

- **位置**: `src/lib/audit-timeline-ui.ts`
- **现象**: `filter(...).slice(0, limit)` 会先对所有 audit events 执行过滤，再截断到默认 100 条。
- **影响**: 大型 `.llm-wiki/audit.jsonl` 下默认视图和普通过滤会做不必要的匹配；文本过滤还会对事件执行 `JSON.stringify`。
- **修复**: 改为排序后迭代匹配，收集到 `limit` 即停止，避免继续执行后续过滤条件。

---

## 修复

| Finding | Commit | 状态 | 备注 |
|---------|--------|------|------|
| #1 | 本轮提交 | ✅ | Timeline filter early-stop |

---

## 修复后验证

- [x] `npm run typecheck` 通过。
- [x] `npx vitest run src/lib/audit-timeline-ui.test.ts src/lib/search-health.test.ts src/lib/memory-ops-batch.test.ts` 通过。

---

## 下一轮关注点

Round 4 安全视角重点检查 path sandbox、private-scope redaction、audit 写入内容和 dependency audit。

---

## 总结

- 本轮共发现 1 个问题（P0: 0、P1: 0、P2: 1）。
- 已修 1 个，留 0 个到下一里程碑。
- 手动 Search Health 和 policy 保存均只在显式用户操作时运行，未发现高频自动触发问题。

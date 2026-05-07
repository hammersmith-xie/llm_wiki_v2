# Review Round 3 — 性能视角

**日期**: 2026-05-07
**视角**: 性能
**审核范围**: LLM Wiki v2 Schema 与事件自动化闭环全部已完成任务
**关联需求**: [requirements.md](./requirements.md)
**关联任务**: [tasks.md](./tasks.md)

---

## 审核清单

- [x] 检查 project-level Schema & Quality scan 的文件遍历和读取路径。
- [x] 检查 drift checker、page quality evaluator、coordination summary 的主要复杂度。
- [x] 检查 digest preview 是否 memo 化，是否避免未展开时写 audit。
- [x] 检查 Maintenance patrol 是否只读取最近 schema summary，而不是在 patrol 中重跑 schema scan。
- [x] 运行相关 focused tests 与 `npm run typecheck`。

---

## 发现

### P0 — 必须立刻修

无。

### P1 — 应该尽快修

无。

### P2 — 改进建议

#### Finding #1: Schema scan 串行读取 wiki markdown 文件

- **位置**: `src/lib/schema-quality-project.ts`
- **现象**: `readProjectWikiPages()` 原先逐个 await `readFile`，大项目中 Tauri command 往返会被串行放大。
- **影响**: 500 页级别 scan 仍可完成，但用户等待时间不必要增加。
- **修复**: 增加有上限的并发 mapper，最多 16 个文件并发读取，仍保持 unreadable page 不阻塞 scan。

#### Finding #2: Page quality evaluator 重复解析 frontmatter

- **位置**: `src/lib/page-quality.ts`
- **现象**: `evaluatePageQuality()` 已解析 frontmatter，`structureScore()` 又重新 parse 一次来拿 body。
- **影响**: 单页成本小，但全项目 scan 会放大重复工作。
- **修复**: 将已解析的 body 传给 `structureScore()`，避免重复 parse。

---

## 修复

| Finding | Commit | 状态 | 备注 |
|---------|--------|------|------|
| #1 | 本轮提交 | ✅ | 文件读取改为最多 16 并发。 |
| #2 | 本轮提交 | ✅ | 复用 `parseFrontmatter()` 的 body。 |

---

## 修复后验证

- [x] `npx vitest run src/lib/schema-quality-project.test.ts src/lib/page-quality.test.ts src/lib/schema-quality.test.ts` 通过。
- [x] `npm run typecheck` 通过。
- [x] 修复未改变 scan 输出语义，只减少等待与重复解析。

---

## 下一轮关注点

Round 4 安全视角，重点检查 contract parsing、audit redaction、metadata patch preview/apply 边界和 digest 写入路径。

---

## 总结

- 本轮共发现 2 个问题（P0: 0、P1: 0、P2: 2）。
- 已修 2 个，剩余 0 个。
- 性能风险主要集中在用户主动运行的全项目 scan，已减少最明显的串行 I/O 开销。

# 可执行改动计划总览

这个目录下按 dev-spec-flow 的方式，把 `gap-analysis.md` 里的修复建议拆成**工程师可以直接上手做**的改动计划。

本轮执行边界已经收口为 **local-first + app-resident daemon**：

- Markdown 仍是 source of truth，`.llm-wiki/` 只放本地派生状态、审计、建议和维护状态。
- 允许 app 运行期间有本地维护循环，包括 macOS close-to-hide 后 app 进程仍在时。
- daemon 默认每 15 分钟做一次轻量 maintenance due check；是否跑 patrol 继续受 `autoPatrolEnabled`、cooldown、event/time due 控制。
- 不做远程 memory server、OS 级常驻服务、mesh sync、多用户 ACL 或后台静默改 Markdown。

## 使用方法

按 ROI 顺序做。每个 fix 都有独立文件：

| 文件 | 本轮优先级 | 预计工作量 | 依赖 | 说明 |
|-----|-----------|----------|-----|------|
| [`fix-01-auto-lint-on-ingest.md`](./fix-01-auto-lint-on-ingest.md) | P0 | 半天 | 无 | post-ingest structural lint hints |
| [`fix-02-readme-design-philosophy.md`](./fix-02-readme-design-philosophy.md) | P0 | 30-60 分钟 | 无 | README / README_CN 同步 local-first 立场 |
| [`fix-03-marp-export.md`](./fix-03-marp-export.md) | P1 | 1-2 天 | 无 | 本地 Marp / CSV 导出 |
| [`fix-04-confidence-stale-badge.md`](./fix-04-confidence-stale-badge.md) | P1 | 半天 | 无 | 单页 stale confidence 可见 |
| [`fix-05-patrol-overdue-notification.md`](./fix-05-patrol-overdue-notification.md) | P2 | 1-2 天 | fix-04 先做更好 | app-resident local maintenance daemon |
| [`fix-06-deep-contradiction-scan.md`](./fix-06-deep-contradiction-scan.md) | Future | 2-3 天 | review queue 能承接更好 | 后续手动触发语义扫描，不进本轮主线 |

## 每个 fix 文件的结构

统一格式：

1. **背景与目标** —— 来自哪条差距、要达到什么效果
2. **范围内 / 范围外** —— 明确不做什么
3. **技术方案** —— 具体函数签名、文件位置、调用点
4. **任务清单** —— 带状态 emoji 的可勾选 checklist
5. **验收标准** —— 怎么知道做完了
6. **风险与缓解**

## 建议的执行顺序

**第一批：fix-01 + fix-02**
- 先补 post-ingest structural lint hints，降低 ingest 后无人发现坏链接 / orphan 的概率。
- 同步 README / README_CN，把 local-first、human-gated、app-resident daemon 讲清楚。

**第二批：fix-03 + fix-04**
- fix-03 是本地导出能力，不引入远程服务，直接补 Rohit gist 的 output formats 缺口。
- fix-04 让静态 confidence 的 stale 状态在单页上可见。

**第三批：fix-05**
- 实现 app-resident local maintenance daemon。
- 默认每 15 分钟轻量检查 due state；只有 policy 允许且 cooldown 满足时才自动 patrol。
- app 完全退出后不运行，不安装 OS LaunchAgent / login item。

**后续 backlog：fix-06**
- Deep contradiction scan 需要 LLM 调用、成本估算和 review queue 承接。
- 本轮只保留为手动触发的未来增强，不进入 local-first closure 主线。

## 整体工作量估算

- **本轮主线**（fix-01 到 fix-05）：约 4-6 个工作日
- **含 future scan**（再加 fix-06）：约 7-9 个工作日

以单人投入估算，不含 code review 和 QA 时间。

## 不做的取舍

以下明确**不纳入**这批修复，保持 local-first 立场：

- 远程 memory server / remote backend
- OS 级常驻 daemon / app 完全退出后的后台运行
- Mesh sync / 多实例协作 / 多用户 ACL
- LLM 自动写入 Markdown（不经过 pre-write gate 或 review queue）
- Span-level claim provenance

---

*生成时间：2026-05-10*
*配套文档：[`gap-analysis.md`](./gap-analysis.md)、[`gap-analysis-detailed.md`](./gap-analysis-detailed.md)*

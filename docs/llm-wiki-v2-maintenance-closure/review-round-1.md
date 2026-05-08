# Review Round 1 — 功能审核

**日期**: 2026-05-08
**视角**: 功能完整性，对照 F1-F11
**状态**: ✅ 完成

## 结论

三项闭环主链路已落地：

- Memory Ops patrol 复用 pre-write conflict resolver，历史 duplicate / possible-contradiction / supersession / uncertain 转 review-only suggestion。
- Search Health 支持 `.llm-wiki/search-health-scenarios.json` 自定义场景，能与 built-in scenarios 合并运行并写入 report/audit source counts。
- Patrol reminder 有 clean / dirty / reminder-due 三态，普通事件只更新 marker，完整 patrol 仍需用户显式运行。

## 发现与修复

| 级别 | 问题 | 修复 |
|------|------|------|
| Important | Custom Search Health scenario path normalize 不够严格：绝对项目路径会保存为 `project/wiki/...`，`../outside.md` 也可能进入 scenario。 | `normalizeSearchHealthScenarioConfig` 增加 `projectPath` 感知；项目绝对路径转项目相对路径，`../`、空路径、Windows drive 和 UNC escape 被拒绝并转 skipped/warning。 |

## 验证

- `npx vitest run src/lib/search-health-scenarios.test.ts src/lib/search-health.test.ts src/components/settings/sections/search-health-panel.test.tsx`
- `npm run typecheck`

## 残余风险

- 本轮未发现功能阻塞。历史冲突 patrol 的误报控制仍依赖 bounded resolver 和 same-target filter，性能/安全轮会继续检查。

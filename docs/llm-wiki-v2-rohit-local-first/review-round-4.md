# Review Round 4 — 安全与 Local-First 边界

**日期**: 2026-05-10  
**视角**: 无远程后端、无自动重写、Git-friendly 写入

## 结论

实现没有引入远程 memory server、新数据库、多用户 sync、OS 级常驻服务或后台静默 Markdown 改写。daemon 是 app-resident：随 project 打开启动，project switch/unmount 停止，app 完全退出后无独立进程。

## 核对

- Markdown 仍是 source of truth。
- `.llm-wiki/ingest-lint-hints.json` 是可清理派生状态。
- maintenance cooldown/policy 仍走本地 app store。
- daemon reminder 只写 Activity 和 session store。
- auto patrol 继续走已有 audit 和 suggestion 机制，不绕过 apply/review。
- Export 只写用户通过 Tauri save dialog 选择的外部路径，不改 wiki 原文件。
- Confidence stale badge 只提示，不自动改 confidence。

## 残余风险

- `autoPatrolEnabled=true` 时 daemon 可触发 deterministic patrol；这沿用已有 policy gate 和 audit 机制。真正 Markdown 变更仍需用户确认 apply。

## 验证

- `npm run typecheck` 通过。
- `npm run test:mocks` 通过。

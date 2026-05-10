# Review Round 3 — 性能

**日期**: 2026-05-10  
**视角**: daemon interval、lint/export 成本、高频扫描风险

## 结论

当前实现符合 local-first 的性能边界：daemon 默认 15 分钟只做轻量 due check，不做全量 wiki scan；post-ingest lint 只跑 structural lint；Marp/CSV export 只处理当前 preview 文件。

## 核对

- `local-maintenance-daemon` 每 tick 只读取 policy 和 maintenance status。
- `scheduleAutoMemoryOpsPatrol` 只在 `reminderDue` 且 `autoPatrolEnabled=true` 时调用。
- daemon controller 有 in-flight guard，长 check 不会重入。
- 同一 project 重复 start 不创建多个 interval。
- stop 会 clear interval，project switch/unmount 不留下旧 loop。
- post-ingest lint 为 best-effort，失败不阻塞 ingest。
- export 不扫描全库，不引入 Marp CLI 子进程。

## 残余风险

- `getMemoryOpsMaintenanceStatus` 内部会再次加载 policy；daemon 单次 check 同时也加载 policy 用于 auto patrol 决策。当前只是本地 store 读取，成本很低，暂不需要为此扩大接口。

## 验证

- `src/lib/local-maintenance-daemon.test.ts` 覆盖 15 分钟默认 interval、stop 清理、重复 start、in-flight guard。
- `npm run test:mocks` 通过。

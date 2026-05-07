# Review Round 4 — 安全 / 隐私视角

**日期**: 2026-05-07
**视角**: 写入边界、secret redaction、private scope、dry-run/apply 安全性
**状态**: 完成

---

## 检查范围

- `src/lib/audit-redaction.ts`
- `src/lib/audit-timeline.ts`
- `src/lib/memory-ops-executor.ts`
- `src/components/settings/sections/maintenance-section.tsx`
- Memory Ops apply / preview / open target path

---

## 发现与修复

| 发现 | 严重度 | 修复 |
|------|--------|------|
| `applyMemoryOpsOperations()` 允许项目外绝对 `targetPath`，未来如果非扫描来源传入 operation，metadata patch 可能读写项目根目录外文件 | 高 | 新增 `resolveMemoryOpsTargetPath()`，强制 resolved path 必须位于 project root 内；executor、preview、open target 都复用同一边界检查 |
| `../` parent traversal 仍可能绕过单纯前缀检查 | 高 | `resolveMemoryOpsTargetPath()` 对路径段中的 `..` 直接拒绝 |
| 缺少越界 metadata operation 回归测试 | 高 | 新增 absolute escape 和 parent traversal 两个 `memory-ops-executor.test.ts` 用例，先观察失败，再修复到通过 |

---

## 保留边界

- `audit-redaction.ts` 覆盖常见 API key/token/password/private block，不声称能识别所有可能秘密格式。
- `scope: private` audit event 被收缩到最小摘要，但这不是访问控制系统；README 和 completion audit 已明确本期不做 ACL。

---

## 证据

- RED: `npx vitest run src/lib/memory-ops-executor.test.ts` 曾失败，错误显示代码会继续尝试读取 `/tmp/outside.md` 和 `../outside.md`。
- GREEN: 修复后 `src/lib/memory-ops-executor.test.ts` 5/5 通过。
- `npm run typecheck` 退出码 0。

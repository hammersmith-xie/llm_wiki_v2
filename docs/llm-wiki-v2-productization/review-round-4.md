# Review Round 4 — 安全视角

**日期**: 2026-05-07
**视角**: 安全
**审核范围**: LLM Wiki v2 产品化治理闭环全部已完成任务
**关联需求**: [`requirements.md`](./requirements.md)
**关联任务**: [`tasks.md`](./tasks.md)

---

## 审核清单

- [x] 检查 Memory Ops target path 是否经 project-root sandbox。
- [x] 检查 rollback/private scope audit 是否泄漏 before/after content。
- [x] 检查 Search Health、policy update、batch summary audit 内容。
- [x] 运行 `npm audit --audit-level=high --registry=https://registry.npmjs.org`。
- [x] 运行 `npx vitest run src/lib/memory-ops-batch.test.ts src/lib/memory-ops-rollback.test.ts src/lib/memory-ops-executor.test.ts src/lib/audit-redaction.test.ts src/lib/search-health.test.ts`。

---

## 发现

### 🔴 P0 — 必须立刻修

无。

### 🟡 P1 — 应该尽快修

#### Finding #1: npm audit 报出 Vite high severity 和多项 moderate transitive 漏洞

- **位置**: `package-lock.json`
- **现象**: 官方 registry audit 报告 7 个漏洞：Vite high severity，Hono/@hono/node-server、DOMPurify、PostCSS、ip-address 等 moderate。
- **影响**: Vite dev server 类漏洞属于开发期高危面；DOMPurify/PostCSS 等 transitive 漏洞也应尽快升级。
- **复现步骤**:
  1. `npm audit --audit-level=high --registry=https://registry.npmjs.org`
  2. 查看 Vite high severity 和 transitive moderate findings。
- **修复**: 运行非强制 `npm audit fix --registry=https://registry.npmjs.org` 更新 lockfile 中相关补丁版本。

### 🟢 P2 — 改进建议

无。

---

## 修复

| Finding | Commit | 状态 | 备注 |
|---------|--------|------|------|
| #1 | 本轮提交 | ✅ | `npm audit fix` 更新 lockfile |

---

## 修复后验证

- [x] `npm audit --audit-level=high --registry=https://registry.npmjs.org` 输出 `found 0 vulnerabilities`。
- [x] `npm run typecheck` 通过。
- [x] `npm run test:mocks` 通过，97 files / 1179 tests。
- [x] Security focused Vitest suites 通过。

---

## 下一轮关注点

Round 5 UX & a11y 重点检查 tabs、checkbox、date inputs、错误态、空态和中英文长文案是否可用。

---

## 总结

- 本轮共发现 1 个问题（P0: 0、P1: 1、P2: 0）。
- 已修 1 个，留 0 个到下一里程碑。
- 备注：默认 npm 镜像 `npmmirror` 不支持 audit endpoint；本轮依赖审计使用官方 npm registry 完成。

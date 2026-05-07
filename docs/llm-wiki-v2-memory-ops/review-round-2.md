# Review Round 2 — 类型安全 / 静态分析

**日期**: 2026-05-07
**视角**: TypeScript 类型、导入边界、测试隔离、明显静态风险
**状态**: 完成

---

## 检查范围

- `npm run typecheck`
- 新增 / 修改的 TypeScript 文件
- `rg` 扫描：`as any`、`.skip`、`only(`、`dangerouslySetInnerHTML`、明显 secret 直写、硬编码新增 UI label

---

## 结论

类型检查通过，新增核心模块没有引入 `any`/`as any`、跳过测试或危险 DOM sink。T5.3 修复后，UI 新增 candidate label 也走 i18n key。

---

## 发现与处理

| 发现 | 严重度 | 处理 |
|------|--------|------|
| Chat/Review candidate UI 存在新增硬编码英文 label，i18n parity test 无法发现这种问题 | 中 | 已新增 `chat.saveSuggested`、`chat.refs`、`review.saveSuggested` 等 key，并改为 `useTranslation()` |
| `maintenance-section.tsx`、`chat-message.tsx`、`review-view.tsx` 仍偏长 | 低 | 记录为后续重构项；T4.4 已先拆出新增 Memory Ops 面板，避免在最终审核阶段做大规模 UI 重排 |

---

## 证据

- `npm run typecheck` 退出码 0。
- Focused i18n/executor/candidate/crystallize tests 通过。
- `rg` 未发现新增 `as any`、`.skip`、`only(` 或 `dangerouslySetInnerHTML`。

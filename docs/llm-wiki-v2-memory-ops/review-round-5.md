# Review Round 5 — UX / a11y 视角

**日期**: 2026-05-07
**视角**: 可见状态、键盘可达性、i18n、窄面板布局、非颜色状态表达
**状态**: 完成

---

## 检查范围

- `src/components/settings/sections/memory-ops-patrol-block.tsx`
- `src/components/settings/sections/maintenance-section.tsx`
- `src/components/chat/chat-message.tsx`
- `src/components/review/review-view.tsx`
- `src/i18n/en.json`
- `src/i18n/zh.json`

---

## 发现与修复

| 发现 | 严重度 | 修复 |
|------|--------|------|
| Chat/Review 新增 candidate prompt 使用硬编码英文 `Save suggested` | 中 | 新增并使用 `chat.saveSuggested`、`chat.refs`、`review.saveSuggested` 中英 key |
| Review card 关闭按钮只有图标，没有明确 accessible label | 中 | 增加 `type="button"`、`aria-label` 和 `title`，复用 `review.dismiss` |

---

## 结论

Maintenance 的 Memory Ops block 已覆盖无项目、运行中、失败、空建议、warnings、recent audit、diff preview、review-only suggestion 等状态；按钮有文本 label，不只靠颜色表达状态；suggestion/action 区域使用 flex-wrap，窄面板下不会因为单行按钮组强行挤压。

---

## 证据

- `src/i18n/i18n-parity.test.ts` 通过。
- Focused candidate/crystallize/executor tests 通过。
- `npm run typecheck` 退出码 0。

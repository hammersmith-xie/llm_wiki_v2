# Review Round 5 — UX & 可访问性审核

**日期**: 2026-05-08
**视角**: Review item 可读性 / i18n / audit timeline 可发现性
**状态**: 已完成

## 检查范围

- `src/components/review/review-card.tsx`
- `src/components/review/review-card.test.tsx`
- `src/components/settings/sections/audit-timeline-panel.tsx`
- `src/lib/audit-timeline-ui.ts`
- `src/lib/audit-timeline-ui.test.ts`
- `src/i18n/en.json`
- `src/i18n/zh.json`

## 检查结果

- 高风险写入会进入既有 Review queue，不新增独立 wizard，符合本期轻量边界。
- Review item 已包含 classification、decision、reasons、evidence summary 和 affected pages。
- Audit timeline 已支持 `conflict` category，能展示 `conflict.preview` / `conflict.accept` / `conflict.review`。
- UI 文案仍走既有中英文 i18n 文件；本期新增的面板文案没有裸露未翻译 key。

## 发现与修复

### F1: Pre-write conflict description 多行信息被压扁

**问题**: `ReviewCard` 使用普通 `<p>` 渲染 description。pre-write conflict review item 的 description 是多行摘要，包含分类、决策、原因和证据；普通段落会让人工复核时难以快速扫描。

**修复**:

- 将 description 容器改为 `whitespace-pre-wrap`。
- 增加 `ReviewCard` 测试，锁定 pre-write conflict review 的标题、分类、证据和操作按钮可见。

### F2: Audit timeline 的 conflict / review-only 过滤入口不完整

**问题**: 底层 audit summary 已可归类 `conflict`，但设置面板的 category 下拉没有 `conflict`；`conflict.review` 的状态是 `review-only`，状态下拉也没有对应选项。

**修复**:

- `CATEGORY_OPTIONS` 增加 `conflict`。
- `STATUS_OPTIONS` 增加 `review-only`，并按风险/需人工处理色调展示。
- 中英文 i18n 增加 `conflict` category、`review-only` status，并更新 audit timeline 描述。
- `audit-timeline-ui` 测试增加 conflict category 与 review-only status 过滤断言。

## 验证

- `npx vitest run src/components/review/review-card.test.tsx src/lib/audit-timeline-ui.test.ts`
  - 2 files passed
  - 9 tests passed
- `npm run typecheck`
  - passed

## 剩余风险

- Review item 目前仍是轻量 action buttons，没有专门的 side-by-side diff。对“覆盖旧页”这种复杂人工确认，后续可以在 review queue 里增加目标页 diff 预览，但这不是本期范围。

## 结论

UX 与可发现性达到本期要求：用户能在 review item 中读到写入被拦截的原因，并能在 audit timeline 中按 `conflict` / `review-only` 过滤追踪。

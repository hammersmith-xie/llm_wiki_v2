# Fix 04 — Confidence Stale Badge

> **优先级**：P1
> **预计工作量**：半天（~50 行核心 + 小 UI 改动）
> **修复的差距**：[gap-analysis-detailed.md § ①](./gap-analysis-detailed.md#①-confidence-decay--静态固化-vs-持续衰减)

---

## 1. 背景与目标

### 问题

Confidence 是**写入时固化**到 frontmatter 的静态值。即使本轮会加入 app-resident local daemon，也不应该让 daemon 在后台静默改 frontmatter 数值。用户不主动确认或运行 patrol，一个半年前的 page 仍然可能顶着当时算出的 0.90 confidence。

LLM 在搜索/问答时把这个数字当"最近验证过"的信号使用——但实际可能早就该衰减了。

### 目标

**让静态固化可见**（而不是让 confidence 变活——那违反 SPEC Non-Goal）。

在 `frontmatter-panel` 显示 confidence 的位置旁边加一个徽章：

- 当 `Date.now() - last_confirmed > halfLife` 时显示
- 文字："Last confirmed N days ago. Confidence may be stale."
- 带一个按钮 "Run patrol"，点击触发 Memory Ops patrol（或跳转到 Memory Ops 面板）

### 非目标

- 不改 confidence 计算逻辑
- 不自动刷新 confidence，也不让 daemon 静默改 frontmatter
- 不在搜索/chat context 里降权过期 page（那要改 retrieval logic，另一个 fix）
- 不做全局"wiki 有 N 个过期 page"的提示（那是 fix-05 local maintenance daemon 的职责）

---

## 2. 技术方案

### 2.1 过期判定

**文件**：`src/lib/lifecycle.ts`（新增导出函数）

```ts
export interface StaleAssessment {
  isStale: boolean
  daysSinceConfirmed: number
  halfLifeDays: number
  tier: LifecycleTier
}

export function assessConfidenceStaleness(
  lastConfirmed: string | undefined,
  tier: LifecycleTier = "semantic",
  now: number = Date.now(),
): StaleAssessment {
  const halfLifeDays = getHalfLifeDays(tier)  // 已有函数或常量
  if (!lastConfirmed) {
    return { isStale: false, daysSinceConfirmed: 0, halfLifeDays, tier }
  }
  const confirmedMs = Date.parse(lastConfirmed)
  if (Number.isNaN(confirmedMs)) {
    return { isStale: false, daysSinceConfirmed: 0, halfLifeDays, tier }
  }
  const days = (now - confirmedMs) / (1000 * 60 * 60 * 24)
  return {
    isStale: days > halfLifeDays,
    daysSinceConfirmed: Math.floor(days),
    halfLifeDays,
    tier,
  }
}
```

**半衰期常量**（已在 `lifecycle.ts` 的 tier 配置中，这里只是 export 一个 helper）：

```
procedural: 365 days
semantic:   180 days
episodic:    45 days
working:     45 days
archived:   Infinity (不标过期)
```

**单测 `src/lib/lifecycle.test.ts`** 补充：
- lastConfirmed = undefined → isStale false
- lastConfirmed = 昨天 → isStale false
- lastConfirmed = 1 年前 + tier=semantic → isStale true
- lastConfirmed = malformed string → isStale false（健壮）
- tier=archived → 永不 stale

### 2.2 UI 徽章

**文件**：`src/components/editor/frontmatter-panel.tsx`（现有 532 行）

现状（行 79）：
```ts
const lastConfirmed = stringValue(data.last_confirmed)
```

现状（行 182-249）：有 `{hasLifecycle && ...}` 区块展示 lifecycle chips。行 192-198 展示 confidence chip，行 224-230 展示 lastConfirmed chip。

**改动**：在 confidence chip 之后、或者 lastConfirmed chip 内部，加一个过期徽章：

```tsx
import { assessConfidenceStaleness } from "@/lib/lifecycle"
import { AlertCircle } from "lucide-react"

// 在组件顶部计算（与行 79 的 lastConfirmed 一起）
const lifecycle = (stringValue(data.lifecycle) ?? "semantic") as LifecycleTier
const staleness = assessConfidenceStaleness(lastConfirmed, lifecycle)

// 在 confidence chip 之后 (行 192-198 之后) 加：
{staleness.isStale && (
  <div className="col-span-full flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 text-amber-900 text-xs">
    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
    <span className="flex-1">
      Last confirmed {staleness.daysSinceConfirmed}d ago 
      (half-life: {staleness.halfLifeDays}d). Confidence may be stale.
    </span>
    <button
      className="px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-xs font-medium"
      onClick={handleRunPatrol}
    >
      Run patrol
    </button>
  </div>
)}
```

### 2.3 "Run patrol" 按钮的行为

两种实现路径：

**方案 A（简单）**：跳转到 Memory Ops 面板

```tsx
const setActiveView = useWikiStore((s) => s.setActiveView)
const handleRunPatrol = () => setActiveView("settings")
// 然后用户在 Memory Ops 面板手动点 "Run patrol"
```

**方案 B（直接触发）**：直接调用 patrol 函数

```tsx
import { runMemoryOpsPatrol } from "@/lib/memory-ops"

const handleRunPatrol = async () => {
  await runMemoryOpsPatrol({ projectPath, ... })
  // 刷新 frontmatter panel 数据
}
```

**推荐方案 A**：
- 不耦合到 memory-ops 的具体调用签名
- 用户能在 Memory Ops 面板里看到完整上下文（其他 stale page 数量、上次 patrol 时间等）
- 如果 patrol 失败有统一的错误处理 UI
- fix-05 之后，Memory Ops 面板会是所有"刷新相关"操作的统一入口
- 和 app-resident daemon 兼容：daemon 负责提醒和 policy-gated patrol，单页 badge 只负责把 stale 解释清楚

### 2.4 半衰期 tier 推导

注意 tier 从 frontmatter `lifecycle` 字段读：

```ts
const lifecycle = (stringValue(data.lifecycle) ?? "semantic") as LifecycleTier
```

如果 page 没标 lifecycle，默认按 semantic 判断（180 天）。

---

## 3. 任务清单

- [ ] ⏳ **T1** 在 `src/lib/lifecycle.ts` 导出 `assessConfidenceStaleness` 和 `StaleAssessment` 类型
- [ ] ⏳ **T2** 单测 `src/lib/lifecycle.test.ts` 加 5 个用例（undefined / 新 / 过期 / malformed / archived）
- [ ] ⏳ **T3** 在 `src/components/editor/frontmatter-panel.tsx` 行 192-198 之后加过期徽章 JSX
- [ ] ⏳ **T4** 实现 `handleRunPatrol` 跳转到 settings view
- [ ] ⏳ **T5** 手测：
  - 改一个 page 的 `last_confirmed` 为 1 年前，打开这个 page，徽章应出现
  - 改为今天，徽章应消失
  - 点 "Run patrol" 跳转到 Memory Ops 面板
- [ ] ⏳ **T6** 更新 [gap-analysis-detailed.md](./gap-analysis-detailed.md) 漂移 ① 的"修复状态"标注

依赖：T1 → T2, T3；T3 → T4；T4 → T5

---

## 4. 验收标准

- [ ] 打开一个 `last_confirmed` 超过半衰期的 page，frontmatter panel 显示琥珀色徽章
- [ ] 徽章正确显示天数（向下取整）和半衰期
- [ ] 不同 tier 的半衰期推导正确（procedural 365 / semantic 180 / episodic/working 45）
- [ ] `last_confirmed` 缺失或格式错误时，徽章**不显示**（不是崩溃）
- [ ] tier=archived 时徽章**不显示**
- [ ] 点击 "Run patrol" 跳转到 Memory Ops 面板，该面板里能手动触发
- [ ] `npm run typecheck` 和 `npm run test:mocks` 通过

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|-----|-----|-----|------|
| 半衰期阈值过于激进（180 天），用户抱怨"所有 page 都过期" | 中 | 中 | 半衰期可能在 Lifecycle Policy 面板已经可调；徽章按实际阈值走，用户嫌多可以调大 |
| 用户点 "Run patrol" 后期望"这一页立即刷新"，但 patrol 是全局的 | 中 | 低 | 跳转到 Memory Ops 后，patrol 完成会全局重算；不承诺"只刷新这页" |
| `last_confirmed` 在旧 project 里大量缺失 | 高 | 低 | 缺失时不显示徽章（不骚扰），只对有明确时间戳的 page 报过期 |
| tier 字段不规范（大小写 / 拼写错误） | 中 | 低 | `assessConfidenceStaleness` 对未知 tier 默认按 semantic 处理，不崩 |

---

## 6. 备注块

### 🐛 遇到的问题
_（开发时填）_

### 🔧 最终实现逻辑
_（开发时填）_

### 🎯 关键决策
_（比如是否加 "Dismiss for this page" 选项、半衰期是否按配置动态读等）_

---

*关联文档：[gap-analysis.md](./gap-analysis.md)、[gap-analysis-detailed.md § ①](./gap-analysis-detailed.md#①-confidence-decay--静态固化-vs-持续衰减)*

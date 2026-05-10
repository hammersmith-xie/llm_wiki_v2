# Fix 06 — Deep Contradiction Scan (Future Manual Review Tool)

> **优先级**：Future / Backlog
> **预计工作量**：2-3 天（~300 行核心 + UI + LLM 集成）
> **修复的差距**：[gap-analysis-detailed.md § ③](./gap-analysis-detailed.md#③-contradiction-detection--元数据驱动-vs-语义理解)
> **本轮状态**：不进入 local-first closure 主线；保留为后续手动增强规格。

---

## 1. 背景与目标

### 问题

Contradiction detection 完全靠 frontmatter 里显式的 `contradicts: []` 数组和 `review_status: contradicted` 字段。如果 ingest 时 LLM 没主动填这些字段，**真正语义级别的矛盾永远不会被发现**。

举例：
- 论文 1 写进 `wiki/concepts/scaling-law.md`：claim "scaling 在 100B 后收益递减"
- 论文 2 写进同页：claim "Chinchilla 表明 scaling 仍然线性"
- 两个 claim 语义冲突，但 `contradicts: []` 都空
- 系统不标冲突

### 目标

在 Memory Ops 面板加一个 **"Deep contradiction scan"** 按钮：
- 扫描所有 claim（或选定 entity 集群）
- 对看起来相关的 claim pair（同 subject / 同 entity），用 LLM 判定"是否矛盾"
- 结果**只写到 review 队列**，**绝不**自动改 Markdown
- 用户审核、决定是否在冲突 page 上加 `contradicts` 标注

保持 gnusupport 立场：LLM 做建议，人类做决定。

本 fix 明确是后续 backlog。当前 local-first closure 只做确定性、低成本、本地维护能力；deep scan 需要 LLM 成本估算、review queue 承接和误报治理，不应阻塞本轮交付。

### 非目标

- 不自动改 Markdown
- 不替代 pre-write conflict gate（那是 ingest 时的确定性检测，这个是事后的语义扫描）
- 不做全库 O(n²) 扫描（成本过高）——用 entity cluster / 同 wikipage 内聚焦
- 不允许 scan 过程中写新 claim（只读分析）
- 不在 auto patrol 中跑（那会引爆 LLM 成本）——只手动触发
- 不在 app-resident local maintenance daemon 中跑
- 不作为本轮必须实现项

---

## 2. 技术方案

### 2.1 配对策略（避免 O(n²)）

全库 claim pair 配对不可行（100 page × 10 claim/page = 1000 claims → 50 万 pair → 50 万 LLM 调用）。

**聚焦策略**：
1. **同 page 内**：一个 page 内部的 claim 先过一遍（高优先级，最可能冲突）
2. **同 entity cluster**：通过 typed graph 找"同一 entity 的强邻居页"里的 claim
3. **跨 page 但同 subject keyword**：claim 的 `subject` 字段字符串相似度 > threshold

每一层的 pair 数量：
- 同 page：O(claims per page²) ~ 几十个
- 同 entity：O(page 数 × 平均 claim × 邻居数) ~ 几百个
- 同 subject：可选增强

**v1 只做第 1 层**（同 page 内），上线看效果再扩。

### 2.2 Prompt 设计

```
You are reviewing claims from a personal knowledge wiki. Two claims about the 
same topic may or may not contradict each other.

Claim A: "{{subject}}: {{predicate_A}}"
Source A: {{page_A}} (confidence {{conf_A}})

Claim B: "{{subject}}: {{predicate_B}}"
Source B: {{page_B}} (confidence {{conf_B}})

Respond in strict JSON:
{
  "verdict": "contradictory" | "consistent" | "orthogonal" | "uncertain",
  "reason": "one sentence, max 50 words"
}

- "contradictory": the claims cannot both be true
- "consistent": claims agree or one is a specialization of the other
- "orthogonal": claims are about different aspects and don't conflict
- "uncertain": not enough information to judge
```

**关键点**：
- 要求 strict JSON，便于解析
- 4 分类（不只是 yes/no），给 "uncertain" 逃生通道降低误报
- 让 LLM 给出 reason 方便用户审核

### 2.3 数据模型

**新建 `src/lib/deep-contradiction-scan.ts`**：

```ts
import { streamChat } from "./llm-client"
import { readAllClaims, type ClaimRecord } from "./claims"
import { appendAuditEvent } from "./audit-events"
import { writeFile, readFile, fileExists } from "@/commands/fs"

export type ContradictionVerdict = 
  | "contradictory" | "consistent" | "orthogonal" | "uncertain"

export interface ContradictionFinding {
  id: string
  claimA: string  // claim id
  claimB: string
  subject: string
  verdict: ContradictionVerdict
  reason: string
  timestamp: number
  reviewStatus: "pending" | "accepted" | "rejected" | "deferred"
}

const SUGGESTIONS_PATH_REL = ".llm-wiki/contradiction-suggestions.jsonl"

export interface ScanOptions {
  scope: "same-page" | "same-entity" | "full"  // v1 only same-page
  pageFilter?: string[]  // optional subset
  maxPairs?: number  // safety limit (default 100)
  onProgress?: (done: number, total: number) => void
}

export interface ScanResult {
  totalPairs: number
  contradictoryCount: number
  consistentCount: number
  orthogonalCount: number
  uncertainCount: number
  durationMs: number
  findings: ContradictionFinding[]
}

export async function runDeepContradictionScan(
  projectPath: string,
  llmConfig: LlmConfig,
  options: ScanOptions,
): Promise<ScanResult> {
  const startMs = Date.now()
  const claims = await readAllClaims(projectPath)
  const pairs = buildClaimPairs(claims, options)
  const cap = Math.min(pairs.length, options.maxPairs ?? 100)
  
  const findings: ContradictionFinding[] = []
  for (let i = 0; i < cap; i++) {
    const [a, b] = pairs[i]
    const result = await evaluatePair(a, b, llmConfig)
    findings.push({
      id: `contra_${Date.now()}_${i}`,
      claimA: a.id,
      claimB: b.id,
      subject: a.subject ?? "",
      verdict: result.verdict,
      reason: result.reason,
      timestamp: Date.now(),
      reviewStatus: "pending",
    })
    options.onProgress?.(i + 1, cap)
  }
  
  await persistFindings(projectPath, findings)
  await appendAuditEvent(projectPath, {
    category: "deep-contradiction-scan",
    action: "scan-complete",
    summary: `scanned ${cap} pairs, ${findings.filter(f => f.verdict === "contradictory").length} potential contradictions`,
  })
  
  return {
    totalPairs: cap,
    contradictoryCount: findings.filter((f) => f.verdict === "contradictory").length,
    consistentCount: findings.filter((f) => f.verdict === "consistent").length,
    orthogonalCount: findings.filter((f) => f.verdict === "orthogonal").length,
    uncertainCount: findings.filter((f) => f.verdict === "uncertain").length,
    durationMs: Date.now() - startMs,
    findings,
  }
}

function buildClaimPairs(
  claims: ClaimRecord[],
  options: ScanOptions,
): [ClaimRecord, ClaimRecord][] {
  if (options.scope !== "same-page") {
    // v1 scope: only same-page
    throw new Error("scope not yet supported: " + options.scope)
  }
  const byPage = groupBy(claims, (c) => c.page)
  const pairs: [ClaimRecord, ClaimRecord][] = []
  for (const [page, pageClaims] of byPage) {
    if (options.pageFilter && !options.pageFilter.includes(page)) continue
    for (let i = 0; i < pageClaims.length; i++) {
      for (let j = i + 1; j < pageClaims.length; j++) {
        pairs.push([pageClaims[i], pageClaims[j]])
      }
    }
  }
  return pairs
}

async function evaluatePair(
  a: ClaimRecord,
  b: ClaimRecord,
  llmConfig: LlmConfig,
): Promise<{ verdict: ContradictionVerdict; reason: string }> {
  const prompt = buildPrompt(a, b)
  const response = await callLLM(prompt, llmConfig)
  return parseVerdict(response)
}

function buildPrompt(a: ClaimRecord, b: ClaimRecord): string {
  return `You are reviewing claims from a personal knowledge wiki. ...
Claim A: "${a.subject}: ${a.predicate ?? a.assertion}"
Source A: ${a.page} (confidence ${a.confidence ?? "?"})

Claim B: "${b.subject}: ${b.predicate ?? b.assertion}"
Source B: ${b.page} (confidence ${b.confidence ?? "?"})

Respond in strict JSON:
{
  "verdict": "contradictory" | "consistent" | "orthogonal" | "uncertain",
  "reason": "one sentence"
}`
}

function parseVerdict(raw: string): { verdict: ContradictionVerdict; reason: string } {
  // Extract JSON from response (LLM may wrap in markdown)
  const match = raw.match(/\{[^}]*\}/s)
  if (!match) return { verdict: "uncertain", reason: "failed to parse LLM response" }
  try {
    const parsed = JSON.parse(match[0])
    return {
      verdict: validateVerdict(parsed.verdict),
      reason: String(parsed.reason ?? "").slice(0, 200),
    }
  } catch {
    return { verdict: "uncertain", reason: "malformed JSON in LLM response" }
  }
}

function validateVerdict(v: unknown): ContradictionVerdict {
  const valid: ContradictionVerdict[] = ["contradictory", "consistent", "orthogonal", "uncertain"]
  return valid.includes(v as ContradictionVerdict)
    ? (v as ContradictionVerdict)
    : "uncertain"
}

async function persistFindings(
  projectPath: string,
  findings: ContradictionFinding[],
): Promise<void> {
  const path = `${projectPath}/${SUGGESTIONS_PATH_REL}`
  const lines = findings
    .filter((f) => f.verdict === "contradictory")  // only persist interesting ones
    .map((f) => JSON.stringify(f))
    .join("\n")
  if (lines.length === 0) return
  const existing = await fileExists(path) ? await readFile(path) : ""
  await writeFile(path, existing + (existing ? "\n" : "") + lines)
}

export async function readContradictionSuggestions(
  projectPath: string,
): Promise<ContradictionFinding[]> {
  const path = `${projectPath}/${SUGGESTIONS_PATH_REL}`
  if (!(await fileExists(path))) return []
  const raw = await readFile(path)
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try { return JSON.parse(l) as ContradictionFinding }
      catch { return null }
    })
    .filter((x): x is ContradictionFinding => x !== null)
}
```

### 2.4 单测

**文件** `src/lib/deep-contradiction-scan.test.ts`：
- `buildClaimPairs` 空输入 / 单 claim / 多 claim / pageFilter 生效
- `parseVerdict` 标准 JSON / 包裹 markdown / 无效 JSON / 未知 verdict → uncertain
- Mock LLM 返回不同 verdict，验证 `runDeepContradictionScan` 聚合数字正确

### 2.5 UI 集成

**文件**：`src/components/settings/sections/memory-ops-patrol-block.tsx`（或新建一个 `deep-contradiction-scan-block.tsx` 挂在同一个 settings section）

**加入一个新 block**：

```tsx
<section className="space-y-3 p-4 border rounded">
  <h3 className="font-medium">Deep Contradiction Scan</h3>
  <p className="text-sm text-muted-foreground">
    Uses the configured LLM to detect semantic contradictions between claims
    on the same page. Results go to the review queue; Markdown is not modified.
  </p>
  
  <div className="flex items-center gap-2">
    <button
      onClick={handleRunScan}
      disabled={scanRunning || !llmConfigured}
      className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm"
    >
      {scanRunning ? `Scanning ${progress.done}/${progress.total}...` : "Run scan"}
    </button>
    <span className="text-xs text-muted-foreground">
      ~{estimatedPairs} pairs to evaluate
    </span>
  </div>
  
  {lastResult && (
    <div className="text-sm space-y-1">
      <div>Last scan: {formatTime(lastResult.timestamp)}</div>
      <div>
        {lastResult.contradictoryCount} potential contradiction(s) found
        — <button className="underline" onClick={openReview}>review</button>
      </div>
    </div>
  )}
</section>
```

### 2.6 Review UI

Findings 应该出现在 **已有的 review queue**（`src/components/review/review-view.tsx`），不要新建独立 review panel。

**review-store 扩展**：加一个 `contradiction-suggestion` 的 review item 类型。点击时显示两个 claim 的内容 + LLM reason，用户可以：
- **Accept**：在两个 claim 各自的 page 上加 `contradicts: [other_claim_id]` 标注（通过 pre-write conflict gate 提交）
- **Reject**：标记为 rejected，下次 scan 跳过这个 pair
- **Defer**：保持 pending

### 2.7 成本预警

LLM 调用不便宜。UI 上必须显示：

```
~87 pairs × $0.01/call = ~$0.87 estimated cost
```

（具体成本按 current llm config 的模型估）——用户知道会花钱。

**硬上限**：`maxPairs` 默认 100，用户在 UI 上可调（5/50/100/500）。超过 500 禁用按钮，要求分批。

---

## 3. 任务清单

- [ ] ⏳ **T1** 新建 `src/lib/deep-contradiction-scan.ts`（核心逻辑）
- [ ] ⏳ **T2** 单测 `src/lib/deep-contradiction-scan.test.ts`
- [ ] ⏳ **T3** 扩展 `src/stores/review-store.ts` 支持 `contradiction-suggestion` 类型
- [ ] ⏳ **T4** 新建 `src/components/settings/sections/deep-contradiction-scan-block.tsx`
- [ ] ⏳ **T5** 挂在 Memory Ops 面板内（`maintenance-section.tsx`）
- [ ] ⏳ **T6** 扩展 `src/components/review/review-view.tsx` 显示 contradiction 类型 item
- [ ] ⏳ **T7** 接 Accept / Reject / Defer 按钮逻辑；Accept 走 pre-write conflict gate
- [ ] ⏳ **T8** 审计：所有 scan 开始 / 完成 / accept / reject 事件写入 `audit.jsonl`
- [ ] ⏳ **T9** 成本估算 UI（显示 "~N pairs" 和 "~$X estimated"）
- [ ] ⏳ **T10** 手测：
  - 构造一个 page 含两个矛盾 claim，跑 scan，review 队列出现建议
  - Accept 后两个 claim 页 frontmatter 的 `contradicts` 数组更新
  - Reject 后下次 scan 不重复该 pair
- [ ] ⏳ **T11** `npm run typecheck` + `npm run test:mocks` + 跑 `test:llm`（需要 `.env.test.local` 才跑 real-llm 测试）

依赖：T1 → T2, T3, T4；T3 → T6；T4 → T5；T6 → T7；T7 → T8；T1 → T9；T5+T6+T7 → T10

---

## 4. 验收标准

### 功能
- [ ] Memory Ops 面板有 "Deep Contradiction Scan" block
- [ ] 点 "Run scan" 开始扫描，进度实时更新
- [ ] 扫描完成后显示统计（total / contradictory / consistent / orthogonal / uncertain）
- [ ] `contradictory` findings 写入 `.llm-wiki/contradiction-suggestions.jsonl`
- [ ] Review queue 显示这些 findings，可 Accept / Reject / Defer
- [ ] Accept 走 pre-write conflict gate 更新 `contradicts` 字段
- [ ] **Markdown 没有被 scan 本身修改过**（只有用户 accept 后才改）

### 质量
- [ ] LLM 返回的无效 JSON / 未知 verdict 正确降级为 `uncertain`
- [ ] maxPairs 硬上限生效，超过时按钮禁用
- [ ] 审计事件：scan 开始 / 结束 / per-finding accept/reject 都有记录
- [ ] 成本估算合理（误差 ±30% 可接受）

### 边界
- [ ] 空 claim 库跑 scan，返回 totalPairs=0，无崩
- [ ] LLM 调用失败（网络 / 授权），scan 不 crash，failed pair 归类为 `uncertain`
- [ ] 用户在 scan 中途取消，已产出的 findings 保留
- [ ] `npm run typecheck` + `npm run test:mocks` 全绿

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|-----|-----|-----|------|
| LLM 误判率高（假阳性） | 高 | 中 | 4 分类带 uncertain 逃生通道；只做 "same-page" v1 scope；用户必须审核 |
| LLM 调用成本高 | 高 | 中 | maxPairs 上限；UI 预估显示；只在 user 手动点才跑 |
| 不同 LLM provider prompt 效果差异大 | 中 | 中 | prompt 只要求 strict JSON；加测试用不同 provider 跑一遍小样本 |
| 用户 Accept 后 pre-write conflict gate 自己阻挡 | 低 | 中 | Accept 路径走确定性更新（直接改 frontmatter 字段），不触发二次冲突 |
| `.llm-wiki/contradiction-suggestions.jsonl` 文件增长无边界 | 低 | 低 | 文件只存 `contradictory` verdict，accept/reject 后 review-store 管生命周期 |
| 违反 gnusupport 立场（LLM 自动写入） | 极低 | 高 | scan **绝不**自动改 Markdown，只建议；严格 code review 守住这条线 |

### 关于立场合规性

本 fix 的核心设计是 **LLM 做建议，人类做决定**：

| 环节 | 谁做 |
|-----|-----|
| scan 触发 | 人（点按钮） |
| claim pair 生成 | 确定性规则（same-page） |
| 语义判断 | LLM |
| findings 持久化 | 系统（写 `.jsonl`） |
| 是否改 Markdown | **人（Review queue）** |
| 实际写入 | pre-write conflict gate |

**和 gnusupport 立场完全兼容**：LLM 不被授权改 Markdown，它只是更聪明的 "grep"。

---

## 6. 备注块

### 🐛 遇到的问题
_（开发时填）_

### 🔧 最终实现逻辑
_（开发时填）_

### 🎯 关键决策
_（prompt tuning / maxPairs 默认值 / 是否支持 same-entity scope 作为 v1.1 等）_

---

*关联文档：[gap-analysis.md](./gap-analysis.md)、[gap-analysis-detailed.md § ③](./gap-analysis-detailed.md#③-contradiction-detection--元数据驱动-vs-语义理解)*

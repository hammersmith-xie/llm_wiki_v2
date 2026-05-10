# Fix 02 — README Design Philosophy

> **优先级**：P0  
> **预计工作量**：30-60 分钟  
> **修复的差距**：[gap-analysis-detailed.md § 三](./gap-analysis-detailed.md#三评论区之争这个实现站在哪一派)

---

## 1. 背景与目标

### 问题

README 引用了 Karpathy 和 Rohit 的 gist，但没有告诉用户这个实现的边界：它不是远程 memory server，也不是全自动写 wiki 的 agent；它是 Markdown-first、human-gated、local-first 的 LLM wiki。

用户按 Rohit 原派心智来用时，会期待 memory 自己持续变“活”。实际实现更克制：Markdown 是 source of truth，自动化主要产生本地派生索引、建议、审计和维护提醒，写入仍要经过用户或 pre-write gate。

### 目标

在 `README.md` 和 `README_CN.md` 开头同步加一段短设计哲学，明确声明：

- Markdown-first：`wiki/` 是 source of truth，Git 可追溯。
- Human-gated writes：LLM 不静默改 Markdown。
- Local app daemon：app 运行期间允许本地维护循环，默认每 15 分钟轻量 due check。
- No remote memory server：不做远程后端、多用户 ACL、mesh sync。
- Explicit over auto-magic：自动化输出建议、提醒和可审核变更，而不是神秘后台改写。

### 非目标

- 不展开重复 Features 里已有的功能列表。
- 不承诺 OS 级常驻 daemon、LaunchAgent、登录项或 app 退出后的后台运行。
- 不把 README 写成完整技术设计文档；详细实现仍放本目录和 `docs/llm-wiki-v2-rohit-local-first/`。

---

## 2. 技术方案

### 位置

`README.md` 和 `README_CN.md`：

- 放在 Features 之前或 Features 之后、What is this 之前均可。
- 如果 README 当前没有 What is this，则放在开头简介之后第一个主要章节之前。
- 英文和中文必须同步，避免中文用户读到旧的 “no daemon” 口径。

### 英文建议内容

```markdown
## Design philosophy

**Markdown-first, human-gated, local-first.** This is an opinionated LLM wiki:
the files in `wiki/` remain the source of truth, and `.llm-wiki/` stores
derived local state such as indexes, audit logs, maintenance state, and review
suggestions.

- **Markdown is the source of truth.** The app can rebuild graphs, indexes, and
  derived records from local files. Your wiki stays readable without the app,
  diffable in Git, and portable to tools like Obsidian.

- **Humans approve risky writes.** Generated content goes through conflict
  checks and review surfaces. The app may suggest updates, supersessions, and
  maintenance actions, but it does not silently rewrite Markdown behind your
  back.

- **A local app daemon keeps maintenance visible.** While the app process is
  running, a lightweight local maintenance loop checks due state every 15
  minutes by default. It can remind you, and when policy allows it can schedule
  deterministic patrol. It stops when the app fully quits.

- **No remote memory server or mesh sync.** This phase deliberately excludes a
  hosted backend, auth system, multi-user ACL, and cross-device mesh sync.

- **Explicit beats auto-magic.** Confidence, contradictions, and crystallization
  are designed to be inspectable and reviewable rather than invisible
  background mutations.
```

### 中文建议内容

```markdown
## 设计哲学

**Markdown-first、human-gated、local-first。** 这是一个有明确取舍的 LLM
wiki：`wiki/` 里的 Markdown 始终是事实源，`.llm-wiki/` 保存本地派生索引、审计、
维护状态和 review 建议。

- **Markdown 是事实源。** 图谱、索引和派生记录都可以从本地文件重建；wiki 离开 app
  也能读、能进 Git diff，也能被 Obsidian 这类工具消费。

- **高风险写入需要人确认。** LLM 可以生成内容、提出 supersession、更新和维护建议；
  但不会在你背后静默改 Markdown。

- **app 内本地 daemon 让维护可见。** 只要 app 进程仍在运行，本地维护循环默认每 15
  分钟做一次轻量 due check；它可以提醒你，也可以在 policy 允许时调度确定性 patrol。
  app 完全退出后它就停止。

- **不做远程 memory server 或 mesh sync。** 本阶段明确不引入远程后端、登录鉴权、多用户
  ACL 或跨设备协作同步。

- **显式优于魔法。** Confidence、contradiction 和 crystallization 都应该可检查、可审阅，
  而不是隐形后台突变。
```

### 为什么这样写

- “local app daemon” 是当前用户明确要求，不再写成“完全禁止后台维护循环”的旧口径。
- 同时要明确它不是 OS 级常驻服务，避免误解为 app 退出后仍运行。
- README / README_CN 同步是本 fix 的验收项，不再作为可选项。

---

## 3. 任务清单

- [ ] ⏳ **T1** 在 `README.md` 增加 `## Design philosophy` 段落。
- [ ] ⏳ **T2** 在 `README_CN.md` 增加对应 `## 设计哲学` 段落。
- [ ] ⏳ **T3** 通读 README 开头，确认 Features、philosophy、credits / what-is-this 的顺序自然。
- [ ] ⏳ **T4** 全文 grep，确保 README 中没有残留“完全禁止后台维护循环”的旧口径。

依赖：T1 → T3；T2 → T3；T3 → T4

---

## 4. 验收标准

- [ ] README 明确 local-first、Markdown source of truth、human-gated writes。
- [ ] README_CN 同步表达，不落后英文版。
- [ ] 文档明确 daemon 是 app 运行期维护循环，不是远程服务或 app 退出后的 OS 服务。
- [ ] 没有重复堆砌已有 Memory Ops 详细功能列表。
- [ ] 不改任何代码；无需跑代码测试。

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|-----|-----|-----|------|
| 用户把 daemon 理解成 OS 常驻 | 中 | 中 | 明确“app 完全退出后停止” |
| README 变啰嗦 | 中 | 低 | 控制在 5 个 bullet 内，不写实现细节 |
| 中英文不同步 | 中 | 中 | README_CN 同步作为必做验收 |
| 未来实现改变边界 | 低 | 中 | 后续每次 daemon / sync 边界变化都同步 README |

---

## 6. 备注块

### 🐛 遇到的问题
_（写完 README 后填）_

### 🔧 最终实现逻辑
_（N/A，纯文档改动）_

### 🎯 关键决策
_（如果措辞有调整，在这里记录理由）_

---

*关联文档：[gap-analysis.md](./gap-analysis.md)、[gap-analysis-detailed.md § 三](./gap-analysis-detailed.md#三评论区之争这个实现站在哪一派)*

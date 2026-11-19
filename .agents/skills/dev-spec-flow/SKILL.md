---
name: dev-spec-flow
description: Spec-driven full-stack development workflow. Activate whenever the user describes a feature, system, app, page, API, or any greenfield/expansion development requirement — vague or detailed, small or huge in scope. Triggers on phrases like "帮我做/实现/开发/搭建/添加 X 功能", "我想做一个...", "build/implement/add/create [feature]", "需要一个 X", or any time the user describes something to build. Guides through 4 phases — Research best practices → Detailed requirements doc + hierarchical task list with deps & emoji status → Per-task dev/self-review/commit/push loop → Multi-round final review (1/5/10+ rounds based on size). Critical for ensuring AI doesn't skip research, doesn't stop midway between tasks, and doesn't ship gaps. Use this even when the user does not explicitly say "spec-driven" or "documented workflow"; skip ONLY for trivial one-line tweaks (rename a variable, fix a typo, change a string).
---

# dev-spec-flow — 规范驱动的全栈开发工作流

把用户那种粗犷、发散的需求描述，变成一份扎实的需求文档 + 任务列表，再按任务循环开发、审核、提交，最后多轮回顾把缺漏补齐。**目标是少返工、少遗漏、少中途停顿**。

## 何时触发

只要用户在描述一个要构建的东西就触发，无论描述有多模糊：

- "帮我做个聊天应用 / 实现一下文件上传 / 开发个后台管理 / 搭建一个 blog"
- "我想做一个 X / 需要一个 Y / 添加 Z 功能"
- "build / implement / add / create [feature]"
- 任何看起来像新功能、新模块、新系统的请求

**不要触发的场景**：仅一两行的琐碎改动（改个变量名、修个 typo、调一个字符串），开销不划算。

## 4 阶段总览

```
Phase 0  体量评估    → 让用户确认走 1/5/10+ 轮审核
Phase 1  调研        → context7 + WebSearch + 已有 skills + 阅读代码
Phase 2  写文档       → docs/<feature>/requirements.md + tasks.md
Phase 3  开发循环     → 每个任务: 开发 → 自检 → 写备注 → 改状态 → commit+push → 下一个
Phase 4  最终审核     → 小 1 轮 / 中 5 轮 / 超大 10+ 轮
```

每个阶段都需要在进入下一个阶段之前与用户确认（开发循环和最终审核内部不停）。

## Phase 0 — 体量评估

在做任何事之前，先粗估一下规模并报给用户：

- **预估任务数**（如 "约 8 个任务"）
- **预估工时**（如 "约 2 个工作日"）
- **预估影响文件数**（如 "约 15 个文件"）
- **量级判定**: 小 / 中 / 超大

| 量级 | 任务数 | 范围 | 最终审核轮数 |
|------|--------|------|--------------|
| 小   | ≤ 5    | 单模块、< 1 天 | 1 轮 |
| 中   | 5-20   | 跨模块 | 5 轮 |
| 超大 | > 20   | 多领域 / 新系统 | 10+ 轮 |

向用户问一句：「我估这是 X 量级 (任务约 N 个 / 工时约 H / 文件约 F)，确认走 R 轮审核吗？」拿到确认再继续。

## Phase 1 — 调研

**目标**：基于业界最新最佳实践给出可行方案，不靠脑子里可能过时的训练知识。

调研工具优先级：
1. **context7 MCP** — 拉库 / 框架 / SDK / CLI 的最新文档（`mcp__plugin_context7_context7__resolve-library-id` → `query-docs`）
2. **已加载的 skills** — 比如做 UI 时优先用 `frontend-design`、做 Anthropic SDK 用 `claude-api`、做 Figma 集成用 `figma-implement-design` 等
3. **WebSearch / WebFetch** — 找业界最新模式、相似优秀项目、设计参考
4. **阅读现有代码** — 项目里已有的约定、模式、依赖

完整调研策略见 [`references/research.md`](references/research.md)。

调研产出一份**技术决策摘要**给用户看：

- 技术栈选型 + 理由
- 关键架构模式
- 主要风险 + 缓解策略
- 留给用户决策的开放问题

让用户确认后才进 Phase 2。

## Phase 2 — 写文档

把决策落到磁盘上。用户的每个项目都需要在 `docs/` 下建：

```
docs/
└── <feature-name>/
    ├── requirements.md   ← 复制自 templates/requirements.md
    └── tasks.md          ← 复制自 templates/tasks.md
```

小项目可以 `docs/requirements-<feature>.md` 平铺，大项目按子系统分子目录。

### 2.1 需求文档 (`requirements.md`)

模板见 [`templates/requirements.md`](templates/requirements.md)。要写到「光看这份文档就能开始实现」的程度。必含：

- 背景 / 动机
- 目标（范围内 + 范围外都要写）
- 用户场景 / 用户故事
- 功能需求（每条要可验收）
- 非功能需求（性能 / 安全 / 可访问性 / 可观测性）
- 技术栈 + 依赖（含具体版本号）
- 架构概览（图 + 文字）
- 开放风险 / 开放问题

### 2.2 任务列表 (`tasks.md`)

模板见 [`templates/tasks.md`](templates/tasks.md)。**这份文档是开发期的指挥棒**，必须完整：

- **分层级**：里程碑 → 任务 → 子任务
- **依赖关系**：每个任务标注 「依赖什么 / 阻塞什么」
- **依赖图**：用 mermaid 画出里程碑级别的依赖图
- **状态 emoji**（每行都要有）：
  - ⏳ 待开始
  - 🚧 进行中
  - ✅ 已完成
  - ⚠️ 阻塞中
  - 🔍 待审核
- **备注块**：每个任务下要有可填写区，开发期由 AI 填入：
  - 🐛 遇到的问题
  - 🔧 最终实现逻辑
  - 🎯 关键决策

两份文档写完后，**完整带用户过一遍**，确认无误才进 Phase 3。

## Phase 3 — 开发循环

完整开发规则见 [`references/dev-rules.md`](references/dev-rules.md)。**9 条铁律**摘要：

1. **严守开发规范** — 项目已有的 lint / format / 命名 / 文件布局，先读 `CONTRIBUTING.md`、`CLAUDE.md`、`AGENTS.md`、`.editorconfig`。
2. **类型安全是底线** — 脚本语言也要类型化。TS over JS；Python 加 hint 跑 pyright/mypy；Ruby/PHP 能加就加。`any` / `Any` 是污点。
3. **依赖锁最新固定版本** — npm/pip/gem 等都用 `=` 锁死最新稳定版（用 context7 或 registry 查）；**Rust 例外** — cargo 习惯锁大版本号 `serde = "1"` 而不是 `1.0.215`。
4. **注释跟项目主语言走** — 看现有注释多数是什么语言就用什么；项目里没注释就默认中文。注释解释 **为什么**，不复读 **是什么**。
5. **超长文件里程碑后拆分** — 每完成一个里程碑，扫一遍 > 400 行的源码文件，按职责拆模块。**豁免**：DB migration、原始 SQL、日志输出、生成式文档。
6. **文档实时更新** — 实现偏离 `requirements.md` 或有新决策时，**立即** 改文档，别攒到最后。
7. **UI 必先调研设计** — 见 [`references/ui-design.md`](references/ui-design.md)。先看相似优秀项目，确定方案再写。
8. **每任务自检 + commit + push** — 见下方循环。
9. **不要中途停下来等指令** — 任务列表已经过用户确认，按列表走完。仅在真正阻塞时才停（见下文）。

### 单任务循环

```
对每个任务 T：
  1. tasks.md 里把 T 状态改成 🚧
  2. 实现 T，遵守 9 条铁律
  3. 自检（见 references/code-review.md）
     - 功能是否完整？
     - 逻辑漏洞 / 边界情况？
     - 是否引入 bug？
     - 类型是否安全？
     - 注释是否充足？
  4. 写 T 的备注块（问题 / 实现 / 决策）
  5. tasks.md 里把 T 状态改成 ✅
  6. commit + push（见 references/git-flow.md）
  7. 立刻继续下一个任务，不要停下来等用户指令
```

**例外停下条件**（且仅这些情况停）：
- 需求里有真正模糊的地方需要用户拍板
- 涉及外部决策（如 "用 Stripe 还是 Paddle？"）
- 需要用户授权的破坏性操作
- 测试 / 编译失败你确实修不动

用户已经明说："AI 经常自己在完成一个任务后停下来，需要督促 AI 继续开发"。所以**默认不停**。

## Phase 4 — 最终审核

所有任务 ✅ 后，按量级跑多轮审核。详见 [`references/final-review.md`](references/final-review.md)。

| 量级 | 轮数 | 每轮重点 |
|------|------|----------|
| 小   | 1    | 综合一遍，对照原始需求 + 任务列表，把缺漏补齐 |
| 中   | 5    | 每轮一个视角：功能 / 类型安全 / 性能 / 安全 / UX & 可访问性 |
| 超大 | 10+  | 上述 5 轮 + 跨模块集成 / 回归扫 / i18n & a11y 审计 / 文档对齐 / 性能压测 / 安全扫 / 等等 |

每轮产出一份报告：`docs/<feature>/review-round-<N>.md`（模板见 [`templates/review-report.md`](templates/review-report.md)），列出发现 + 修复，每轮单独 commit。

## 结构索引

```
dev-spec-flow/
├── SKILL.md                       ← 你正在看
├── AGENTS.md                      ← Codex 的对应入口
├── README.md                      ← 安装与使用说明
├── references/
│   ├── dev-rules.md               ← 9 条铁律展开 + 例子
│   ├── code-review.md             ← 单任务自检清单
│   ├── git-flow.md                ← commit 信息约定 + push 流程
│   ├── final-review.md            ← 各轮审核 playbook
│   ├── research.md                ← 调研策略与工具优先级
│   └── ui-design.md               ← UI 设计前置调研流程
└── templates/
    ├── requirements.md            ← 需求文档模板
    ├── tasks.md                   ← 任务列表模板
    └── review-report.md           ← 审核报告模板
```

## 一句话哲学

需求来自人类，常常是模糊的；让 AI 把模糊变成扎实的需求文档 + 可执行的任务列表，然后按列表一口气走到底，每步留下足够的痕迹（commit、备注、审核报告），最后用与体量匹配的多轮回顾把缺漏补完。

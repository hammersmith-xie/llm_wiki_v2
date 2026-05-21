# Git 流程：每任务 commit + push

每个任务做完都 commit + push 一次，**单任务粒度**。这样：

- 出问题随时可以回滚到某个任务
- 远端有同步，机器挂了不丢工作
- 用户随时可以 review 部分进度

---

## 何时 commit + push

```
任务 T 自检完毕 → 备注块写完 → tasks.md 状态改 ✅ → commit → push → 进下一个任务
```

不要：

- ❌ 攒一堆任务一起 commit
- ❌ 自检还没过就 commit
- ❌ commit 了不 push（机器挂了就白干）

---

## Commit 信息约定

**默认走 Conventional Commits**（除非项目已有别的约定，扫一遍 `git log` 跟着学）：

```
<type>(<scope>): <subject>

<body, 可选>

<footer, 可选>
```

### type

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | bug 修复 |
| `refactor` | 重构（不改行为） |
| `perf` | 性能优化 |
| `style` | 代码风格（缩进 / 分号 / lint 自动修） |
| `docs` | 文档 |
| `test` | 测试 |
| `chore` | 构建 / 工具链 / 杂项 |
| `ci` | CI/CD 配置 |

### scope

可选。常见的：模块名、文件夹名、子系统名。如 `feat(auth):`、`fix(payment-service):`。

### subject

- 祈使句、小写起头、不加句号
- ≤ 72 字符
- 中文项目就用中文：`feat(auth): 实现邮箱+密码登录` 也是 OK 的

### body（任务关联）

任务列表驱动开发的好习惯：commit body 里链接 tasks.md 中的任务编号。

```
feat(auth): 实现邮箱+密码登录

完成 docs/user-system/tasks.md 中的 Task 2.1。

- 添加 /api/login endpoint
- 用 argon2 哈希密码
- 加上 rate limit (5 次/分钟)
```

---

## 推送规则

```bash
git push origin <branch>
```

**首次推送某分支**：

```bash
git push -u origin <branch>
```

**关于分支策略**：跟项目的 git 流程走（GitHub flow / git-flow / trunk-based）。如果项目没明示，默认：

- 工作在 feature 分支：`feat/<feature-name>` 或 `task/<task-id>`
- 不要直接推到 `main` / `master` / `dev` 等共享分支
- 一个里程碑完成后开 PR

---

## 不能做的事

绝不在没有用户明确授权时做：

- `git push --force` / `git push --force-with-lease`
- `git reset --hard <某个公共分支>`
- `git rebase -i` / `git commit --amend` 已推过的 commit
- 删远程分支 (`git push origin --delete`)
- 跳 hook (`--no-verify`)：commit / push hook 报错先去修，不要绕

如果 hook 失败：

1. 看错误信息，理解为什么挂
2. 修复根因（lint 报错就修代码、test 挂就改实现）
3. **不要 amend 那个失败的 commit**，因为 hook 失败时 commit 实际上没有发生；修好后重新 stage + commit

---

## 文档与代码一起 commit

每个任务结束时，`tasks.md` 已经被改过（状态、备注），可能 `requirements.md` 也被改过。这些**和代码改动一起 commit**：

```bash
git add src/auth.ts docs/user-system/tasks.md
git commit -m "feat(auth): 实现登录"
```

不要把文档改动单独 commit 成 `docs:`，因为这部分文档变更其实是这个任务的产出。

**例外**：纯文档 PR（修文案、补图、纠错），那种走 `docs:` 没问题。

---

## 一个完整 commit 示例

```bash
git add -A   # 但是要警惕：先 git status 确认没有 secret 文件
git status   # 确认 staging 干净
git commit -m "$(cat <<'EOF'
feat(payment): 接入 Stripe Checkout

完成 docs/payment/tasks.md Task 1.3。

实现要点：
- 用 Stripe Checkout Session（hosted page，避免自己处理 PCI）
- webhook 用 raw body + 签名校验防伪造
- 失败重试由 Stripe 自己处理，我们幂等接收

依赖：
- stripe@17.4.0 (锁死版本)

测试：
- 跑了 sandbox 全流程
- webhook 重放测试通过
EOF
)"
git push origin feat/stripe-checkout
```

注意：**只有用户明确要求或长时间在自己分支独立工作时才 push**。如果是协作仓库 / main 分支，按团队约定走（一般会走 PR）。

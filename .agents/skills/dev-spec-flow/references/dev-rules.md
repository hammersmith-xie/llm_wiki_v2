# 开发期 9 条铁律 (展开)

这是 SKILL.md / AGENTS.md 中 Phase 3 9 条铁律的扩展说明，配上场景和反例。

---

## 1. 严守开发规范

**做什么**：进入项目第一件事，扫一遍这些文件，把里面的约定吃透：

- `CONTRIBUTING.md`
- `CLAUDE.md`、`AGENTS.md`、`.cursorrules`、`.windsurf` 等 agent 配置
- `.editorconfig`、`.prettierrc`、`.eslintrc*`、`.ruff.toml`、`pyproject.toml`、`Cargo.toml`
- `package.json` 中的 `scripts`、`engines`、`packageManager` 字段
- 任何 `STYLE.md` / `naming.md` / `architecture.md`

**为什么**：项目里已有约定就是 PR 评审的标准。AI 写出来的代码如果跟项目风格脱节，第一轮 review 就被打回。

**反例**：项目里全是 4 空格缩进，AI 写了一个 2 空格缩进的新文件。

---

## 2. 类型安全是底线

**做什么**：

- **JavaScript / TypeScript**：用 TypeScript，开 `strict`。如果项目纯 JS，至少加 JSDoc + `@ts-check`。
- **Python**：所有公开函数加 type hints；项目级别开 `pyright` 或 `mypy`。
- **Ruby**：能加 RBS / Sorbet 就加。
- **PHP**：开 `declare(strict_types=1);`，参数和返回值都标类型。
- **Go / Rust / Java / Kotlin / Swift / C# / TypeScript**：本身静态语言，不要绕过类型系统（不要乱用 `interface{}`、`unknown`、`Object`、`any`）。

**为什么**：90% 的运行时 bug 是类型不一致引起的。脚本语言不强制不代表可以省。

**反例**：

```ts
// ❌ 用 any 偷懒
function handle(payload: any) {
  return payload.user.name.toUpperCase();
}

// ✅ 明确建模
type Payload = { user: { name: string } };
function handle(payload: Payload) {
  return payload.user.name.toUpperCase();
}
```

---

## 3. 依赖锁最新固定版本

**做什么**：

| 包管理器 | 锁版本方式 | 例 |
|-----------|------------|-----|
| npm / pnpm / yarn | 精确版本号、不要 `^`/`~` | `"react": "19.0.0"` |
| pip / uv | `==` | `fastapi==0.115.5` |
| gem | `=` | `gem "rails", "= 7.2.2"` |
| go mod | `go.mod` 自己锁好 | `require example.com/x v1.2.3` |
| cargo (**例外**) | 大版本即可 | `serde = "1"` 而非 `serde = "1.0.215"` |

**怎么查最新版**：

- npm：`npm view <pkg> version`
- pip：`pip index versions <pkg>` 或 PyPI 网站
- gem：`gem search -r <name>`
- 用 context7 MCP 查包文档时通常会带最新版本
- WebFetch 包的官方页面

**为什么**：

- 锁死版本 = 重复构建可复现
- 拿最新稳定版 = 避免一上线就要补丁
- Rust 用大版本是因为 cargo 默认走 `Cargo.lock`，开发态保留语义化升级空间更符合社区习惯

**反例**：

```json
{
  "dependencies": {
    "react": "^17.0.2"  // ❌ 版本不固定 + 已经过时
  }
}
```

---

## 4. 注释跟项目主语言走

**做什么**：

1. 进项目先扫几个核心源文件的注释（`grep -r "^//\|^#\|^/\*"`），看占多数的语言。
2. 占多数的语言就是主语言。多数是中文写中文，多数是英文写英文。
3. 项目里基本没注释 → 默认中文。

**注释要写什么**：

- ✅ 为什么这样设计（决策理由）
- ✅ 隐含的约束（"上游保证 X 非空"）
- ✅ 反直觉的代码（"这里看起来该用 reduce，但因为 Y 用了 for"）
- ✅ TODO / FIXME 加上原因和上下文
- ❌ 重复变量名做的事（"// 把 user 设成 null" 看代码就知道）
- ❌ 翻译代码逻辑（"// 循环遍历 list"）

**反例**：

```ts
// ❌ 复读机注释
// 把 list 中每一项乘以 2
const doubled = list.map(x => x * 2);

// ✅ 解释为什么
// 库返回的是 cents，UI 要展示成 dollars，所以乘 100 倒数
const dollars = cents.map(c => c / 100);
```

---

## 5. 超长文件里程碑后拆分

**做什么**：

- 每完成一个里程碑（一组关联任务全部 ✅）后，扫一遍源码：
  ```
  find src -type f \( -name '*.ts' -o -name '*.py' -o -name '*.go' -o ... \) | xargs wc -l | sort -nr | head
  ```
- 任何 > 400 行的源码文件，分析它的内部结构：
  - 是不是在做多件事？按职责拆。
  - 是不是有可独立的纯函数？提到 utils。
  - 是不是有大块字面量 / 配置？提到独立 data 文件。
- 拆完后跑一遍测试和 lint 确保无回归。

**豁免**：

- DB migration（保持每个迁移一个文件，不要硬拆）
- 原始 SQL（按业务整体看更易读）
- 日志输出（就该平铺）
- 生成式文档 / 自动生成的代码 / 锁文件

**为什么**：长文件 PR 难审，重构风险高，新人理解慢。但是也不要**为了拆而拆** —— 强行拆出 50 个 30 行小文件反而更难追踪。400 行是一个经验值，不是硬阈值。

---

## 6. 文档实时更新

**做什么**：开发过程中只要碰到这些情况，**立刻** 回头改 `requirements.md` 或 `tasks.md`：

- 实现方式跟原计划不一样（用户拍板的或自己拍板的都算）
- 发现需求里漏了一条（现在加上而不是憋到最后）
- 任务比预想的复杂，需要拆成子任务
- 任务比预想的简单，可以合并 / 删除
- 出现新依赖（包、环境变量、外部服务）

文档 commit 跟代码 commit 可以放一起（"feat: X功能 + 同步需求文档"）。

**反例**：开发到一半发现需要新依赖一个 OAuth provider，但需求文档里完全没提；最后审核的时候用户才发现。

---

## 7. UI 必先调研设计

详见 `ui-design.md`。摘要：先调研（参考竞品、Dribbble、Mobbin、frontend-design skill），出一个简单方案给用户确认，再开写。

---

## 8. 每任务自检 + commit + push

详见 `code-review.md` 和 `git-flow.md`。摘要：每个任务做完，五项自检（功能完整 / 边界覆盖 / 无 bug / 类型安全 / 注释充足），然后 commit + push。

---

## 9. 不要中途停下来等指令

**做什么**：

- Phase 0、1、2 进入下一阶段前要用户确认。
- Phase 3 内部，**任务列表已经被用户确认过**，按列表一个接一个做下去，不要每完成一个任务就停下问 "继续吗？"。
- Phase 4 内部，多轮审核也是按预定轮数跑完，不停。

**只能停的四种情况**：

1. **真正的需求模糊**：需求文档里某条规定不清楚，怎么实现都行的那种，必须用户拍板。
2. **外部决策**：服务选型（"用 Stripe 还是 Paddle？"）、第三方资源（API key、OAuth client 等）。
3. **破坏性操作授权**：删数据库、 force push、覆盖用户文件等。
4. **真修不动**：测试一直挂、编译报错你尝试 3 次以上还是不行，把现状报给用户。

**反例**：完成一个 "添加登录页" 子任务后停下问 "要继续做注册页吗？"——任务列表里明明已经有注册页任务，按列表继续就行。

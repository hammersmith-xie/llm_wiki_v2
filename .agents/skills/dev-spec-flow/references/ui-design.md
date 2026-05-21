# UI 设计前置调研流程

铁律 7 的展开。**永远不要直接开写 UI**——先看竞品 / 参考，确定方案，再写。

UI 是用户最直接感受到的产物，AI 自己脑补的设计往往是 "AI 味"——居中卡片、灰底蓝按钮、过度圆角、过度梯度——既没特色也不专业。

---

## 标准流程

```
1. 工具盘点 (有什么 skill / MCP)
2. 参考调研 (找类似项目的优秀做法)
3. 草图方案 (粗略描述 / sketch)
4. 用户确认
5. 实现 (尽可能用 design system / 既有组件库)
```

---

## Step 1: 工具盘点

进 UI 阶段先看自己手上有什么：

| 工具 | 何时用 |
|------|--------|
| `frontend-design` skill | **首选** —— 写有设计感、不"AI 味"的前端 |
| `figma:figma-implement-design` skill | 用户给了 Figma URL，按 Figma 实现 |
| `figma:figma-generate-design` skill | 把代码现有页面同步到 Figma（反向） |
| `figma:figma-generate-library` skill | 项目要建 design system / 组件库 |
| Playwright MCP | 需要看竞品实际效果（截图 / 交互） |
| 项目里已有的组件库 | shadcn/ui、Material UI、Ant Design、Chakra... |

**优先用既有组件库**。设计系统是项目的资产，自己造轮子是债。

---

## Step 2: 参考调研

不参考直接写 = AI 味设计。参考路径：

### A. 直接竞品

如果用户的产品有明确竞品（如 "类似 Notion 的笔记"），打开竞品看：

- 主导航怎么排
- 信息密度
- 留白习惯
- 色彩 / 字体 / 间距规律
- 微交互（hover、loading、empty state）

可以用 Playwright MCP 实际访问竞品页面截图。

### B. 设计灵感库

| 库 | 适合 |
|----|------|
| [Mobbin](https://mobbin.com/) | 真实产品的截屏库，最好的 "现实参考" |
| [Dribbble](https://dribbble.com/) | 设计师作品，很多偏概念，但视觉灵感丰富 |
| [Page-Flows](https://pageflows.com/) | 整段 user flow 录屏 |
| [Land-book](https://land-book.com/) | landing page 灵感 |
| [Refero](https://refero.design/) | 按 UI 元素分类的截图 |

WebSearch 可以直接搜 "site:mobbin.com <feature>"。

### C. 知名公司设计语言

- iOS HIG / Material Design / Fluent UI 当作底线
- Stripe / Linear / Vercel / Notion 的产品作为审美锚点
- 用户产品偏的领域有自己的"经典"（如电商看 Shopify、社交看 Twitter）

### D. 框架自带的 Showcase

- Tailwind UI、Catalyst、Radix UI 的 demo
- shadcn/ui 的 example pages
- Vercel templates、Next.js examples

---

## Step 3: 草图方案

调研完，给用户一份**简短方案**。可以是文字 + ascii，也可以是 Figma 截图。模板：

```markdown
# UI 方案：<Feature Name>

## 整体风格
- 参考 [Linear 的设置页](url) 和 [Notion 的属性面板](url)
- 主色调跟项目既有的（已扫到 #...）
- 信息密度：偏高 / 中 / 低（说理由）

## 主要页面

### 1. 列表页
[ascii 草图或截图链接]

要点：
- 顶部 toolbar：搜索 + 过滤 + 新建按钮
- 表格 + 行内 hover 操作
- 空态用插图，参考 Linear 的处理方式

### 2. 详情页
[ascii 草图或截图链接]

要点：
- 左侧导航 (sticky)，右侧内容
- 顶部 breadcrumb + 操作按钮
- ...

## 组件复用

- 表格用 shadcn/ui 的 Data Table（已有）
- Modal 用项目内 Modal 组件（已有）
- 新增 EmptyState 组件（项目缺）

## 留给用户决策

- [ ] 操作按钮放右上角还是行尾？（影响表格密度）
- [ ] 删除走二次确认 modal 还是 toast 撤销？
```

---

## Step 4: 用户确认

把方案给用户看，等到一句明确的 "OK" 才进 Step 5。

---

## Step 5: 实现

实现期注意：

- **复用既有组件**优先于新写
- **使用项目的 design tokens**（颜色 / 间距 / 圆角变量），不要硬编码
- **Tailwind / CSS-in-JS / CSS Modules 选哪个**跟项目走，不要另立门户
- **响应式**：mobile / tablet / desktop 三档至少都看一眼
- **暗色模式**：项目支持就一起做，不要等到回头补
- **a11y**：键盘 / screen reader / 对比度，不是后置选项

详见 `code-review.md` 的 UI 部分检查清单。

---

## 反模式

❌ **不参考直接画**：典型 AI 味 —— 居中卡片、过度圆角、莫名渐变。

❌ **过度参考**：每个像素都抄一个站点，没有自己的风格 / 项目一致性。**调研是吸收原则，不是复制粘贴**。

❌ **不用既有组件库**：项目里有 shadcn/ui，AI 又自己写了一个 Button 组件。

❌ **忽略响应式 / 暗色 / a11y**：上线前才发现移动端打不开。

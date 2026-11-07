# 实施状态

> 每完成一个大步更新一次。计划与技术决策见 `docs/IMPLEMENTATION_PLAN.md`。

## 当前进度

| 阶段 | 大步 | 状态 |
|---|---|---|
| Phase 0 | 0.1 骨架与界面 | ✅ 完成（2026-11-07） |
| Phase 0 | 0.2 数据与登录 | ⏳ 未开始（需要 Docker Desktop 运行） |
| Phase 0 | 0.3 部署与验收 | ⏳ 未开始 |
| Phase 1–5 | — | ⏳ 未开始 |

---

## 大步 0.1 — 骨架与界面（2026-11-07）

### 已完成

- **项目**：Next.js 16.4.5（App Router、Turbopack、Cache Components + Partial Prefetching）、React 19.3、TypeScript 5、Tailwind CSS 4；git 仓库已初始化（尚未提交）。
- **脚本**：`npm run lint` / `typecheck` / `test` / `build`，以及汇总的 `npm run check`。
- **文档**：`IMPLEMENTATION_PLAN.md`（含技术决策）、`CONTENT_AUTHORING_GUIDE.md`（骨架）、`AI_PROMPTS.md`（骨架）、本文件。
- **设计令牌**（`src/app/globals.css`）：完整的浅色与深色两套；强调色区分“填充色”和可作文字的 `*-ink` 色；圆角、阴影、字体栈（Geist + 中文系统字体、Georgia 阅读字体、IPA 字体栈）；全局可见焦点样式；`prefers-reduced-motion`。
- **基础组件**（`src/components/ui`）：Button（含 `asChild`）、Card、Badge、SegmentedControl（Radix ToggleGroup）、ProgressRing、Skeleton / LoadingSkeleton、EmptyState、ErrorState；学习组件 LevelBadge。
- **应用外壳**：桌面端可折叠侧栏（≥1024px，240px ↔ 76px），手机端顶部栏 + 5 项底部导航；跳到主要内容链接；主题与侧栏状态在首帧绘制前由内联脚本应用，不闪烁；读取当前路径的导航部分包在 `<Suspense>` 中，以后加入动态路由不会破坏预渲染。
- **页面**：Today、Learn / Practice 入口页、14 个功能页骨架（诚实的“建设中”状态，写明上线阶段和将提供的能力）、Settings（外观主题切换可用，其余分区标明阶段）、404 页、错误边界、仅开发模式可见的 `/design` 组件一览。
- **真实逻辑**：学习时长模板（15 / 25 / 40 / 60 分钟的组成，对应规格 §2.9 与四条学习主线），Today 页可切换查看；导航 / 功能注册表；主题与侧栏偏好。

### 测试结果

| 检查 | 结果 |
|---|---|
| `npm run lint` | ✅ 通过，0 警告 |
| `npm run typecheck` | ✅ 通过 |
| `npm run test` | ✅ 4 个文件，31 个测试全部通过 |
| `npm run build` | ✅ 通过，22 个路由全部静态预渲染 |
| 生产模式（`next start`） | ✅ `/today` 200；`/design` 404；`/` 307 → `/today`；未知路径 404；HTML 内含主题预加载脚本 |

测试覆盖：主题解析与内联脚本（在 jsdom 中实际执行，包括存储不可用时不报错）、导航匹配、“每个导航链接都有真实页面文件”、移动导航 4–5 项、时长模板总和与组成、SegmentedControl 不可清空且支持“未知”状态、底部导航当前项标记。

### 浏览器检查（开发服务器）

- 桌面 1024×768 与手机 375×812 两种尺寸。
- 全部 19 个页面在 375px 宽度下无横向溢出。
- 深色模式切换、侧栏折叠，刷新后都能保持且无闪烁。
- 手机端子页面（如 `/vocabulary`）正确高亮 Learn 标签。
- 控制台无错误、无 hydration 警告。

### 与规格建议值的差异

- `--muted` 由建议的 `#73788C` 调整为 `#676C80`：原值在白底上对比度约 4.4:1，低于 WCAG AA 正文要求的 4.5:1。
- 强调色（mint / coral / yellow / blue）作为文字时对比度不足，因此为每个强调色增加了 `*-soft` 背景色和 `*-ink` 文字色。
- 深色模式下主按钮使用深色文字（浅色文字在 `#8B82F0` 上只有约 3.2:1）。

### 已知限制

- **还没有登录**：所有页面目前无需认证即可访问（0.2 完成）。
- Today 的时长选择只保存在页面状态中，刷新会恢复默认 25 分钟；Phase 1 存入 `study_preferences`。
- 主题偏好目前只保存在浏览器 localStorage；登录后同步到账户。
- 除 Settings 外观外，其余功能页都是占位，按计划阶段实现。
- 开发模式下 Next.js 的 dev indicator 移到了左上角，会遮住 logo（仅开发模式）。
- `npm audit` 有 8 个 moderate 级问题，均来自开发依赖（见 PLAN §5）。

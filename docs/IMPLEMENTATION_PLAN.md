# LinguaBloom 实施计划与技术决策

> 依据：`LinguaBloom_Claude_开发规格.md` v1.0（规格基准日期 2026-11-07）
> 本文件随实施推进更新；每个阶段的真实完成情况见 `docs/IMPLEMENTATION_STATUS.md`。

## 1. 推进方式

- 每个 Phase 拆成 2–3 个**大步**，每个大步结束都必须可运行、可验证（lint / typecheck / test / build + 浏览器检查），再进入下一步。
- **界面优先**：先建设计系统和页面骨架，再接数据库与登录。页面骨架必须“诚实”：未实现的功能显示明确的空状态与所属阶段，不放假数据、不放点了没反应的控件。
- 只把真实可学习的内容标为 `published`；A2–C2 首版只做蓝图（`planned` / `draft`）。

## 2. 阶段与大步

### Phase 0 — 项目基础

| 大步 | 内容 | 验收 |
|---|---|---|
| 0.1 骨架与界面 | git、计划/规范文档、Next.js + TS + Tailwind、lint/typecheck/test 脚本、设计令牌（亮/暗）、基础组件、AppShell（桌面侧栏 + 移动底部导航）、全部主路由骨架 | 四项脚本通过；桌面与手机尺寸浏览器检查无横向溢出、导航可用、主题切换可用 |
| 0.2 数据与登录 | Docker Compose 中的 PostgreSQL、Drizzle schema + migrations + seed 机制、`/setup` 首次创建 owner、`/login`、会话、受保护路由、`/api/health` | 创建 owner → 登录 → 刷新状态保留 → 注销后受保护页不可访问；数据写入 PostgreSQL |
| 0.3 部署与验收 | 多阶段 Dockerfile、compose 中的 app 服务、`.env.example`、README、Phase 0 完整验收 | 新机器按 README 用 Docker 启动并走通完整流程 |

### Phase 1 — 学习核心 MVP（大步在进入时细化）

学习者档案、onboarding、基础诊断、Today 今日计划、CEFR 路线图、Pre-A1 课程（≥3 个完整 Unit）、A1 首批课程（≥3 个完整 Unit）、Lesson Player、Vocabulary Lab、FSRS 复习、基础进度统计。

验收：完成一节课并保存记录；从课程加入单词并建卡；复习后状态更新；重新登录数据仍在。

### Phase 2 — 输入与语言知识

Grammar Studio、Reading Room、Listening Studio、transcript、文本/字幕/词表导入、Error Notebook、阅读/听力词汇采集。

### Phase 3 — AI Tutor 与语音

Provider Adapter（首个 OpenAI）、Tutor 文本模式、结构化内容生成、写作反馈、WebRTC 语音会话、STT → LLM → TTS 降级、Speaking Lab、AI 成本与用量记录。

### Phase 4 — 评估与 PTE 专区

技能评估历史、can-do 证据、PTE 数据模型（按 `exam_version` 版本化）、原创练习、计时模式、练习报告。

### Phase 5 — A2–C2 内容与优化

A2/B1 补全、B2–C2 骨架与内容、推荐改进、弱网体验、高级分析、备份恢复演练、移动端深度优化。

## 3. 技术决策记录

版本均于 2026-11-07 通过 npm registry 与随包官方文档（`node_modules/next/dist/docs/`）核对。

| # | 决策 | 理由 |
|---|---|---|
| D1 | **Next.js 16.4（App Router）+ React 19.3 + TypeScript 5** | 规格定案。TypeScript 7 已发布，但 Next 工具链默认配套 5.x，暂不升级。 |
| D2 | **启用 Cache Components + Partial Prefetching**（create-next-app 默认） | Next 16 推荐模型。约束：读取 cookies / headers / 数据库的组件必须放在 `<Suspense>` 内或使用 `use cache`；不能在根布局直接读 cookies。 |
| D3 | **Tailwind CSS 4**，通过 `@tailwindcss/turbopack` loader 接入 | 脚手架默认方式。设计令牌写成 CSS 变量，并在 `@theme inline` 中映射为 Tailwind 工具类。 |
| D4 | **UI 原语自建（shadcn 风格）+ `radix-ui` 按需使用** | 规格要求 shadcn/ui + Radix 按需取用并统一主题。先手写少量原语（Button、Card、Badge 等，使用 cva），变量命名兼容 shadcn（`--background`、`--primary` 等），以后可直接用 shadcn CLI 添加组件。 |
| D5 | **字体：`geist` npm 包（本地字体文件）+ 中文系统字体栈** | 不在构建时请求 Google Fonts，在受限网络环境下也能构建。阅读模式使用 Georgia 衬线栈。 |
| D6 | **主题：`data-theme` + `<head>` 内联脚本 + localStorage** | 按 Next 官方“preventing flash before hydration”指南，避免首屏闪烁且不破坏静态外壳。主题属于非敏感 UI 偏好，规格允许存 localStorage；登录后再同步到 `study_preferences.dark_mode`。支持 light / dark / system。 |
| D7 | **认证：Better Auth（邮箱 + 密码，数据库会话）** | 规格优先 Auth.js Credentials 或“同等成熟方案”。Auth.js 的 Credentials 模式只支持 JWT 会话，难以实现“注销全部会话”；Better Auth 原生支持数据库会话与会话撤销，并有 Drizzle 适配器。实施 0.2 前再次核对其官方文档。 |
| D8 | **PostgreSQL + Drizzle ORM / drizzle-kit migrations** | 规格定案。生产环境只运行 migrations，禁止 `drizzle-kit push`。 |
| D9 | **测试：Vitest 5 + Testing Library（单元/组件），Playwright（E2E，0.2 起引入）** | Vitest 不支持 async Server Component，此类组件用 E2E 覆盖（Next 官方说明）。 |
| D10 | **Node.js：`engines >= 24`**；本机开发为 Node 26 | 规格指定 Node 24 LTS；Node 26 已于 2026-10 进入 LTS。Docker 基础镜像在 0.3 中确定并写入此表。 |
| D11 | **包管理器：npm** | 规格中的命令均为 `npm run …`。 |
| D12 | **ESLint 9（脚手架锁定）** | `eslint-config-next` 16.4 使用 ESLint 9；ESLint 10 已发布，待 Next 配套插件跟进后再升级。 |
| D13 | **配色按 WCAG AA 微调**：`--muted` 用 `#676C80`；强调色增加 `*-soft` / `*-ink`；深色主按钮用深色文字 | 规格色值是“建议初始值”，原 `--muted` 在白底上约 4.4:1，不足 AA；强调色作为文字时对比度不足。 |
| D14 | **导航与功能注册表集中在 `src/lib/config/navigation.ts`** | 侧栏、底部导航、入口页和占位页共用一份数据；测试保证每个导航链接都有真实页面。这里只放应用结构，不放课程内容。 |
| D15 | **读取 URL 的导航组件放在 `<Suspense>` 中** | Cache Components 下，`usePathname` 在未预生成参数的动态路由（如 `/lesson/[lessonId]`）中会挂起；fallback 渲染无高亮的同一组链接。 |
| D16 | **只在浏览器存在的偏好，服务端渲染“未选中”而不是猜默认值** | 避免水合前短暂显示错误的选择（例如主题选择器）。 |
| D17 | **PostgreSQL 18**（`postgres:18-alpine`），驱动 **postgres.js** | 2026-11 时最新的官方镜像主版本；postgres.js 纯 JS、无原生依赖，Drizzle 原生支持。 |
| D18 | **Better Auth 定稿**：数据库会话、UUID 主键、snake_case 表；用自定义 hash 接入 Argon2id；关闭遥测 | 已核对 1.7.18 的源码与类型定义（D7 的落实）。`disableSignUp` 也会拦截服务端注册调用，所以 owner 通过内部 adapter 创建。 |
| D19 | **owner 唯一性用数据库保证**：`app_instance` 单行表 + `INSERT … ON CONFLICT … WHERE` 原子占用 | 不依赖“先查有没有用户”这种有竞态的判断；集成测试覆盖了 5 个并发请求的情况。 |
| D20 | **环境变量、数据库、认证实例都在首次使用时才创建**；只在请求时读数据库的组件先 `await connection()` | 让 `next build` 和 Docker 构建不需要运行时密钥，也不会在构建时连数据库。 |
| D21 | **认证类表单用 Server Action + `useActionState` + 共享 Zod schema** | 不依赖客户端 JS 也能提交，服务端校验是唯一可信来源。React Hook Form 留给 Phase 1 起更复杂的客户端表单（如 onboarding）。 |
| D22 | **项目改为 ESM**（`"type": "module"`）；`NODE_ENV` 不写进 `.env` | 脚本需要顶层 await 和 `import.meta`；`NODE_ENV` 由 Next / Docker 管理，写进 `.env` 会让测试进程把 development 传给 `next build` 导致构建失败。 |
| D23 | **测试分三层**：`test`（单元，无需数据库）、`test:integration`（测试库 `<库名>_test`）、`test:e2e`（Playwright，生产构建，端口 3200；Next 16 的 dev 输出在 `.next/dev`，与构建互不影响） | 测试库每次运行都会清空；名字不以 `_test` 结尾的库一律拒绝清空，防止误删开发数据。 |
| D24 | **修改密码成功后跳转到 `/settings?passwordChanged=1`**，而不是在原请求里返回成功 | Better Auth 会替换当前设备的会话 cookie；同一个请求里重新渲染仍会带着旧 cookie，被判定为未登录。 |

## 4. 目录约定

遵循规格 §7.2：

```text
src/
  app/            路由（(app) 为登录后应用区，(auth) 为登录/初始化区）
  components/     ui/（原语）、layout/（外壳与导航）、learning/、vocabulary/ …
  modules/        业务模块：domain / services / repositories / schemas / actions
  lib/            ai/、audio/、storage/、validation/、security/、config/ 与通用工具
  db/             schema/、migrations/、seed/
  hooks/、types/、test/
docs/             计划、状态、内容规范、AI Prompt 规范
```

业务规则不写进 UI 组件；课程与内容不写进 JSX，统一走数据库或版本化种子文件。

## 5. 已知事项

- `npm audit` 报告 8 个 moderate 级问题，均来自开发依赖（`@typescript-eslint` 内的 `minimatch`），不进入生产包；不使用 `npm audit fix --force`（会引入破坏性升级），随上游更新处理。

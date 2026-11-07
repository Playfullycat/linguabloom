# 实施状态

> 每完成一个大步更新一次。计划与技术决策见 `docs/IMPLEMENTATION_PLAN.md`。

## 当前进度

| 阶段 | 大步 | 状态 |
|---|---|---|
| Phase 0 | 0.1 骨架与界面 | ✅ 完成（2026-11-07） |
| Phase 0 | 0.2 数据与登录 | ✅ 完成（2026-11-07） |
| Phase 0 | 0.3 部署与验收 | ⏳ 未开始 |
| Phase 1–5 | — | ⏳ 未开始 |

---

## 大步 0.2 — 数据与登录（2026-11-07）

### 已完成

- **数据库**：`docker-compose.yml` 中的 PostgreSQL 18（`postgres:18-alpine`），带健康检查和命名卷 `pgdata`，端口只绑定 `127.0.0.1`；时区 UTC。
- **Drizzle**：schema（`src/db/schema`）→ `npm run db:generate` 生成 SQL migration（`src/db/migrations/0000_init.sql`）→ `npm run db:migrate` 执行。没有使用 `drizzle-kit push`。
- **表**：`users`、`sessions`、`accounts`、`verifications`（Better Auth 核心表，UUID 主键、snake_case 列）、`app_instance`（单行表，保证只有一个 owner）、`cefr_levels`。
- **Seed 机制**：`src/db/seed/` 下的版本化 JSON + Zod 校验 + 幂等 upsert，`npm run db:seed`。首个 seed 为 7 个 CEFR 等级（规格 §3.1）。
- **环境变量**：`src/lib/config/env.ts` 用 Zod 校验，首次使用时才解析，构建时不需要密钥；`.env.example` 列出全部变量并注明必填 / 可选。
- **认证（Better Auth 1.7）**：
  - 邮箱 + 密码，**公开注册关闭**；owner 只能通过 `/setup` 创建。
  - 密码使用 **Argon2id**（`@node-rs/argon2`，OWASP 基线参数：19 MiB、2 次迭代、并行度 1），至少 10 个字符。
  - 会话存数据库，cookie 为 HttpOnly + SameSite=Lax，HTTPS 部署时自动加 Secure；关闭 Better Auth 遥测。
  - 首次初始化先原子“占用” `app_instance`，并发请求只有一个能成功；中途失败会释放占用，中断超过 5 分钟的初始化可以重来。
  - `OWNER_SETUP_ENABLED=false` 时初始化页关闭；可选 `OWNER_SETUP_TOKEN` 作为额外口令。
- **页面与流程**：
  - `/` 根据状态跳转到 `/setup`、`/login` 或 `/today`。
  - `/setup` 创建账户后直接登录；`/login` 对未知邮箱和错误密码显示同一条提示，不泄露账号是否存在。
  - 失败次数限制：同一邮箱 15 分钟 8 次、同一 IP 15 分钟 20 次、修改密码 15 分钟 5 次。
  - 侧栏底部显示当前用户和退出按钮。
  - Settings → 账户与安全：修改密码（同时退出其他设备）、退出登录、退出所有设备（有确认对话框）。
- **访问控制**：
  - Proxy 把没有会话 cookie 的请求重定向到 `/login`（只是乐观检查）。
  - 真正的检查在服务端：页面内容在 `<Suspense>` 里经过 `requireOwner()`，每个 Server Action 自己重新验证会话。
- **`/api/health`**：返回应用版本和数据库状态（200 / 503），不暴露主机名、错误详情或配置。
- **安全响应头**：`X-Content-Type-Options`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy`；去掉 `X-Powered-By`。
- **新组件**：Input、TextField（label / 提示 / 错误与无障碍属性关联）、FormMessage、SubmitButton（提交中状态）、ConfirmDialog（Radix AlertDialog）。
- **工程**：项目改为 ESM（`"type": "module"`）；`.gitattributes` 统一 LF 换行。

### 测试结果

| 检查 | 结果 |
|---|---|
| `npm run lint` | ✅ 通过，0 警告 |
| `npm run typecheck` | ✅ 通过 |
| `npm run test`（单元，无需数据库） | ✅ 9 个文件，53 个测试全部通过 |
| `npm run test:integration`（真实 PostgreSQL 测试库） | ✅ 2 个文件，9 个测试全部通过 |
| `npm run test:e2e`（Playwright，生产构建 + 测试库） | ✅ 5 个测试全部通过 |
| `npm run build` | ✅ 通过；页面为部分预渲染（静态外壳 + 流式会话内容） |
| 手动检查 | ✅ `/api/health` 200；无 cookie 访问 `/today` → 307 `/login`；`POST /api/auth/sign-up/email` → 400（注册已关闭）；安全响应头齐全 |

- **集成测试**覆盖：
  - 首次初始化只能成功一次，5 个并发请求只有 1 个成功；
  - 中断的初始化可以恢复，进行中的不会被抢；
  - 密码以 Argon2id 存储；
  - 正确密码可登录、错误密码被拒，并记录最近登录时间；
  - 注册接口关闭；
  - seed 幂等。
- **E2E 测试**覆盖：
  - 首次初始化 → 自动登录 → 刷新后保持登录 → 初始化页关闭；
  - 未登录访问受保护页 → 跳转登录；错误账号或密码显示统一提示；
  - 退出登录后受保护页不可访问；
  - 修改密码后旧密码失效、新密码可用；
  - “退出所有设备”使另一个浏览器上的会话同时失效。

### 浏览器检查（开发服务器）

初始化表单的校验提示（字段级错误、保留已填写的称呼和邮箱、密码字段清空）、登录后的侧栏账户区、Settings 账户卡片、确认对话框、手机尺寸（375px 无横向溢出）。检查用的测试账户已从开发库删除，开发库目前处于“尚未初始化”状态。

### 已知限制

- **Content-Security-Policy 尚未设置**：主题预加载脚本是内联脚本，需要配合 nonce 或 hash，计划在 0.3 处理。
- **失败次数限制保存在进程内存中**：适合单实例部署，重启后清零。IP 取自 `X-Forwarded-For`，直接暴露在公网且没有反向代理时可能被伪造，但按邮箱的限制仍然有效。
- **应用容器尚未加入 Compose**：`docker compose` 目前只启动数据库，应用仍用 `npm run dev` / `npm start` 运行（0.3 完成）。
- **E2E 浏览器**：本机使用已安装的 Google Chrome，没有下载 Playwright 自带浏览器；CI 环境需要先运行 `npx playwright install chromium`。

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

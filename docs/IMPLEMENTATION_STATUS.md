# 实施状态

> 每完成一个大步更新一次。计划与技术决策见 `docs/IMPLEMENTATION_PLAN.md`。

## 当前进度

| 阶段 | 大步 | 状态 |
|---|---|---|
| Phase 0 | 0.1 骨架与界面 | ✅ 完成（2026-11-07） |
| Phase 0 | 0.2 数据与登录 | ✅ 完成（2026-11-07） |
| Phase 0 | 0.3 部署与验收 | ✅ 完成（2026-11-07） |
| **Phase 0** | **验收** | ✅ **通过**（见下文“Phase 0 验收”） |
| Phase 1–5 | — | ⏳ 未开始 |

---

## Phase 0 验收（2026-11-07）

规格 §13 的验收标准是：新机器按 README 能用 Docker 启动，创建 owner，登录，刷新后状态保留，数据写入 PostgreSQL。

验收方式：用一套**完全独立**的 Compose 项目模拟新机器。它有全新的数据卷、新生成的随机密钥，使用 3300 / 5433 端口，不碰开发库。验收结束后整套环境已删除。

| 验收项 | 结果 |
|---|---|
| `docker compose up -d --build --wait` 从零构建并启动 | ✅ 数据库健康 → 应用执行迁移和种子导入 → 应用健康 |
| 首次初始化、登录、刷新保持登录、退出、改密码、退出所有设备 | ✅ 对 Docker 部署运行完整 E2E 测试（`E2E_BASE_URL=http://localhost:3300`），5/5 通过 |
| 数据写入 PostgreSQL 并能持久保存 | ✅ `restart` 后、`down` + `up`（保留卷）后都能用原密码登录；库中能看到 owner 记录和最近登录时间 |
| 备份 → 删除全部数据卷 → 全新启动 → 恢复 | ✅ 恢复后能登录，用户文件内容和属主一致 |
| 忘记密码的重设命令 | ✅ 太短的密码被拒绝；重设后新密码可用、旧密码失效，所有会话被清除 |
| `scripts/update.sh` | ✅ 备份 → 重新构建 → 重启并迁移 → 健康检查全部通过 |
| `scripts/healthcheck.sh` | ✅ 容器、健康接口、数据库、磁盘、AI 配置各项正常 |

---

## 大步 0.3 — 部署与验收（2026-11-07）

### 已完成

- **Docker 镜像**（`Dockerfile`）：
  - 多阶段构建：deps → builder → runner；基础镜像 `node:24-alpine`；Next.js `output: "standalone"`。
  - 运行镜像约 324 MB，以非 root 用户 `node`（uid 1000）运行。
  - 应用代码归 root 所有，只有 `.next` 和 `/app/data` 可写。
  - 构建时不需要任何密钥；镜像自带 `HEALTHCHECK`。
- **启动流程**（`docker/entrypoint.sh`）：先执行数据库迁移，再导入种子，都成功后才启动服务。迁移失败时应用不会启动，不会在迁移到一半的库上运行。
- **运维脚本打包**：迁移、种子和密码重设脚本用 esbuild 打成单文件（`dist/ops/*.mjs`），运行镜像里不需要 tsx 和开发依赖。
- **Compose**：
  - 新增 `app` 服务：等数据库健康后再启动；`init: true` 正确处理信号；用户文件放在命名卷 `appdata`（`/app/data`）。
  - 所有配置从 `.env` 显式传入，数据库连接串由 `POSTGRES_*` 拼出。
  - `APP_PORT` 可以自定义，也可以只绑定 `127.0.0.1`；数据库端口只绑定 `127.0.0.1`。
- **内容安全策略（CSP）**：采用 Next.js 官方“Without Nonces”方案。基于 nonce 的 CSP 会让所有页面变成动态渲染，和部分预渲染不兼容。
  - 允许内联脚本（Next.js 引导脚本和主题预加载脚本）。
  - 禁止外部脚本、插件（`object-src 'none'`）、被嵌入框架（`frame-ancestors 'none'`）、向外部提交表单和劫持 `<base>`。
  - 开发模式额外允许 `unsafe-eval` 和 WebSocket（热更新需要）。
  - 已确认开发和生产环境都没有 CSP 违规。
- **运维脚本**（bash，Linux / macOS / Git Bash 通用）：
  - `scripts/backup.sh`：数据库导出 + 用户文件归档 + 变量名清单（不含值）+ 带 SHA-256 的 manifest。
  - `scripts/restore.sh`：先校验再动数据；需要确认；替换数据库和文件；启动后等待健康检查。
  - `scripts/healthcheck.sh`：检查容器、健康接口、数据库、磁盘和 AI 配置，不打印密钥。
  - `scripts/update.sh`：拉取代码 → 备份 → 构建 → 重启（自动迁移）→ 健康检查；失败时打印回滚步骤。
  - 都支持用 `ENV_FILE` 和 `COMPOSE_PROJECT_NAME` 指定其他环境。
- **忘记密码**：`docker compose exec app node ops/reset-owner-password.mjs`（本地开发用 `npm run owner:reset-password`）。密码隐藏输入或从管道读入，不出现在命令参数里；重设后清除所有会话。
- **`npm start`** 改为和镜像相同的 standalone 方式运行（`scripts/start-standalone.mjs`，跨平台）；E2E 也用这种方式。
- **E2E**：新增 `E2E_BASE_URL` 模式，可以对已经部署的实例运行同一套测试。
- **截图**：`scripts/capture-screenshots.ts` 从真实部署截图，放在 `docs/screenshots/`。
- **文档**：README 按规格 §17 重写；新增 `docs/OPERATIONS.md`（部署、HTTPS / 反向代理、备份恢复、升级回滚、忘记密码、故障排查、数据与隐私）。
- **界面**：侧栏项目高度和分组间距收紧，1440×900 屏幕上导航不再需要滚动（加入账户区后 AI Tutor 和 Progress 被挤出了可视区域）。新增站点图标（`src/app/icon.svg`）。

### 过程中发现并修复

- **构建时调用了认证实例**：`getCurrentUser` 写成 `getAuth().api.getSession({ headers: await headers() })`，JavaScript 会先执行 `getAuth()` 再执行 `await`。在没有 `.env` 的 Docker 构建中，这会在预渲染阶段报环境变量缺失。改为先读取请求头。本地因为有 `.env` 掩盖了这个问题，干净的 Docker 构建发现了它。
- **Git Bash 路径转换**：Git Bash 会把传给 docker 的 `/app/data` 改写成 Windows 路径，已在脚本中关闭（`MSYS_NO_PATHCONV=1`）。
- **ESLint 检查了生成文件**：`dist/` 已加入忽略列表。

### 测试结果

| 检查 | 结果 |
|---|---|
| `npm run lint` | ✅ 通过，0 警告 |
| `npm run typecheck` | ✅ 通过 |
| `npm run test` | ✅ 9 个文件，53 个测试 |
| `npm run test:integration` | ✅ 2 个文件，9 个测试 |
| `npm run test:e2e`（本地 standalone 构建） | ✅ 5 个测试 |
| E2E 对 Docker 部署运行 | ✅ 5 个测试 |
| Docker 镜像构建 | ✅ 构建时没有 `.env` 也能通过 |

### 已知限制

- CSP 允许内联脚本（原因见上文）；HSTS 和 `upgrade-insecure-requests` 交给 HTTPS 反向代理配置。
- 登录失败次数限制保存在进程内存里（单实例部署适用）。
- 备份脚本面向 Docker 部署；本地开发时的 `./data` 需要自行备份。
- 学习功能从 Phase 1 开始。

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

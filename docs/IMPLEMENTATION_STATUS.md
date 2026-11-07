# 实施状态

> 每完成一个大步更新一次。计划与技术决策见 `docs/IMPLEMENTATION_PLAN.md`。

## 当前进度

| 阶段 | 大步 | 状态 |
|---|---|---|
| Phase 0 | 0.1 骨架与界面 | ✅ 完成（2026-11-07） |
| Phase 0 | 0.2 数据与登录 | ✅ 完成（2026-11-07） |
| Phase 0 | 0.3 部署与验收 | ✅ 完成（2026-11-07） |
| **Phase 0** | **验收** | ✅ **通过**（见下文“Phase 0 验收”） |
| Phase 1 | 1.1 课程体系与课程学习器 | ✅ 完成（2026-11-07） |
| Phase 1 | 1.2 词汇与 FSRS 复习 | ✅ 完成（2026-11-07） |
| Phase 1 | 1.3 档案、引导、诊断、今日计划与进度 | ⏳ 未开始 |
| Phase 2–5 | — | ⏳ 未开始 |

---

## 大步 1.2 — 词汇与 FSRS 复习（2026-11-07）

### 已完成

- **调度**：使用 `ts-fsrs` 6.0。
  - 配置：FSRS-7、目标保持率 90%、学习步骤 1 分钟 / 10 分钟、重学步骤 10 分钟、关闭随机抖动（fuzz）。
  - 算法本身没有自己重写。每张卡和每条复习记录都保存调度器版本号。
  - v6 的接口和旧版不同：异步创建调度器、卡片字段改为驼峰命名、恢复卡片时日期必须是 Date 对象。实现前做了实测验证。
- **数据库**（`0002_vocabulary.sql`）：
  - `vocabulary_entries`：词条，91 条，由 seed 从课程内容导入；
  - `user_vocabulary`：学习者的词汇状态与掌握度；
  - `review_cards`：完整的 FSRS 卡片状态，外加便于查询的冗余列；
  - `review_logs`：只追加、不覆盖，带幂等键，并保存复习前的卡片状态和调度结果。
- **卡片**：五种模板——英 → 义、听音识别（被动识别，自评）；义 → 英、听写拼写、语境填空（主动产出，需要打字）。
  - 加词时默认只生成“英 → 义”和“义 → 英”两张，其他类型在词条页按需添加。
  - 语境填空只在例句里确实包含这个词时才提供。
- **把作答转成评分**（服务端强制执行）：打字题答错一律记为“忘记了”；用了提示最多记为“很吃力”；可以手动标记“我的答案其实也对”（会记录在日志里）。
- **答错时的流程**（规格 §2.3）：先显示正确答案和例句，可以马上再写一次但不计入成绩，然后按“忘记了”记录，卡片会在本轮稍后再出现。
- **复习队列**：
  - 先复习到期卡片，再学新卡；每天最多 20 张新卡；
  - 同一个词一轮只出一张卡；同一个词的其他卡片在复习后 12 小时内不出现（兄弟卡间隔）；
  - 识别卡排在产出卡之前；
  - 处在短学习步骤里的卡片会在本轮内再次出现；
  - 连续遗忘 4 次的卡片标为困难项。
- **课程联动**：完成一节课后，课里的新词自动加入词汇库并生成复习卡，课程总结会显示“N 个新词已加入词汇库”。
- **复习工作台**（`/review`）：
  - 四档评分：忘记了 / 很吃力 / 记得 / 很轻松，并附通俗说明；
  - 支持快捷键（Enter、1–4）；
  - 听音和听写卡片自动朗读；
  - 有进度条和本轮总结；没有到期卡片时说明原因（例如今天的新卡额度已用完）。
- **词汇中心**（`/vocabulary`）：
  - 统计：总数、看得懂、会用了、到期 / 逾期、困难词；
  - 被动识别与主动回忆的稳定度对比；
  - 7 / 30 / 90 天保持率（不足 10 次复习时显示“数据不足”）；
  - 按状态筛选、搜索。
- **词条页**：每张卡片的状态、下次复习时间、复习和遗忘次数、暂停 / 恢复，按需添加卡片类型，复习记录，来源课程，以及困难词的处理建议。
- **导出**（规格 §5.4、§16.17）：词汇（含状态）和完整复习记录的 CSV。导出文件带 BOM，用 Excel 打开中文不乱码；以 = + - @ 开头的单元格会做处理，防止被当成公式执行。需要登录。
- **可复现**：从卡片创建时开始，按复习记录重放一遍，得到的状态和数据库里存的状态完全一致；修改调度器版本也不会破坏历史记录（有集成测试）。

### 测试结果

| 检查 | 结果 |
|---|---|
| `npm run lint` / `typecheck` | ✅ 通过，0 警告 |
| `npm run test` | ✅ 13 个文件，81 个测试（新增：卡片 / 评分规则 / 状态推导 / 调度器往返与确定性 9 个，CSV / 时间工具 3 个） |
| `npm run test:integration` | ✅ 4 个文件，26 个测试（新增 9 个：课程加词只加一次、按需加卡、日志追加与幂等、打字题评分强制、重放可复现且不怕调度器版本变化、兄弟卡间隔、新卡每日上限与暂停、学习者之间数据隔离、统计） |
| `npm run test:e2e` | ✅ 9 个测试（新增 2 个：课程词汇 → 复习一轮（含打字答错、重试、本轮内再次出现）→ 复习记录 → 导出；未登录不能导出） |
| Docker 镜像干净构建（无 `.env`） | ✅ 通过 |

### 过程中发现并修复

- Drizzle 不会展开原生 SQL 片段里的表别名，兄弟卡查询查不到表。改为写明确的 SQL。
- 原生 SQL 片段里的 Date 参数不会被自动转换。改为传 ISO 字符串，再显式转成 `timestamptz`。
- 同一个词的卡片原来按字母顺序排，“义 → 英”会排在“英 → 义”前面。现在先识别、后产出。
- 词条页的日期原来用服务器时区显示（Docker 里是 UTC）。现在使用配置的时区。
- 词汇页只统计“到期”卡片，有新卡等待时没有入口。现在会提示新卡数量，并提供开始复习的按钮。

### 已知限制

- 每日新卡上限（20）和时区暂时是固定值或取自环境变量；1.3 会改为学习偏好设置。
- 打字题的判定对大小写、标点和撇号宽松，但不认同义说法。可以用“我的答案其实也对”手动标记，日志里会记下这是手动标记。
- 还不能手动搜索并添加任意新词，也不能导入 CSV 词表。目前的词都来自课程，导入功能在 Phase 2。

---

## 大步 1.1 — 课程体系与课程学习器（2026-11-07）

### 已完成

- **内容结构**：版本化 Zod schema（content_schema_version 1）定义了 11 种步骤类型和 9 种教学作用。规则会自动检查：
  - 每节课都有离堂检查（exit ticket）；
  - published 单元至少 3 节核心课、1 节复习课，并且有听力、输出和对话输入；
  - 词汇、can-do 和课程编号之间的引用都对得上；
  - 配对题没有重复项，排序题的答案能由词块拼出。

  编写规范见 [CONTENT_AUTHORING_GUIDE.md](CONTENT_AUTHORING_GUIDE.md)。
- **课程目录**：Pre-A1 8 个单元、A1 20 个单元（规格 §3.2、§3.3），A2 7、B1 6、B2 5、C1 3、C2 3 个单元的蓝图（规格 §3.4，状态 planned）。
- **完整内容（原创，状态为 published + pending_owner_review）**：
  - 共 6 个单元：Pre-A1 *Hello!*、*My Name Is...*、*Numbers Around Me*；A1 *I'm, You're, She's*、*Who Does What*、*Asking Questions*。
  - 共 24 节课（每单元 3 节核心课 + 1 节复习课）、236 个步骤，其中 152 个需要作答，含 72 个听力步骤（对话输入 + 听辨题）和 20 个口语 / 写作任务。
  - *Hello!* 按规格 §15.3 完整制作：问候对话、Hello / Good morning / How are you? / I'm fine, thank you 等语块、句子理解、听辨、角色扮演、口语输出、错误反馈和完成评估。复习卡将在 1.2 接上。
- **数据库**：`courses`、`units`、`lessons`、`lesson_steps`、`learner_lesson_progress`，以及只追加、不覆盖的 `lesson_step_attempts`（带幂等键）。迁移文件为 `0001_curriculum.sql`。
- **种子导入**：一次导入目录和全部已编写单元，可重复执行；从文件中删掉的课时和步骤会被归档而不是删除，学习记录得以保留。
- **页面**：
  - 学习路径：7 个等级，显示可学单元数和完成进度；
  - 等级页：单元列表，计划中的单元明确标出；
  - 单元页：课程状态、能力目标、语法与常见错误、可朗读的词汇表。
- **课程学习器**（`/lesson/[id]`，没有侧栏，专注学习）：
  - 布局按规格 §5.3：顶部是课程名、进度和朗读速度，中间是当前步骤，旁边是词汇和语法提示，底部是上一步 / 检查答案 / 继续。
  - 每一步都会写入作答记录，刷新后回到上次的位置。
  - 答错时先显示正确答案和解析，可以“再试一次”，但重试不计入首次成绩。
  - 课程结束有总结：首次答对率、值得再看的题（附正确答案）、本课词汇、下一课。
  - 手机上单列显示，没有横向溢出。
- **判分**：全部在服务端完成，答案和解析不会发送到浏览器。答案比较对大小写、标点和撇号宽松，但单词必须对。
- **朗读**：使用浏览器自带的 Web Speech API，可选慢 / 中 / 正常三档速度。对话默认先听后看，英文和中文可以分别显示。界面标明“浏览器朗读”；不支持的浏览器会直接显示原文。
- **录音**（口语任务）：只在按下录音时请求麦克风；被拒绝时提示可以改用文字作答；停止后立即释放麦克风；录音只保存在当前页面，不上传。
- **导航**：在等级页和单元页上，“学习路径”也会高亮。

### 测试结果

| 检查 | 结果 |
|---|---|
| `npm run lint` / `typecheck` | ✅ 通过，0 警告 |
| `npm run test` | ✅ 11 个文件，69 个测试（新增内容校验 6 个、判分 / 去除答案 10 个） |
| `npm run test:integration` | ✅ 3 个文件，17 个测试（新增 8 个：服务端判分、幂等重试、首次成绩、缺步不能完成、学习者之间数据隔离、页面数据不含答案、计划中单元不可学） |
| `npm run test:e2e` | ✅ 7 个测试（新增 2 个：路径 → 单元 → 完成一节课，含答错重试、刷新续学和总结；手机尺寸学习器） |

### 过程中发现并修复

- E2E 测试库只迁移、没导入种子，课程为空。现在和 Docker 启动流程一致：先迁移，再导入种子。
- Playwright 以原生 ES 模块加载代码，JSON 导入必须带 `with { type: "json" }`，已全部补上（Next、esbuild、Vitest 都支持这种写法）。
- 朗读：一个按钮的清理逻辑可能打断别的按钮正在播放的语音；“播放整段对话”点停止后仍会读下一句。两处都已修复。
- 界面：问题标题和选项贴得太近、操作栏没有铺满宽度、侧栏词汇被截断、句型框不换行。都已调整。

### 已知限制

- 课程内容由 Claude 撰写，**等待你审核**（`review_status: pending_owner_review`）。
- 朗读音质取决于设备上安装的英语语音；Phase 3 会换成生成的音频文件。
- 口语和写作任务目前是自评，AI 反馈在 Phase 3 加入。
- 本课词汇还不会进入复习：1.2 实现词汇库和 FSRS 后接上。
- Pre-A1 的 Unit 1、2、6–8 和 A1 的 Unit 4–20 还只有目录，没有内容。

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

# LinguaBloom

个人私有部署的英语学习工作站：系统课程、真实输入、主动输出、AI 辅导和间隔复习，帮助中文母语学习者从 Pre-A1 长期成长到 C1/C2。

> **当前状态：Phase 0 / 大步 0.2（数据库与登录）已完成。**
> 可以创建唯一的 owner 账户、登录、修改密码、退出所有设备；学习功能还没开始，大部分页面是标明上线阶段的占位。详见 [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)。
> 应用的 Docker 镜像、完整部署说明和备份恢复会在大步 0.3 补全。

## 本地开发

需要 **Node.js 24+** 和 **Docker**（用来运行 PostgreSQL）。

1. 安装依赖：

   ```bash
   npm install
   ```

2. 创建 `.env`：复制 `.env.example`，把 `APP_SECRET` 和数据库密码换成随机值（文件里有生成命令）。`POSTGRES_PASSWORD` 和 `DATABASE_URL` 里的密码要一致。

3. 启动数据库、执行 migration 和 seed：

   ```bash
   npm run db:setup
   ```

4. 启动开发服务器：

   ```bash
   npm run dev
   ```

打开 http://localhost:3000 。第一次会进入 `/setup` 创建你的账户；之后初始化自动关闭，也不开放注册。开发模式下可访问 `/design` 查看设计令牌与组件。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run db:up` | 启动 PostgreSQL 容器并等待健康检查通过 |
| `npm run db:generate` | 根据 `src/db/schema` 的改动生成新的 SQL migration |
| `npm run db:migrate` | 执行尚未执行的 migration |
| `npm run db:seed` | 导入版本化种子内容（可重复执行） |
| `npm run db:setup` | 依次运行 db:up、db:migrate、db:seed |
| `npm run lint` | ESLint |
| `npm run typecheck` | 生成路由类型并运行 `tsc` |
| `npm run test` | 单元 / 组件测试（不需要数据库） |
| `npm run test:integration` | 集成测试，使用独立测试库 `<库名>_test`（每次清空） |
| `npm run test:e2e` | Playwright 端到端测试（生产构建 + 测试库，端口 3200） |
| `npm run check` | 依次运行 lint、typecheck、test |
| `npm run build` | 生产构建 |

集成测试和 E2E 测试需要数据库容器在运行（`npm run db:up`）。E2E 在本机使用已安装的 Google Chrome。

## 修改数据库结构

1. 修改 `src/db/schema/` 下的定义。
2. 运行 `npm run db:generate`，检查生成的 SQL 文件，和代码一起提交。
3. 运行 `npm run db:migrate`。

不要用 `drizzle-kit push` 修改数据库。

## 文档

- [`LinguaBloom_Claude_开发规格.md`](LinguaBloom_Claude_开发规格.md)：完整产品与开发规格
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)：实施计划与技术决策
- [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)：已完成内容、测试结果与已知限制
- [`docs/CONTENT_AUTHORING_GUIDE.md`](docs/CONTENT_AUTHORING_GUIDE.md)：课程内容编写规范
- [`docs/AI_PROMPTS.md`](docs/AI_PROMPTS.md)：AI Prompt 规范与版本库

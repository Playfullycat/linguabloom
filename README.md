# LinguaBloom

个人私有部署的英语学习工作站：系统课程、真实输入、主动输出、AI 辅导和间隔复习，帮助中文母语学习者从 Pre-A1 长期成长到 C1/C2。

> **当前状态：Phase 0 / 大步 0.1（界面骨架）已完成。**
> 还没有数据库、登录和学习功能。大部分页面是标明上线阶段的占位。详见 [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)。
> 完整的部署说明（Docker、环境变量、备份恢复）会在大步 0.3 补全。

## 本地开发

需要 Node.js 24 或更高版本。

```bash
npm install
npm run dev
```

打开 http://localhost:3000 。开发模式下可访问 `/design` 查看设计令牌与组件。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run lint` | ESLint |
| `npm run typecheck` | 生成路由类型并运行 `tsc` |
| `npm run test` | Vitest 单元 / 组件测试 |
| `npm run check` | 依次运行 lint、typecheck、test |
| `npm run build` | 生产构建 |

## 文档

- [`LinguaBloom_Claude_开发规格.md`](LinguaBloom_Claude_开发规格.md)：完整产品与开发规格
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)：实施计划与技术决策
- [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)：已完成内容、测试结果与已知限制
- [`docs/CONTENT_AUTHORING_GUIDE.md`](docs/CONTENT_AUTHORING_GUIDE.md)：课程内容编写规范
- [`docs/AI_PROMPTS.md`](docs/AI_PROMPTS.md)：AI Prompt 规范与版本库

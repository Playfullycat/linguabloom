# 内容编写规范（Content Authoring Guide）

> 状态：**骨架**。JSON schema 的具体字段在 Phase 1 实现课程数据模型时用 Zod 定稿，并在此处同步。

## 1. 基本原则

- 课程、单元、课时、步骤、练习、词汇、语法、音频与评估全部是**结构化数据**，存于数据库或 `src/db/seed/` 下的版本化种子文件；不写在 JSX 中。
- 每份内容都声明 `content_schema_version`，schema 变化时递增版本并提供迁移。
- 英文例句自然、符合真实交际；初级阶段提供中文支架，高级阶段逐步减少。
- 不复制商业教材的页面、题目、答案、整段文字或音频；可借鉴教学组织方式与理论。

## 2. 必填元数据

| 字段 | 说明 |
|---|---|
| `id` | 稳定 ID（种子文件中用可读 slug，入库后对应 UUID） |
| `cefr_level` | `pre_a1` / `a1` / `a2` / `b1` / `b2` / `c1` / `c2` |
| `skills` | 涉及的技能维度（见规格 §2.1 的 10 个维度） |
| `can_do_ids` | 对应的 can-do 目标 |
| `source_type` | 见第 3 节 |
| `status` | 见第 4 节 |
| `content_schema_version` | 内容结构版本 |

## 3. 来源类型 `source_type`

- `first_party`：本项目原创
- `ai_generated`：AI 生成（必须先经过结构校验与审核）
- `user_imported`：用户导入，仅个人使用
- `licensed`：已获授权（记录授权说明）
- `public_domain`：公有领域（记录出处）
- `external_link`：只保存外链与必要元数据

## 4. 状态生命周期

`planned` → `draft` → `reviewed` → `published` → `archived`

- **审核状态与发布状态分离**（规格 §16.16）。
- 只有真实可学习、有练习、有答案或评分说明、有来源的内容才能标为 `published`。
- 空课程、只有标题的单元只能是 `planned`。

## 5. 题目与答案

- 客观题必须有唯一答案或明确的多答案集合。
- 开放题必须附评分 rubric（维度、等级描述、示例）。
- 每题提供解析；初级提供中文解析。
- 题目记录 CEFR、技能、知识点、难度；诊断题额外记录区分度。

## 6. 发布前审核清单（规格 §12.3）

- [ ] CEFR 级别合理，词汇与语法不超出目标级别
- [ ] 例句自然
- [ ] 答案正确；开放题有评分说明
- [ ] 音频转录与音频一致
- [ ] 内容不重复
- [ ] 来源与版权状态清楚
- [ ] AI 生成内容无事实错误或不自然表达

## 7. 待定稿（Phase 1）

- Course / Level / Unit / Lesson / LessonStep 的 JSON schema
- `step_type` 枚举与各类型的 `content` 结构（orientation、input、notice、teach、guided_practice、retrieval_practice、communicative_task、feedback、exit_ticket、next_review 等）
- 词条字段与卡片模板
- 种子文件目录结构与导入命令

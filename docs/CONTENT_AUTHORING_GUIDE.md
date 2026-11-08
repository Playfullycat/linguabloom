# 内容编写规范（Content Authoring Guide）

> 课程内容结构版本：**content_schema_version 1**（Phase 1 / 大步 1.1 定稿）。
> 权威定义是 `src/modules/curriculum/content/schema.ts`（Zod）。本文件说明怎么写，schema 负责校验。

## 1. 基本原则

- 课程、单元、课时、步骤、练习、词汇、语法全部是**结构化数据**：写在 `src/content/` 下的版本化 JSON 文件里，由 seed 导入 PostgreSQL。页面代码里不写课程内容。
- 每份文件声明 `content_schema_version`。schema 有不兼容的变化时递增版本，并提供迁移。
- 英文例句要自然，符合真实交际。教规范说法的同时也教真实常用的说法，例如 I'm fine, thank you 和 Good, thanks!。
- 初级阶段提供中文支架，高级阶段逐步减少。
- 不复制商业教材的页面、题目、答案、整段文字或音频；可以借鉴教学组织方式和理论。
- 题目文字是纯文本，不写 Markdown（`**粗体**` 不会被渲染）。

## 2. 文件与目录

```text
src/content/
  catalog.json                 课程目录：所有等级的所有单元（含计划中的）
  index.ts                     登记已编写的单元文件（静态 import，打包进 Docker 镜像的 seed）
  pre-a1/u03-hello.json        已编写的完整单元，一个单元一个文件
  a1/u01-pronouns-be.json
```

新增一个完整单元：

1. 在对应等级目录下新建 JSON 文件；
2. 在 `catalog.json` 对应条目上加 `"file": "<等级>/<文件名>"`；
3. 在 `src/content/index.ts` 登记，导入时带上 `with { type: "json" }`；
4. 运行 `npm run test`，它会校验所有内容文件；
5. 运行 `npm run db:seed` 导入数据库。

## 3. 目录条目（catalog.json）

每个单元一条：`id`、`level`、`order`、`title_en`、`title_zh`、`summary_zh`，可选 `file`。

- 没有 `file` 的单元导入后状态为 **planned**：出现在路径和等级页上，但不能学习。
- 同一等级内 `order` 不能重复；`id` 全局唯一，使用小写短横线格式，例如 `pre-a1-u03-hello`。

## 4. 单元文件

| 字段 | 说明 |
|---|---|
| `content_schema_version` | 目前为 `1` |
| `source_type` | 见第 7 节 |
| `review_status` | `unreviewed` / `pending_owner_review` / `reviewed`（**和发布状态分开**） |
| `unit.id / level / order` | 必须和目录条目一致 |
| `unit.status` | `draft` 或 `published` |
| `unit.can_do` | 能力目标：`id`、`skill`、`en`、`zh`（自己撰写，参考 CEFR 描述框架，不照抄原文） |
| `unit.grammar_points` | 语法 / 功能点：`pattern`（可用 `\n` 换行）、`explanation_zh`、`examples`（至少 2 条）、`common_errors` |
| `unit.vocabulary` | 词条：`key`、`text`、`pos`、`ipa`、`zh`、`example_en`、`example_zh`（至少 4 条） |
| `unit.lessons` | 课时，见第 5 节 |

**published 单元的额外要求**（规格 §15.2，schema 会自动检查）：

- 至少 3 节 `core` 课，外加 1 节 `review` 课；
- 至少一个听力活动（`skill: "listening"` 的步骤）；
- 至少一个输出任务（`speak` 或 `write`）；
- 至少一段意义输入（`dialogue`）。

## 5. 课时与步骤

课时字段：`id`（以单元 id 开头，例如 `pre-a1-u03-hello-l1`）、`order`、`kind`（`core` / `review`）、标题、`estimated_minutes`（3–20）、`objectives`（2–4 条中英文目标）、`can_do_ids`、`steps`（至少 4 步）。

**每节课至少有一个 `exit_ticket` 步骤，并且必须是需要作答的题型。**

每个步骤都有 `id`（`s01`、`s02`……）、`type`（题型，决定怎么显示）、`role`（在课程中的作用，规格 §3.5）和 `skill`（技能维度）。

`role` 可取：`orientation`、`warm_up`、`input`、`notice`、`teach`、`guided_practice`、`retrieval_practice`、`communicative_task`、`exit_ticket`。

| type | 用途 | 关键字段 | 判分 |
|---|---|---|---|
| `orientation` | 这节课学什么 | `title_zh`、`body_zh` | 不判分 |
| `dialogue` | 对话输入，默认先听后看 | `title_en`、`instructions_zh`、`scene_zh`、`lines[]`（`speaker`、`en`、`zh`） | 不判分 |
| `vocab` | 新词卡片 | `items[]`（引用单元词汇的 `key`） | 不判分 |
| `notice` | 引导发现规律 | `question_zh`、`examples[]`（可用 `highlight` 标出要注意的部分）、`takeaway_zh` | 不判分 |
| `teach` | 简明讲解 | `title_zh`、`explanation_zh`、`pattern`、`examples[]`、`tips_zh[]` | 不判分 |
| `choice` | 单选；有 `audio_en` 时变成听力题，原文要答完才显示 | `options[]`、`answer`（下标）、`explanation_zh` | 自动判分 |
| `cloze` | 填空，句子里用一个 `___` 标出空位 | `sentence_en`、`answers[]`（所有可接受的答案）、`explanation_zh` | 自动判分 |
| `order` | 排序成句 | `tokens[]`、`answers[]`（所有可接受的完整句）、`explanation_zh` | 自动判分 |
| `match` | 配对，左右两边各自不能有重复项 | `pairs[]`（`left`、`right`） | 自动判分 |
| `speak` | 口语任务：可以录音，也可以打字 | `task_zh`、`prompt_en`、`model_answers[]`、`checklist_zh[]` | 自评 |
| `write` | 写作任务 | `task_zh`、`model_answers[]`、`checklist_zh[]` | 自评 |

**判分规则**（服务端执行，答案从不发送到浏览器）：

- 忽略大小写、标点、弯直引号和多余空格，但单词必须对。所以撇号可省（I'm 和 Im 都算对），而 morning 和 evening 不能混。
- 需要接受多种写法时，全部写进 `answers`，例如 `["forty-five", "forty five"]`。
- 排序题的每个答案都必须能由 `tokens` 拼出来，测试会检查这一点。
- 开放任务没有 AI 判分（Phase 3 才加入）：学习者先完成任务，再对照示范答案勾选 `checklist_zh`，记录为自评结果。

**写题建议**：

- 解析先说结论，再说理由，一两句即可。
- 听力题的选项要有迷惑性但公平，例如 13 / 30、the UK / the US。
- 生活场景用成年人的真实情境（上班、购物、邻居），不要写成儿童读物。

## 6. 状态生命周期

`planned` → `draft` → `published` → `archived`，审核状态 `review_status` 单独记录（规格 §16.16）。

- 只有真实可学习、有练习、有答案或评分说明、有来源的内容才能标为 `published`。
- 只有标题的单元保持 `planned`，也就是目录里不加 `file`。
- 从文件里删掉的课时和步骤，seed 会把它们**归档**而不是删除，学习记录因此得以保留。
- 首批 6 个单元由 Claude 原创，状态为 `published` + `pending_owner_review`：可以学习，但等待你审核。

## 7. 来源类型 `source_type`

- `first_party`：本项目原创
- `ai_generated`：AI 生成（必须先经过结构校验与审核，Phase 3）
- `user_imported`：用户导入，仅个人使用（Phase 2）
- `licensed`：已获授权（记录授权说明）
- `public_domain`：公有领域（记录出处）
- `external_link`：只保存外链和必要元数据

## 8. 发布前审核清单（规格 §12.3）

- [ ] CEFR 级别合理，词汇和语法不超出目标级别
- [ ] 例句自然
- [ ] 答案正确；开放题有自评清单
- [ ] 听力原文（`audio_en`、对话）与题目一致
- [ ] 内容不重复
- [ ] 来源与版权状态清楚
- [ ] AI 生成内容没有事实错误或不自然的表达

## 9. 其他种子

- `src/db/seed/data/cefr-levels.json`：七个 CEFR 等级的阶段目标与内容重点（规格 §3.1）。
- `src/content/assessment/diagnostic-v1.json`：水平诊断题库（规格 §4.2），由 `src/modules/assessment/content.ts` 校验。
  - 每题必须有 `id`（如 `voc-a1-2`）、`skill`（vocabulary / grammar / reading / listening）、`level`、`difficulty`（1–5）、`discrimination`（0–1）和中文解释 `explanation_zh`。
  - 题型：`choice`（`options` + `answer` 下标，可带阅读短文 `passage_en` 或听力文本 `audio_en`）和 `cloze`（`sentence_en` 里用一个 `___` 标出空格，`answers` 列出可接受的答案）。
  - 每项技能在 Pre-A1、A1、A2、B1 每一级都至少要有一题，否则校验不通过。题目要比该级的典型能力稍难一点也可以，但不能考生僻知识。
  - 从文件里删掉的题会被归档（不会删除），旧的作答记录仍然有效。改动已上线的题时，题意不要变；要换成新题就用新的 `id`。
- 所有 seed 在 `src/db/seed/index.ts` 的 `SEEDS` 中登记，先校验再在事务里做幂等 upsert；用 `npm run db:seed` 运行。Docker 容器每次启动都会自动执行。
- `src/content/materials/<level>.json`：内置分级阅读和听力材料（规格 §5.6、§5.7），由 `src/modules/materials/content.ts` 校验，在 `rawMaterialFiles` 里登记。
  - 每份材料：`id`（阅读 `rd-…`，听力 `ls-…`）、`type`、`level`、`topic`、中英标题、中文简介、`segments`（每句 `en` + `zh`，听力还要 `speaker`）、`glossary`、2–6 道 `questions`（选择题，可用 `segment` 指向答案所在的句子）。
  - **生词表是查词的唯一来源**（决定 D50）：超出该材料等级的词和短语都要放进去，写清 `zh`，最好有 `ipa`；文中出现的变形写进 `forms`（例如 `book` 的 `forms: ["books"]`）。校验会检查每个变形确实出现在文中。
  - 句子不超过 30 个词。故事和说明文都是虚构的，简介里要写明“虚构”，不要写真实世界的事实。
  - 生词会作为词条导入（id 为 `<材料 id>.<key>`），例句自动取文中第一次出现的那一句。
- `src/content/grammar/*.json`：语法地图和练习题（规格 §3.6、§3.7、§5.5），由 `src/modules/grammar/content.ts` 校验，在 `rawGrammarFiles` 里登记。
  - 每个语法点：`id`、`order`（教学顺序，全局唯一）、`level`、中英标题、`status`（`published` / `planned`）、`topics`、`prerequisites`（必须排在前面）、`unit_grammar_ids`（对应课程单元里的语法点 id，用来显示“在哪些课学过”，也用来把课程里的错误归到这个语法点）、`default_error_category`（13 类之一）、`summary_zh`。
  - `published` 还需要：`explanation_zh`、`structure`、`usage_zh`、`examples`、`breakdowns`（句子成分：subject / verb / object / complement / time / place / adverb / question / other）、`common_errors`，可选 `contrast`、`limits_zh`。
  - 练习：`choice`、`cloze`（一个 `___`）、`order`（`tokens` 必须正好是第一个答案里的词）、`correction`（`wrong_en` + 可接受的改法）、`build`（`task_zh` + `model_answers` + 1–4 条 `checklist_zh`，学习者自评）。至少 5 道自动判分题、至少 3 种题型（补救用 3 道、再测再用 2 道不同的）。单题可以用 `error_category` 覆盖默认类别。
  - 练习 id 写成 `e1`、`e2`……，入库后是 `<语法点 id>.<e1>`。已上线的题不要改题意，要换就用新 id。
- `src/content/writing/prompts.json`：写作题目（规格 §5.11），由 `src/modules/writing/content.ts` 校验。每题有 `id`（`w-…`）、`type`（rewrite / diary / email / opinion / summary）、`level`、中英标题和要求、`min_words` / `max_words`、1–4 条自查清单，摘要题可以用 `source_material` 指向一篇阅读材料。
- `src/content/speaking/tasks.json`：口语任务（规格 §5.10），由 `src/modules/speaking/content.ts` 校验。每题有 `id`（`sp-…`）、`type`（read_aloud / repeat_sentence / short_answer / guided_conversation / roleplay / retelling / opinion）、`level`、中英标题、目标、说明、能力目标。朗读和跟读要有 `items`（逐句）；对话类要有 `opening_en`（老师的第一句），可选 `questions`、`setup_en`（角色 / 场景，写给 AI）、`key_phrases`、`max_turns`；故事复述要用 `source_material` 指向一篇内置材料。
- `src/content/can-do/catalog.json`：**能力描述**（规格 §2.1），和各单元文件里的 `can_do` 合在一起，由 `src/modules/abilities/content.ts` 校验，`can-do` 种子写入 `can_do_statements`。
  - 单元的 `can_do` 是课程目标；`catalog.json` 补充整个等级的描述（每条：`id`、`level`、`skill`（十个技能维度之一）、`en`、`zh`、可选 `prerequisites`）。用自己的话写，和 CEFR 等级对齐，不要照抄 CEFR Companion Volume 的原文。
  - id 写成 `<等级>.<技能缩写>.<主题>`，例如 `a2.sp.opinion`；全部内容里不能重复。已上线的 id 不要改，删掉的会被归档，学习者的证据仍然指向它。
  - **练习要说明它证明哪条能力**：内置材料、语法点、口语任务、写作题目都可以写 `can_do_ids`（最多 6 个），课时用已有的 `can_do_ids`。只有写了 `can_do_ids` 的练习才会产生能力证据；课时步骤只算给技能维度相同的那几条。写错 id 时 `npm run test` 和种子都会报错。
  - 通过标准不用写：按技能维度自动设定（见决定 D79），“证据类型”也由引用它的内容自动算出。
- `src/content/pte/exam-versions.json`：**PTE 考试版本**（规格 §5.13、§8.8），由 `src/modules/pte/content.ts` 校验，`pte` 种子写入数据库。
  - 每个版本：`id`、名称、`effective_from`（官方没写就填 `null`，不要猜）、`reviewed_on`（核对官方页面的日期）、官方来源链接、说明，以及 22 类题型。只能有一个 `is_current: true`。
  - Pearson 改了题型或规则时，**新增一个版本**，不要改旧版本：旧的作答记录绑定的是旧版本。题型 `code`（如 `r_fib_dropdown`）在各版本之间保持不变。
  - 每类题型：官方时间和限制（`timing`）、官方评分描述（`scoring.official_zh`）、本应用的判分方法（`scoring.method`）。官方没公开的规则要写 `"unconfirmed": true`，并在 `rule_zh` 里说明。说明文字用自己的话转述官方页面，不要整段照抄。
- `src/content/pte/prompts/*.json`：**原创 PTE 练习题**。每题 `id`（`pte-…`）、`task`（题型 code）、`difficulty`（1–5）、`title_zh`、`content`（格式见 `src/modules/pte/content.ts` 的 `promptContent`）。
  - 阅读填空用 `{1}`、`{2}` 标出空；听力填空直接把答案写在花括号里，可接受的其他写法用 `/` 分开（例如 `{analysed/analyzed}`）；“找出不同的词”写成 `[文字稿里的词|录音里的词]`。
  - 听力题写 `script`（录音的文字，用语音合成朗读）；文字长度按官方上限（阅读填空 200 词、多选 350 词、排序和单选 110 词、拖放 80 词）。
  - 改动已上线的题目时，种子会自动升 `content_version`，旧作答仍显示当时的内容。题目全部原创，不要改写真题或第三方题库。
  - 口语与写作题（`speaking-writing.json`）：朗读写 `text`（≤60 词）；复述句子写 `sentence`；看图描述写 `chart`（`type` 为 bar / line，`categories` 和 `values` 一一对应，单一系列）、`key_features_zh`、`model_answer`；复述讲座、小组讨论总结写 `script`（小组讨论要三位有名字的说话人）、`key_points_zh`、`model_answer`；简短回答写 `script` 和可接受的 `answers`；情景回应写 `situation`（≤60 词）、`key_points_zh`、`register_zh`、`model_answer`；写作摘要写 `passage`（≤300 词）和一句话的 `model_answer`；作文写 `topic` 和 `ideas_zh`。

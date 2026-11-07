# LinguaBloom — Claude Code 完整产品与开发规格

> **文档类型**：产品需求文档（PRD）+ 教学设计规范 + UX/UI 设计系统 + 技术架构 + 数据模型 + AI 规范 + 开发执行计划  
> **版本**：1.0  
> **规格基准日期**：2026-11-07  
> **项目形态**：个人长期使用的私有化英语学习 Web App  
> **工作名称**：LinguaBloom（暂定名，正式发布前不做商标/域名可用性承诺）  
> **首要目标**：让一位中文母语、基础薄弱的成年学习者，能够通过系统课程、真实输入、主动输出、AI 辅导和间隔复习，持续从 Pre-A1/A1 成长到 C1/C2；同时为未来 PTE Academic 备考提供可切换的专项训练区。

---

## 0. Claude Code 执行总指令

你正在构建一个可长期使用的完整英语学习产品，不是静态设计稿、营销落地页、普通 CRUD 后台，也不是只靠聊天机器人拼接出来的 Demo。

### 0.1 必须遵循的原则

1. **先验证项目，再实现功能。** 首先检查当前仓库、运行环境、已有依赖和文件，不要不看现有代码就覆盖。
2. **先设计系统，再铺页面。** 先建立设计令牌、基础组件、布局、导航和响应式规则，再开发业务页面。
3. **模块化单体，不做微服务。** 项目以一个 Next.js 应用和一个 PostgreSQL 数据库运行，模块边界清晰，方便个人维护。
4. **功能必须真实可用。** 按钮、表单、播放器、计时器、复习评分、导入、AI 对话和数据图表都必须有真实状态和业务行为；禁止“看起来能点、实际没有逻辑”的控件。
5. **不允许用假数据冒充已完成能力。** Demo 数据可以单独标记，但真实学习进度、复习状态、会话记录必须持久化。
6. **内容必须结构化。** 课程、单元、课时、步骤、练习、词汇、语法、音频、评估都应可被数据库或版本化种子文件管理，不能散落在 JSX 中。
7. **AI 必须可替换。** 模型厂商和模型名称必须通过服务端配置及 Provider Adapter 管理，不允许在前端写死密钥或把所有业务逻辑绑死在某家 API。
8. **先完成可持续的 MVP，再扩充内容。** 先交付真实可运行的 Pre-A1/A1 学习闭环，再逐步完善 A2–C2 和 PTE 内容。不能声称已经具备全等级完整课程，却只放几个空页面。
9. **默认保护隐私。** 个人部署、默认单用户、关闭公开注册；音频和写作记录可查看、导出和删除。
10. **每个阶段都要验收。** 每完成一个阶段，运行 lint、类型检查、测试、构建和关键 E2E 测试，并修复失败项。

### 0.2 交付要求

完成后，仓库至少应包含：

- 可运行的 Next.js 应用；
- Dockerfile 与 `docker-compose.yml`；
- PostgreSQL 数据库及 Drizzle migrations；
- `.env.example` 与启动说明；
- 登录与首次初始化流程；
- 学习者档案和水平诊断；
- 课程目录、课程学习器、词汇系统与 FSRS 复习；
- 阅读、听力、语法、AI Tutor、口语和写作模块的可用基础版本；
- PTE 专区的结构与首批训练任务；
- 学习数据看板；
- 内容导入与 AI 生成流程；
- 单元测试、集成测试和关键 E2E 测试；
- 数据备份、恢复、升级与故障排查文档。

### 0.3 实施前必须做的事

- 检查仓库中是否已有应用；若为空则创建项目。
- 读取当前稳定版本的官方文档，确认 Node.js、Next.js、Drizzle、`ts-fsrs`、所选 AI SDK 的 API；不要照搬旧版接口。
- 创建 `docs/IMPLEMENTATION_PLAN.md`，把本规格拆成可交付任务，并记录技术决策。
- 创建 `docs/CONTENT_AUTHORING_GUIDE.md`，规定课程 JSON/schema、CEFR 标签、答案、解析、来源和审核状态。
- 创建 `docs/AI_PROMPTS.md`，集中维护 Prompt 版本，禁止将大段提示词散落到组件中。
- 每完成一个阶段更新 `docs/IMPLEMENTATION_STATUS.md`，写清已完成、未完成、已知限制和测试结果。

---

# 1. 产品定义

## 1.1 产品定位

LinguaBloom 是一款以科学学习流程为核心的个人英语学习工作站。它把以下五种能力整合在一个持续学习系统中：

- **Systematic Course**：从 Pre-A1 到 C2 的分级课程和能力路线；
- **Deliberate Practice**：词汇、语法、发音、听写和专项练习；
- **Meaningful Input**：分级阅读、听力、视频/字幕与用户材料；
- **Meaningful Output**：AI 语音对话、口语复述、写作和情境表达；
- **Memory & Progress**：间隔复习、错误追踪、能力评估和长期数据。

核心理念：**课程提供方向，输入建立语言经验，刻意练习解决薄弱点，输出检验是否会用，间隔复习帮助长期保留，数据负责调整下一步。**

## 1.2 目标用户

- 单一主要使用者：中文母语的成年英语学习者；
- 重新建立基础，不能默认其已经掌握初中/高中语法；
- 需要中文解释作为初级阶段支架；
- 希望以后能自然交流、阅读英文内容、使用英语处理工作和旅行场景；
- 未来可能参加 PTE Academic，但当前不能让考试技巧替代通用英语能力建设；
- 偏好有趣、友好、精致的界面，但不要做成低龄儿童游戏。

### 初始学习者档案建议值

这些是首次启动时的预填信息，不是诊断结论：

- 母语：简体中文；
- 学习目标：General English；
- 起始推荐诊断区间：Pre-A1 / A1 边界；
- 自述学习材料背景：正在学习《新概念英语》第一册，约第 13 课附近；
- 自估词汇量：约 1,000 个，但必须通过词汇诊断验证；
- 主要问题：基础语法和听说自动化不足，历史知识可能遗忘；
- 目标模式：长期稳定学习，不追求短期刷分。

不得把上述信息自动当成 CEFR A1、A2 或其他正式级别。诊断之后按听、说、读、写、词汇、语法分别记录当前水平和置信度。

## 1.3 产品目标

### 核心目标

1. 用户每天打开网站，都能快速知道今天最值得做什么。
2. 用户能完成 10、20、30、45 或 60 分钟的学习计划。
3. 学习任务既有系统课程，也有复习、阅读、听力和实际输出。
4. AI Tutor 能根据学习者真实水平控制语速、词汇、语法复杂度和中文辅助比例。
5. 每次练习都形成可追踪的数据，并影响之后的内容推荐。
6. 学习者能明确看到“哪些内容会认、哪些内容会用、哪些内容已经长期掌握”。
7. PTE 专区在基础达到适当阶段后启用，不干扰日常学习主线。

### 非目标（首版不做）

- 不做公开社区、好友排行榜、教师班级管理和多租户 SaaS；
- 不做复杂商城、付费订阅和广告；
- 不承诺 AI 模拟的 PTE 分数等同 Pearson 官方成绩；
- 不内置未经授权的商业教材全文、影视字幕库或整本电子书；
- 不以大规模微服务、Kubernetes、复杂消息队列为首版基础；
- 不把连续打卡天数、金币和排行榜当作学习成果。

## 1.4 产品成功指标

优先衡量学习质量，而不只是活跃度：

- 计划学习完成率；
- 到期复习完成率；
- 7/30/90 天延迟回忆表现；
- 新词汇的被动识别与主动产出差距；
- 阅读/听力理解正确率和难度适配情况；
- 口语任务完成率、可理解度趋势、停顿和自我修正趋势；
- 写作中的重复错误减少情况；
- 每个 CEFR can-do 目标的证据数量与置信度；
- 学习者实际投入时间和学习后的保持情况。

**不要把“新学了多少词”单独作为进步指标。**

---

# 2. 学习科学与教学设计

所有理念都必须映射到具体交互、练习和数据模型。不要只在 About 页面写“科学学习”。

## 2.1 课程总框架：CEFR + Can-do Descriptors

以 Council of Europe 的 CEFR Companion Volume 为主框架，覆盖 Pre-A1、A1、A2、B1、B2、C1、C2。每个级别不是单纯词汇量标签，而是由具体可观察的能力描述组成。

能力至少按以下维度拆分：

1. Listening comprehension；
2. Reading comprehension；
3. Spoken production；
4. Spoken interaction；
5. Written production；
6. Written interaction；
7. Mediation / 信息转述与解释；
8. Phonological control / 发音可理解度；
9. Vocabulary range and control；
10. Grammatical accuracy and control。

每个学习目标必须包含：

- `can_do_id`；
- 级别；
- 技能维度；
- 目标描述（中文和英文）；
- 前置能力；
- 练习证据类型；
- 通过标准；
- 置信度；
- 最近一次验证时间。

CEFR 级别是能力描述框架，不应被误解成“每个人达到同一等级必须掌握固定词数”。

## 2.2 四条学习主线（Nation's Four Strands）

课程时间与任务需覆盖四条主线：

| 主线 | 含义 | 产品中的实现 |
|---|---|---|
| Meaning-focused Input | 以理解意义为主的输入 | 分级阅读、故事、听力、对话、视频字幕 |
| Meaning-focused Output | 以表达意义为主的输出 | AI 对话、口头复述、写作、情境任务 |
| Language-focused Learning | 对语言形式进行有意识学习 | 词汇卡、语法讲解、音标、发音、句型训练 |
| Fluency Development | 使用已学内容提高流利度 | 重复朗读、限时复述、重复对话、快速阅读 |

可把四条主线作为长期课程设计的平衡参考，但不要机械要求每周恰好各占 25%。初级阶段可增加语言形式的明确教学，高阶阶段增加输入、输出和流利度任务。

## 2.3 间隔重复与主动回忆

### 设计要求

- 使用 `ts-fsrs`（FSRS）作为词汇和知识卡片的间隔调度器，开始前核对当前文档、Node 要求和 API 版本。
- 每次复习必须写入不可覆盖的 `review_log`，包括时间、卡片类型、评分、用时、提示使用情况和答案结果。
- 用户可以区分“认识/理解”与“能主动说出/写出”。
- 不要只用英译中选择题作为掌握证据。
- 同一个单词可有不同训练卡：英→义、义→英、听音识别、拼写、语境填空、搭配回忆；首版按需生成，不要一词自动制造十几张卡。
- 避免同一词的多个兄弟卡在同一轮密集轰炸；同组卡可采用 sibling bury 或间隔展示。

### 初始卡片评分

| 评分 | UI 标签 | 含义 |
|---|---|---|
| Again | 忘记了 | 无法回忆或答案错误 |
| Hard | 很吃力 | 正确但提示较多、反应很慢或不确定 |
| Good | 记得 | 独立正确回忆 |
| Easy | 很轻松 | 快速、独立、稳定正确 |

具体调度交给 FSRS，不自行复制算法公式。应用层负责把用户答案转化成可靠评分，并保留原始 review log。

### 复习反馈

回答错误时：

1. 先呈现正确答案；
2. 提供一个最简短的解释或例句；
3. 允许立即再试一次，但不要把立即重试算作延迟记忆成功；
4. 按 FSRS 规则安排后续复习；
5. 对连续多次失败的卡片标记为困难项，建议换例句或拆解知识点。

## 2.4 词汇知识的多维度模型

参考 Paul Nation 的词汇知识框架。一个单词不是只有“英文拼写 + 中文意思”。需要分别记录：

- Word form：拼写、词形变化、音节；
- Pronunciation：IPA、音频、重音；
- Meaning：核心义、常见义项、语境含义；
- Use：语法行为、词性、及物/不及物等；
- Collocation：常见搭配；
- Register：正式、非正式、口语、书面语；
- Word family：派生词和屈折变化；
- Example：自然例句；
- Receptive mastery：看到/听到能理解；
- Productive mastery：能主动说出/写出。

词汇状态至少区分：`new`、`learning`、`receptive_known`、`productive_developing`、`productive_known`、`difficult`、`suspended`。

词汇不必每次都展示大量信息。初级卡片先展示最重要的核心义、发音、一个例句；展开后再看搭配和其他义项。

## 2.5 可理解输入与 i+1

阅读、听力和 AI 对话内容要略高于当前能力，但仍能理解主要信息。难度依据多项信号判断：

- CEFR 标签；
- 词汇覆盖率与未知词密度；
- 句长和从句数量；
- 语速、清晰度与口音；
- 语法结构；
- 用户最近的理解正确率；
- 用户是否频繁查词、暂停或重放。

**禁止**只按“文章标注 A2”就认定所有 A2 用户都适合。要允许用户调低/调高难度。

### 阅读难度调节

- 简化词汇，但尽量保留自然表达；
- 把复杂句拆分成可选的句子结构讲解；
- 初级阶段允许逐句中译；
- 中级减少逐句翻译，转为关键词提示；
- 高级默认全英文注释；
- 点击单词显示简洁释义、音标、发音和例句；
- 将用户主动查询的词加入词汇库，但提供“只查不收藏”选项。

### 听力难度调节

- 可选择 0.75×、0.85×、1.0×、1.1×、1.25×、1.5×；
- 变速应尽量保持音调自然；
- 可按句循环、按段循环、逐句播放；
- 默认先听后看文本，用户可随时揭示 transcript；
- 字幕可切换：隐藏、英文、中文辅助、双语；
- 允许设置是否显示音节/词级时间轴，但不能强迫初级用户一开始做纯听写。

## 2.6 主动输出与反馈

每个单元至少有一个真实输出任务。例：

- 自我介绍；
- 描述图片；
- 说出一天的安排；
- 讲述过去发生的事情；
- 表达观点并解释原因；
- 复述听到的内容；
- 书面回复一封邮件。

反馈顺序：

1. **Meaning**：对方是否理解了你的意思；
2. **One priority fix**：优先纠正最影响理解或当前教学目标的一个错误；
3. **Natural alternative**：给一个更自然的表达；
4. **Retry**：让用户再说/再写一次；
5. **Transfer**：换一个新情境再使用同一结构。

不要每次纠正所有细小错误，以免认知负荷过高。可在“详细反馈”里展开全部错误。

## 2.7 认知负荷与多媒体原则

- 一个页面有一个明确主任务；
- 复杂内容拆成可控步骤；
- 音频、文本和解释在视觉上靠近；
- 关键文字用颜色、粗体或标记突出，但不要过度装饰；
- 不要在阅读任务旁同时播放干扰性动画；
- 用户可暂停、重播、调整节奏；
- 动画遵守 `prefers-reduced-motion`；
- 初级课先教关键术语，再进入复杂图解；
- 避免将同一段文字同时完整呈现为字幕和额外朗读说明，除非任务目标需要。

## 2.8 交错练习、检索练习和错误本

- 混合复习旧词、新词、语法和听力识别，但不要随机到毫无教学逻辑；
- 错题要关联知识点和错误类型，而不只是存一个“错误答案”；
- 相同错误重复出现时，生成一个小型补救任务；
- 补救后在不同语境中再次测试，检验迁移；
- 让学习者在测验前尽量先回忆，再看答案。

## 2.9 学习时长建议

首次 onboarding 让用户选择每周目标和单次时长，但可随时调整。默认推荐：

- 15 分钟：到期复习 + 一小段输入；
- 25 分钟：复习 + 一节短课；
- 40 分钟：复习 + 课程 + 输出练习；
- 60 分钟：复习 + 课程 + 输入 + 口语/写作。

不要因为一天没完成就用羞辱性提示、红色警告或“学习失败”措辞。使用温和恢复机制：`Welcome back. Let's pick up where you left off.`

---

# 3. 课程体系与内容蓝图

## 3.1 七级课程架构

| 等级 | 阶段目标 | 课程内容重点 |
|---|---|---|
| Pre-A1 | 建立英语声音、文字和最基础表达的对应关系 | 字母、音素意识、基本词汇、课堂指令、固定表达、极短句 |
| A1 | 能完成简单、熟悉的日常交流 | 自我介绍、家庭、时间、日常活动、购物、地点、基础问答 |
| A2 | 能处理常见生活情境和简短叙述 | 过去经历、计划、比较、旅行、健康、工作日常、简单意见 |
| B1 | 能在熟悉主题上独立交流并表达理由 | 叙事、观点、问题解决、新闻主旨、工作沟通、较长文本 |
| B2 | 能进行较复杂的讨论与较自然的表达 | 抽象话题、论证、职场演示、学术/媒体材料、语域控制 |
| C1 | 能理解复杂长文本并灵活运用语言 | 学术/专业材料、细微语气、复杂论证、风格与修辞 |
| C2 | 能灵活精确地理解与表达复杂意义 | 高难度文本、隐含意义、修辞、语用、跨语境表达 |

## 3.2 Pre-A1 课程首发蓝图

首发必须真实制作并能学习，不可只有目录。建议至少包含以下 8 个 Unit：

1. **Meet English**：英语学习界面、学习方法、字母名称与大小写；
2. **Sounds & Letters**：字母音、常见字母组合、基础音节意识；
3. **Hello!**：问候、道别、礼貌用语；
4. **My Name Is...**：姓名、国籍、职业、自我介绍；
5. **Numbers Around Me**：数字、年龄、电话号码、价格；
6. **Things & People**：常见物品、家庭成员、单复数初识；
7. **Classroom English**：常用指令、请求重复、表达不懂；
8. **First Sentences**：主语 + be 动词 + 简单补语，肯定句、否定句和最基础问句。

每个 Unit 设计 3–5 个短课，并有复习、听力和口语任务。每课控制在 5–12 分钟的可分段内容。

## 3.3 A1 课程首发蓝图

至少包含以下主题：

1. Subject pronouns + be；
2. Basic word order；
3. Questions with be / do；
4. Articles a/an/the 初步；
5. Singular / plural nouns；
6. Possessives and family；
7. Present simple；
8. Frequency adverbs；
9. Time, dates and schedules；
10. There is / there are；
11. Prepositions of place and time；
12. Can / can't；
13. Present continuous；
14. Countable / uncountable nouns；
15. Some / any / much / many 基础；
16. Past simple 入门；
17. Going to plans；
18. Comparatives / superlatives；
19. Directions and transport；
20. Food, shopping, travel and everyday problem solving。

把语法放进交际场景，而不是让用户连续看二十节抽象语法讲义。

## 3.4 A2–C2 的课程设计方向

### A2

- past simple 与常见不规则动词；
- past continuous 初步；
- future plans 与预测；
- present perfect 入门；
- modals for advice / obligation / possibility；
- 比较、数量、频率与程度；
- 旅行、健康、工作、服务场景；
- 短篇故事和生活类听力。

### B1

- present perfect 与 past simple 对比；
- conditionals 0/1/2；
- relative clauses；
- passive 基础；
- reported speech 基础；
- phrasal verbs 高频用法；
- 讲述经历、解释原因、表达观点；
- 新闻、播客和分级读物。

### B2

- conditionals 与复杂时态；
- passive / reporting structures；
- discourse markers；
- collocations 与词汇搭配；
- hedging、立场与论证；
- 会议、演示、争论、学术阅读；
- 长篇听力、讲座笔记和总结。

### C1

- 复杂句法、信息结构和语域；
- 细微语义与语用差异；
- 学术写作和专业表达；
- 长篇访谈、讲座、政策/研究类文本；
- 反驳、让步、归纳与综合。

### C2

- 隐含意义、反讽、语体和修辞；
- 复杂专业文本；
- 高度精细的语义选择；
- 自然、准确、灵活的跨情境表达；
- 文学、专业辩论和复杂写作。

## 3.5 单课标准结构

每个课程步骤必须使用结构化 schema。标准课程可以包含：

1. `orientation`：这节课要解决什么问题；
2. `learning_objectives`：2–4 个可验证目标；
3. `warm_up`：简短激活旧知识；
4. `input`：例句、对话、短文或音频；
5. `notice`：观察语言规律；
6. `teach`：简明讲解与可选中文说明；
7. `guided_practice`：有支架的练习；
8. `retrieval_practice`：不看答案主动回忆；
9. `communicative_task`：真实场景输出；
10. `feedback`：错误分类、解释和重试；
11. `exit_ticket`：1–3 个离堂检查题；
12. `next_review`：关联知识点和复习任务。

并非每节课必须严格展示全部步骤。简单课可以合并，复杂课必须分段。课程的核心要求是从输入走向主动使用。

## 3.6 语法知识图谱

语法模块需支持：

- grammar point；
- 前置知识；
- 规则解释；
- 结构公式；
- 使用情境；
- 典型例句；
- 常见错误；
- 易混淆对比；
- 限制与例外；
- 对应练习；
- 对应 CEFR 能力；
- 对应课程和词汇。

初级中文讲解可以写清“为什么”，但英文例句和语境应优先。高阶逐步降低中文辅助。

## 3.7 初级语法顺序建议

1. 词序和基本句子概念；
2. 主语代词；
3. be 动词；
4. 肯定、否定和一般疑问句；
5. 名词单复数；
6. 冠词；
7. 所有格；
8. there is / are；
9. 一般现在时和 do/does；
10. 频率副词；
11. 介词；
12. can；
13. 现在进行时；
14. 过去式；
15. 未来表达；
16. 可数与不可数名词；
17. 比较级；
18. 常见连词和复合句入门。

课程排序可根据诊断结果调整，不要求线性全部走完后才进行阅读和口语。

---

# 4. 首次使用、诊断与个性化路径

## 4.1 Onboarding 流程

1. Welcome：解释产品如何学习，不做长篇营销；
2. 设置语言偏好：中文解释、英文解释、混合；
3. 设置目标：通用英语、日常交流、工作、旅行、考试（可多选）；
4. 每周目标：天数、每日时长；
5. 当前基础自评：完全入门 / 学过但忘了 / 能读简单内容 / 能日常交流；
6. 词汇快速诊断；
7. 语法诊断；
8. 阅读理解诊断；
9. 听力诊断；
10. 口语录音（可跳过）；
11. 写作短任务（可跳过）；
12. 生成个人学习画像和第一周计划。

每个诊断步骤允许暂停、跳过和稍后继续。不要强迫用户一次完成全部测评。

## 4.2 诊断规则

- 采用自适应或分层题库，避免对初学者连续出现高难题；
- 题目必须保存对应 CEFR、技能、知识点、难度和区分度；
- 只用一次小测不能推断完整 CEFR 等级；
- 对每项技能输出 `estimated_level` + `confidence` + `evidence_count`；
- 口语和写作需要保留样本，用户可以之后复测；
- 词汇诊断区分识别、释义回忆和主动产出；
- 如果测试题量不足，显示“初步估计”，不显示确定等级。

## 4.3 个人学习路径

生成动态计划，不是死板锁定课程目录。推荐逻辑优先级：

1. 到期复习；
2. 当前课程的前置知识缺口；
3. 当前单元核心任务；
4. 用户最近反复出错的知识点；
5. 至少一个意义输入任务；
6. 至少一个输出任务；
7. 用户兴趣主题。

用户可以手动覆盖推荐。学习系统不应通过连续弹窗强迫学习。

## 4.4 自适应策略

- 连续多次正确且反应稳定：提升材料难度或减少提示；
- 选择题正确但主动产出失败：增加句子生成和口语输出；
- 听力理解差但阅读强：增加短音频、慢速播放和听写；
- 阅读频繁查词：降低未知词密度；
- 同一个语法错误反复出现：生成针对性微课；
- 用户连续几天中断：恢复计划时减少当天任务量，不追赶式堆积；
- 任务完成率过低：优先缩短任务、减少新知识量。

推荐应能解释原因，例如“推荐这段听力，因为你最近能读懂类似内容，但听力识别仍不稳定”。

---

# 5. 功能模块详细规格

## 5.1 Home / Today Dashboard

首页是学习入口，不是复杂 BI 页面。

### 必须显示

- 今日推荐学习计划；
- 到期复习数量和预计耗时；
- 当前课程进度；
- 一个主要的“Start learning”按钮；
- 本周投入时间；
- 最近学会/需要巩固的内容；
- 学习路径中的下一步；
- 温和的连续学习提示（可关闭）。

### 首页交互

- 可切换 15 / 25 / 40 / 60 分钟模式；
- 可拖动或重新排序今日任务；
- 可以跳过某个任务，并选择原因；
- 支持“今天只复习”模式；
- 不要展示未经解释的综合分数。

## 5.2 Learning Path / Courses

- 展示 Pre-A1 到 C2 的路线图；
- 每个级别显示学习目标、课程单元、完成度和评估状态；
- 未通过的前置能力可显示建议，但不绝对禁止跳级；
- 用户能查看已完成、学习中、未开始和推荐复习的内容；
- 支持按技能、主题、CEFR、课程来源过滤；
- 课程内容来自数据库/seed 文件，不能硬编码在页面。

## 5.3 Lesson Player

### 布局

- 顶部：课程名称、进度、预计耗时、退出；
- 中央：当前学习步骤；
- 右侧或折叠区：词汇、语法提示和课程笔记；
- 底部：上一步、检查答案、下一步；
- 移动端改为单列布局。

### 行为

- 自动保存步骤状态；
- 离开页面可恢复；
- 每一步完成后写入 `lesson_step_attempt` 或学习事件；
- 不允许跳过必需测评后直接标记课程掌握；
- 支持文本、图片、音频、视频、题目、自由输入和口语录音步骤；
- 课程结束生成清晰总结：掌握、待复习、下一步。

## 5.4 Vocabulary Lab

### 功能

- 今日到期卡片；
- 新词学习；
- 词汇搜索；
- 词汇书/收藏夹；
- 自定义词表；
- 从阅读、听力、字幕、AI 对话中采集单词或词组；
- 例句和搭配；
- 发音播放；
- 英→义、义→英、听音识别、拼写、语境填空等卡片模板；
- 批量导入 CSV/TSV；
- 导出词汇、复习状态和历史日志。

### 每个词条字段

`lemma`、`part_of_speech`、`sense`、`definition_en`、`definition_zh`、`ipa`、`audio_asset`、`example_en`、`example_zh`、`collocations`、`word_family`、`register`、`cefr_level`、`frequency_band`、`source`、`source_sentence`。

### 词汇学习统计

分别显示：

- 新增词条；
- 被动识别稳定度；
- 主动回忆稳定度；
- 到期/逾期复习；
- 高频困难词；
- 最近 7/30/90 天保留率。

## 5.5 Grammar Studio

- 语法地图；
- 按 CEFR/主题/先修知识筛选；
- 交互式句子拆解；
- 对比易混语法；
- 结构可视化（主语、谓语、宾语、补语、时间/地点状语）；
- 选择题、改错题、排序题、填空题、造句题；
- 根据错题生成专项微课；
- 每个语法点能看到“我在什么课程学过”和“我最近在哪里用错”。

## 5.6 Reading Room

- 内置分级文章；
- AI 生成原创文章；
- 用户导入文章；
- 句子级点击和词汇提示；
- 阅读难度提示；
- 阅读时长和理解练习；
- 文章摘要；
- 关键信息定位；
- 句子结构分析；
- 生词加入词汇库；
- 可切换中英辅助；
- 支持阅读笔记和收藏。

AI 生成文章必须有质量检查：词汇级别、语法级别、事实合理性、目标词使用、文本是否自然。涉及事实的文章必须区分虚构故事和事实说明。

## 5.7 Listening Studio

- 音频播放器；
- 波形或简洁进度条；
- 逐句/逐段循环；
- 变速；
- A-B 循环；
- 隐藏/显示 transcript；
- 英文字幕、中文辅助和双语字幕；
- 逐句听写；
- 关键词听辨；
- 跟读录音；
- 影子跟读；
- 重点句收藏；
- 音频来源与级别标记。

没有时间戳的文本不可假装具备精准逐词高亮。时间戳缺失时退化为逐句显示。

## 5.8 Pronunciation Lab

- IPA 音标表；
- 辅音/元音分类；
- 发音位置和口型示意；
- 单词重音、句子重音、节奏、弱读、连读和语调；
- 最小对立体（minimal pairs）；
- 标准音频播放；
- 用户录音与参考音频对比；
- 可选语音识别反馈。

反馈要面向可理解度，不要求用户达到某种“母语者口音”。对语音分析能力不足的 Provider，必须说明其置信度，不能伪造音素级分数。

## 5.9 AI Tutor

AI Tutor 是教学服务，不是普通开放聊天页。

### 模式

- Explain：解释一个语法、词汇或表达；
- Practice：针对某知识点提问；
- Conversation：按主题自由对话；
- Roleplay：旅行、购物、工作、问路、电话、面试等场景；
- Correct my sentence：纠错和自然表达；
- Ask me questions：由 AI 主动提问；
- Review with me：复习用户最近学过的知识；
- Reading coach：辅助阅读当前文章；
- Listening coach：帮助分析听力片段。

### 个性化规则

AI 必须读取当前学习者档案、CEFR 分项估计、最近课程、目标词汇和用户设置，但只传递完成任务所需的最少上下文。

默认策略：

- Pre-A1/A1：短句、常用词、一次一个问题、必要时中文解释；
- A2：简单英文为主，难点中文辅助；
- B1：大部分英文，复杂语法允许中文解释；
- B2：英语为主，中文解释默认关闭；
- C1/C2：自然英语讨论，聚焦表达精度、语域与隐含意义。

### AI Tutor 回复格式

教学模式优先使用结构化 JSON：

```json
{
  "response_text": "...",
  "level_adaptation": "A1",
  "correction": {
    "original": "...",
    "corrected": "...",
    "explanation_zh": "...",
    "explanation_en": "..."
  },
  "new_vocabulary": [],
  "follow_up_question": "...",
  "suggested_practice": []
}
```

字段可为空。普通对话模式可以自然文本输出，但仍必须记录会话元数据和用户允许保存的学习证据。

## 5.10 Speaking / Voice Lab

### 首选交互方式

浏览器端 WebRTC 连接实时语音模型。服务端创建短时效 ephemeral credential/session，前端不接触长期 API Key。AI 语音会话层必须和课程、用户记录及评价层分离。

### 会话流程

1. 用户查看任务说明和目标；
2. 检查麦克风权限；
3. 显示连接、聆听、思考、说话、结束状态；
4. 用户可以打断 AI；
5. 记录双方 transcript（先告知用户）；
6. 结束后生成简短反馈；
7. 用户可以重听、查看逐轮转录或删除录音；
8. 若 Provider 不支持保存音频，仍应保存可选文本转录和任务结果。

### 口语任务类型

- Read Aloud；
- Repeat Sentence；
- Picture Description；
- Short Answer；
- Guided Conversation；
- Story Retelling；
- Daily Situation Roleplay；
- Opinion / Reasoning；
- PTE 专项口语任务。

### 反馈维度

- Task completion；
- Comprehensibility；
- Fluency / pauses / rate；
- Grammar；
- Vocabulary range and appropriateness；
- Pronunciation features（仅在模型可靠支持时）；
- Self-correction；
- CEFR-aligned communication evidence。

不得把自动语音评分表述成官方 PTE 评分，也不得因口音不同直接扣分。

### 低配和网络不稳定的降级方案

如果实时 WebRTC 不可用，切换到链式流程：浏览器录音 → STT 转录 → 文本模型反馈 → TTS 播放。UI 显示这是“标准语音模式”，不要假装实时语音仍可用。

## 5.11 Writing Studio

- 句子改写；
- 日记；
- 描述图片；
- 邮件；
- 短文；
- 观点表达；
- 摘要；
- PTE 写作任务。

AI 批改必须分层显示：

1. 任务完成度；
2. 主要内容是否清楚；
3. 语法错误；
4. 词汇和搭配；
5. 句子组织与衔接；
6. 自然表达建议；
7. 用户自己的第二版。

不默认直接把用户文章重写成高级范文。先纠正最重要的问题，再给可选示范。

## 5.12 Error Notebook

错误条目包含：

- 原始错误；
- 建议修正；
- 错误类别；
- 关联知识点；
- 首次/最近出现时间；
- 出现次数；
- 纠正后是否复现；
- 补救练习；
- 用户备注。

错误分类至少有：词形、词序、时态、主谓一致、冠词、介词、拼写、搭配、发音、听辨、语用、语义理解、任务理解。

## 5.13 PTE Preparation Center

PTE 是专项区域，不取代通用英语主课程。其题型结构和评分规则可能变化，必须以 Pearson 官方页面为基准，按 `exam_version` 保存来源和生效日期。

截至本规格日期，官方页面展示的 PTE Academic 题型包括：

**Speaking & Writing（9 类）**

- Read Aloud；
- Repeat Sentence；
- Describe Image；
- Retell Lecture；
- Answer Short Question；
- Summarize Group Discussion；
- Respond to a Situation；
- Summarize Written Text；
- Write Essay。

**Reading（5 类）**

- Fill in the Blanks (Dropdown)；
- Multiple Choice, Multiple Answers；
- Re-order Paragraph；
- Fill in the Blanks (Drag and Drop)；
- Multiple Choice, Single Answer。

**Listening（8 类）**

- Summarize Spoken Text；
- Multiple Choice, Multiple Answers；
- Fill in the Blanks (Type In)；
- Highlight Correct Summary；
- Multiple Choice, Single Answer；
- Select Missing Word；
- Highlight Incorrect Words；
- Write from Dictation。

页面和练习实现时，必须重新核对官方最新题型和时间/评分规则，不得把上述列表视为永久不变。

### PTE 功能

- 题型介绍和示范；
- 题型训练；
- 计时器；
- 录音和文本输入；
- 题目答案与解析；
- 错题本；
- 技能交叉影响说明；
- 模拟练习；
- 学习计划；
- 练习趋势。

### PTE 评分边界

- 单选/客观题可以精确判定；
- 自由口语/写作只能提供 AI 辅助反馈与估计；
- 不得声称 AI 估分等同 Pearson 正式成绩；
- 不应使用不透明的“AI 预测 79 分”作为核心卖点；
- 必须把 AI feedback 与官方评分标准/官方题型说明分开展示；
- 题目素材必须原创、自制或明确获准使用。

## 5.14 Content Importer

首版支持：

- 粘贴文本；
- TXT；
- Markdown；
- SRT/VTT 字幕；
- CSV/TSV 词表；
- 常见音频文件（实际格式取决于服务端转码能力）。

后续可扩展 PDF/EPUB，但应先验证解析、版权和扫描文档支持情况。

导入流程：

1. 选择来源类型；
2. 选择导入用途：阅读、听力、词汇、语法或自定义材料；
3. 预览解析结果；
4. 选择自动分段和语言；
5. AI 分析级别、词汇和语法；
6. 用户确认后保存；
7. 来源和版权状态写入记录。

必须尊重版权：不提供绕过付费、DRM 或访问控制的功能；不内置未经许可的整本教材和字幕。用户导入材料只供个人使用，不公开分享。

## 5.15 Progress & Analytics

显示真正有意义的图表：

- CEFR 各技能分项趋势；
- 词汇被动/主动掌握差距；
- 到期复习与保留率；
- 阅读难度与理解率；
- 听力重放次数与理解率；
- 语法薄弱点；
- 口语流畅度与任务完成情况；
- 写作错误类别变化；
- 每周输入/输出/刻意学习/流利度时间分布。

数据解释必须注明：趋势是学习记录，不是官方 CEFR 认证。避免把不同模型的分数拼成一个毫无解释的“英语 IQ”。

---

# 6. UI/UX 与视觉设计系统

## 6.1 视觉方向

**Playful Learning Studio：有趣、轻松、明亮、现代、精致，绝不幼稚。**

融合：

- 现代教育产品的清晰信息架构；
- 柔和的插画和学习主题图形；
- 温暖的色彩、圆角卡片和轻量动效；
- 专业工具的排版、对齐、留白和键盘可访问性。

不要复制 Duolingo 的猫头鹰、品牌形象、布局或文案。可以有原创的小型“成长伙伴”视觉元素，但不能让吉祥物占据整个学习界面。

## 6.2 色彩令牌（建议初始值）

| Token | Light | 用途 |
|---|---|---|
| `--bg` | `#F7F8FC` | 全局背景 |
| `--surface` | `#FFFFFF` | 主卡片 |
| `--surface-soft` | `#F0F2FA` | 次级卡片/输入区 |
| `--ink` | `#25283A` | 主文字 |
| `--muted` | `#73788C` | 次级文字 |
| `--primary` | `#6257D9` | 主操作、品牌紫 |
| `--primary-soft` | `#ECEAFF` | 淡紫背景 |
| `--blue` | `#5B9BEB` | 阅读/信息 |
| `--mint` | `#51B99A` | 成功/掌握 |
| `--coral` | `#F18A78` | 鼓励/提示 |
| `--yellow` | `#F4C75E` | 待复习/关注 |
| `--border` | `#E7E9F1` | 边框 |

深色模式需建立完整配色，不能只把白色变黑。颜色不能单独承载成功/失败信息，同时使用文案或图标。

## 6.3 字体

- 英文 UI：Inter 或 Geist Sans；
- 中文 UI：系统中文字体栈，例如 Noto Sans SC / PingFang SC / Microsoft YaHei；
- 阅读文章：可选择易读的衬线字体（如 Georgia）作为阅读模式；
- 数字和数据采用清晰的 tabular numbers；
- 保证 IPA、音标、重音符号和特殊字符正常显示。

## 6.4 形状与动效

- 卡片圆角：16–22px；
- 按钮圆角：12–14px；
- 输入控件高度：44px 起；
- 采用轻阴影、细边框、明确层级；
- 动效以 120–240ms 为主，优先表现状态变化；
- 动画不能阻碍朗读、听力和答题；
- 支持 `prefers-reduced-motion`；
- 学习完成时可有轻量庆祝动效，但不应有强制全屏庆祝。

## 6.5 布局

### 桌面端

- 左侧固定/可折叠主导航（约 240px）；
- 中央内容区最大宽度约 1200px；
- 学习页面可使用右侧辅助面板；
- 首页采用 12 栅格或合理的响应式卡片布局；
- 阅读/听力内容区域优先保证可读宽度。

### 移动端

- 顶部简洁标题栏；
- 底部 4–5 项主导航或抽屉导航；
- 课程步骤单列；
- 播放控制保持可触达；
- 重要操作有足够点击区域；
- 不允许出现横向溢出；
- 语音会话界面要适配窄屏。

## 6.6 主导航建议

1. Today；
2. Learn；
3. Practice；
4. AI Tutor；
5. Progress。

子导航：

- Learn：Learning Path、Vocabulary、Grammar、Reading、Listening、Pronunciation；
- Practice：Review、Speaking、Writing、Error Notebook、PTE；
- Settings：Profile、Study Plan、AI Providers、Data & Backup、Appearance。

## 6.7 关键页面列表

- `/login` 登录；
- `/setup` 首次初始化；
- `/today` 今日首页；
- `/onboarding` 新用户设置；
- `/assessment` 水平诊断；
- `/learn/path` 学习路径；
- `/learn/levels/[level]` 等级详情；
- `/learn/units/[unitId]` 单元详情；
- `/lesson/[lessonId]` 课程学习器；
- `/vocabulary` 词汇中心；
- `/review` 复习工作台；
- `/grammar` 语法中心；
- `/reading` 阅读中心；
- `/reading/[contentId]` 阅读器；
- `/listening` 听力中心；
- `/listening/[contentId]` 听力播放器；
- `/pronunciation` 发音实验室；
- `/tutor` AI Tutor；
- `/speaking` 口语训练；
- `/writing` 写作训练；
- `/errors` 错误本；
- `/pte` PTE 中心；
- `/pte/practice/[taskType]` PTE 练习；
- `/progress` 学习数据；
- `/library` 用户导入材料；
- `/settings` 设置。

## 6.8 组件规范

建立统一组件：

- `AppShell`、`Sidebar`、`MobileNav`；
- `PageHeader`、`SectionHeader`；
- `LearningCard`、`CourseCard`、`LevelBadge`；
- `SkillProgressCard`、`ProgressRing`；
- `LessonStepRenderer`；
- `Flashcard`、`ReviewRatingBar`；
- `AudioPlayer`、`TranscriptPanel`；
- `SpeakingSessionPanel`、`MicPermissionState`；
- `VocabularyPopover`；
- `GrammarDiagram`；
- `ExerciseRenderer`；
- `FeedbackPanel`；
- `EmptyState`、`ErrorState`、`LoadingSkeleton`；
- `ConfirmDialog`、`Toast`。

统一处理：loading、empty、error、success、disabled、keyboard focus 和 mobile state。

## 6.9 文案语气

- 友善、清楚、尊重成年人；
- 不使用羞辱、威胁和过度幼稚的语气；
- 用“还不稳定”“值得再练一次”替代“失败”；
- 英文教学句子短而自然；
- 初级阶段关键说明提供中文；
- 不夸大 AI 的准确性。

## 6.10 可访问性

目标 WCAG 2.2 AA：

- 完整键盘操作；
- 可见焦点；
- 文本与背景足够对比；
- 表单具有 label；
- 音频提供 transcript；
- 视频提供字幕/文本替代；
- 图片有合适 alt；
- 不仅靠颜色传达状态；
- 动画可减少；
- 语音功能不作为唯一完成路径，必须提供文本替代方案。

---

# 7. 技术架构（已定案）

## 7.1 总体决策：模块化单体

本项目是个人私有部署产品，首版采用：

- **Web 应用**：Next.js App Router + React + TypeScript；
- **运行时**：Node.js 24 LTS（实现时确认官方兼容矩阵）；
- **样式**：Tailwind CSS；
- **组件**：shadcn/ui + Radix UI（按需取用并统一主题）；
- **图标**：Lucide；
- **动效**：Motion（或当前稳定的 Framer Motion 后继包），克制使用；
- **表单校验**：Zod + React Hook Form；
- **数据库**：PostgreSQL；
- **ORM**：Drizzle ORM + drizzle-kit migrations；
- **复习调度**：`ts-fsrs`；
- **图表**：Recharts（仅用于有解释价值的数据）；
- **测试**：Vitest + Playwright；
- **容器**：Docker Compose；
- **AI**：Provider Adapter，首个 Provider 实现 OpenAI；
- **语音**：浏览器 WebRTC 实时语音，失败时降级到 STT → LLM → TTS 链式方案；
- **文件存储**：首版 Docker 持久化卷本地存储，抽象 `StorageProvider` 以便未来改 S3 兼容存储。

不引入 Python/FastAPI 后端，不拆分微服务。所有应用业务逻辑集中在 Next.js 的服务端模块中，前端通过 Server Actions 或 Route Handlers 调用。

## 7.2 模块边界

建议目录：

```text
src/
  app/
    (auth)/
    (app)/
    api/
  components/
    ui/
    layout/
    learning/
    vocabulary/
    grammar/
    media/
    tutor/
    analytics/
  modules/
    auth/
    learner/
    curriculum/
    lessons/
    assessment/
    vocabulary/
    review/
    grammar/
    reading/
    listening/
    speaking/
    writing/
    pte/
    content-import/
    analytics/
  lib/
    ai/
    audio/
    storage/
    validation/
    security/
    config/
  db/
    schema/
    migrations/
    seed/
  styles/
  types/
  hooks/
  test/
```

模块内部建议分为：`domain`、`services`、`repositories`、`schemas`、`actions`。不要为小项目建立过度抽象的 Clean Architecture 层级；但业务规则不能直接写进 UI 组件。

## 7.3 服务端与客户端原则

- 默认使用 React Server Components；
- 只有交互、音频、播放器、计时器、图表等组件才使用 Client Components；
- 数据读写集中在服务端服务层；
- Route Handler 处理需要流式响应、第三方回调、上传和 WebRTC 会话协商的 API；
- Server Actions 用于普通表单和简单变更；
- 所有输入由 Zod 校验；
- 所有数据库查询都必须按当前 owner/user 范围过滤；
- 不得让浏览器直接连接 PostgreSQL。

## 7.4 认证与用户模式

首版为单用户私有部署：

- 首次启动无 owner 时显示 `/setup`；
- 用户创建一个 owner 账户；
- 密码使用经过审计的 Argon2id/bcrypt 实现哈希；
- 使用成熟 session 方案（优先 Auth.js Credentials 或同等成熟方案），不要自制不安全的 session；
- 登录 cookie：HttpOnly、Secure（HTTPS）、SameSite=Lax；
- 默认关闭公开注册；
- 提供管理员/owner 可更换密码和注销全部会话；
- 以后可扩展多用户，但首版不要建设租户管理后台。

## 7.5 数据库

PostgreSQL 为唯一权威持久化存储。使用 Drizzle schema 与 migrations 管理。所有时间使用 UTC 存储，界面按用户时区显示。学习事件写入时间必须使用服务端时间，客户端时间仅作辅助元数据。

不强制首版安装 Redis。后台任务和提醒优先由 PostgreSQL/应用内轻量机制完成；只有明确出现并发任务、定时任务或吞吐需求后再引入 Redis/队列。

## 7.6 AI Provider Adapter

设计统一接口，例如：

```ts
export interface AIProvider {
  generateText(input: TextGenerationInput): Promise<TextGenerationResult>;
  streamText?(input: TextGenerationInput): AsyncIterable<TextDelta>;
  transcribe?(input: TranscriptionInput): Promise<TranscriptionResult>;
  synthesizeSpeech?(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult>;
  createRealtimeSession?(input: RealtimeSessionInput): Promise<RealtimeSessionCredential>;
  evaluateSpeaking?(input: SpeakingEvaluationInput): Promise<SpeakingEvaluation>;
  evaluateWriting?(input: WritingEvaluationInput): Promise<WritingEvaluation>;
}
```

接口只是业务契约；具体字段由实现时定义并通过 Zod 校验。不得把某个 Provider 的原始响应直接泄漏到业务层。

### Provider 设置

- `AI_PROVIDER`；
- `AI_API_KEY`；
- `AI_BASE_URL`（可选，仅允许可信配置）；
- `AI_TEXT_MODEL`；
- `AI_REALTIME_MODEL`；
- `AI_TRANSCRIPTION_MODEL`；
- `AI_TTS_MODEL`；
- `AI_TIMEOUT_MS`；
- `AI_MAX_OUTPUT_TOKENS`；
- `AI_MONTHLY_BUDGET`（软限制）；
- `AI_ENABLED`。

密钥只能从服务端环境变量读取。前端只接收短时效的 ephemeral credential 或服务端代理结果。

### 成本控制

- 低难度教学优先用成本较低的文本模型；
- 生成课程内容可批量生成、审核、缓存；
- 不要对每次点击都调用 LLM；
- 用户可关闭 AI 语音和高成本模型；
- 每种 AI 请求记录 provider、model、任务类别、耗时和 token/费用估算（不记录 API Key）；
- 设置单日/单月软预算与超限提醒；
- 对重复生成请求做缓存或去重。

## 7.7 实时语音架构

### 首选流程

1. 浏览器请求创建语音会话；
2. 服务端验证 owner、额度、任务权限；
3. 服务端向 Provider 创建短时效凭证；
4. 浏览器通过 WebRTC 建立媒体连接；
5. 语音和 transcript 事件到达客户端；
6. 任务状态和必要 transcript 写入数据库；
7. 会话结束后调用评价服务。

### 安全要求

- 长期 API Key 永不下发浏览器；
- ephemeral credential 必须短时效、单用途；
- 对会话创建接口限流；
- 麦克风权限由浏览器管理；
- 录音保存前告知用户；
- 提供删除会话和录音功能；
- 语音服务失败可降级；
- 对网络中断、麦克风拒绝、Provider 超时进行明确处理。

## 7.8 文件存储

首版目录建议挂载到 `/app/data`：

- `/app/data/uploads`：用户导入材料；
- `/app/data/audio`：录音或生成音频；
- `/app/data/cache`：可重建缓存。

文件名使用 UUID，不使用用户原始文件名作为存储路径。数据库记录原始名称、MIME、大小、哈希、创建时间和 owner。上传前校验扩展名、MIME、文件大小；禁止执行上传文件。

## 7.9 Docker Compose

最少两个服务：

- `app`：Next.js 应用；
- `db`：PostgreSQL。

要求：

- `db` 有 healthcheck；
- app 等待 DB 健康后执行 migrations；
- 使用命名 volume 持久化数据库和用户文件；
- `.env` 不提交 Git；
- `.env.example` 列全变量并注明必填/可选；
- 生产构建采用多阶段 Dockerfile；
- 容器以非 root 用户运行；
- 只暴露应用端口，数据库端口默认不对公网暴露；
- 支持用户自定义端口；
- 提供 `docker compose up -d`、升级、日志和备份说明；
- 不把数据库数据写在容器可写层。

### 必需环境变量示例

```dotenv
NODE_ENV=production
APP_URL=http://localhost:3000
APP_SECRET=replace-with-long-random-secret
DATABASE_URL=postgresql://lingua:change-me@db:5432/linguabloom
OWNER_SETUP_ENABLED=true
AI_ENABLED=false
AI_PROVIDER=openai
AI_API_KEY=
AI_TEXT_MODEL=
AI_REALTIME_MODEL=
AI_TRANSCRIPTION_MODEL=
AI_TTS_MODEL=
STORAGE_ROOT=/app/data
DEFAULT_LOCALE=zh-CN
DEFAULT_TIMEZONE=Asia/Shanghai
LOG_LEVEL=info
```

注意：部署到 HTTPS 域名后更新 `APP_URL`、cookie Secure、反向代理可信设置和 CORS/Origin allowlist。`OWNER_SETUP_ENABLED` 初始化后应自动关闭或由用户显式关闭。

---

# 8. 数据模型设计

所有表使用 UUID 主键（或稳定可迁移的 ID），设置合理外键和索引。以下是逻辑模型，不是要求逐字使用这些字段名称。

## 8.1 用户与个人档案

### `users`

- id；
- email / username；
- password_hash；
- role（owner）；
- created_at、updated_at、last_login_at。

### `learner_profiles`

- user_id；
- native_language；
- preferred_explanation_language；
- timezone；
- self_reported_level；
- learning_goals JSON；
- preferred_accent（可选）；
- onboarding_completed_at；
- profile_notes。

### `study_preferences`

- daily_minutes；
- weekly_days；
- review_limit；
- new_items_limit；
- bilingual_mode；
- audio_speed；
- dark_mode；
- reminders_enabled。

## 8.2 CEFR 与课程内容

### `cefr_descriptors`

- id；
- level；
- skill_domain；
- descriptor_code；
- description_en；
- description_zh；
- source_reference；
- source_version。

### `courses`

- id；
- title；
- description；
- language；
- course_type；
- source；
- status（draft/reviewed/published/archived）。

### `levels` / `units` / `lessons` / `lesson_steps`

- `levels`：CEFR level、顺序、描述；
- `units`：course_id、level_id、主题、学习目标；
- `lessons`：unit_id、顺序、CEFR、预计时长、先修课；
- `lesson_steps`：lesson_id、step_type、order、content JSON、required、assessment flag。

内容 JSON 必须符合版本化 schema，保存 `content_schema_version`。

### `learner_lesson_progress`

- user_id、lesson_id；
- status；
- current_step_id；
- started_at、completed_at；
- completion_ratio；
- mastery_estimate；
- updated_at。

## 8.3 词汇与复习

### `vocabulary_entries`

- lemma；
- language；
- part_of_speech；
- ipa；
- cefr_level；
- frequency_band；
- definition_en；
- definition_zh；
- usage_notes；
- source_id。

### `vocabulary_senses`

- vocabulary_entry_id；
- sense_order；
- definition_en；
- definition_zh；
- example_en；
- example_zh；
- register。

### `vocabulary_relations`

- source_entry_id；
- target_entry_id；
- relation_type（collocation/word_family/synonym/antonym/confusable）。

### `user_vocabulary`

- user_id；
- vocabulary_entry_id；
- status；
- first_seen_at；
- added_from；
- personal_note；
- receptive_mastery；
- productive_mastery。

### `review_cards`

- id；
- user_id；
- target_type；
- target_id；
- card_type；
- fsrs_card_state JSON；
- scheduler_version；
- due_at；
- suspended_at；
- created_at。

### `review_logs`

- id；
- review_card_id；
- rating；
- reviewed_at；
- elapsed_ms；
- response_mode；
- answer_correct；
- hint_used；
- user_answer JSON；
- scheduler_result JSON；
- algorithm_version。

复习历史不可通过覆盖当前卡片状态来替代。当前状态可以重新计算，但原始 log 必须保留。

## 8.4 语法与练习

### `grammar_points`

- title；
- level；
- explanation_en / explanation_zh；
- structure JSON；
- examples JSON；
- common_errors JSON；
- prerequisite_ids；
- source_reference。

### `exercises`

- exercise_type；
- prompt JSON；
- answer_key JSON；
- explanation JSON；
- skill；
- cefr_level；
- difficulty；
- scoring_rule；
- content_version。

### `exercise_attempts`

- user_id；
- exercise_id；
- response JSON；
- score；
- feedback JSON；
- duration_ms；
- created_at。

## 8.5 阅读与听力

### `learning_contents`

- type（reading/listening/video）；
- title；
- description；
- cefr_level；
- difficulty_metadata JSON；
- source_type；
- source_url（可空）；
- copyright_status；
- transcript/text；
- duration_seconds；
- media_asset_id。

### `transcript_segments`

- content_id；
- sequence；
- start_ms / end_ms；
- speaker；
- text_en；
- text_zh；
- metadata JSON。

### `content_interactions`

记录阅读时长、查词、重放、播放、暂停、理解题和收藏，避免记录无关的敏感浏览信息。

## 8.6 AI、口语与写作

### `ai_sessions`

- user_id；
- provider；
- model；
- session_type；
- learning_context JSON；
- started_at、ended_at；
- estimated_cost；
- status。

### `ai_messages`

- session_id；
- role；
- content；
- transcript_text；
- metadata JSON；
- created_at。

### `speaking_attempts`

- user_id；
- task_type；
- prompt_id；
- audio_asset_id（可空）；
- transcript；
- evaluation JSON；
- confidence；
- created_at。

### `writing_submissions`

- user_id；
- prompt_id；
- original_text；
- revised_text；
- feedback JSON；
- rubric_version；
- created_at。

## 8.7 学习诊断与进度

- `assessment_sessions`；
- `assessment_items`；
- `assessment_attempts`；
- `skill_estimates`；
- `can_do_evidence`；
- `learning_events`；
- `error_notebook_entries`；
- `study_plans`；
- `study_plan_tasks`。

学习事件可采用 append-only 模式，便于重建趋势。对隐私敏感的数据提供删除/导出策略。

## 8.8 PTE 数据

- `exam_versions`：考试版本、来源 URL、生效日期、复核日期；
- `pte_task_types`：任务类型、所属部分、技能影响、说明；
- `pte_prompts`：原创题目、音频/图片、难度、版本；
- `pte_attempts`：回答、客观评分、AI 反馈、用时；
- `pte_rubrics`：评分维度和版本。

---

# 9. API 与服务接口

API 路径可按实际实现调整，但职责必须清楚。所有接口都要经过认证、owner 范围检查、Zod 校验和错误处理。

## 9.1 学习者与计划

- `GET /api/me`：当前用户与档案；
- `PATCH /api/me/preferences`：偏好更新；
- `GET /api/study/today`：今日学习计划；
- `POST /api/study/plan/rebuild`：重新生成计划；
- `POST /api/learning-events`：记录学习事件。

## 9.2 课程

- `GET /api/courses`；
- `GET /api/lessons/:id`；
- `POST /api/lessons/:id/start`；
- `POST /api/lessons/:id/steps/:stepId/attempt`；
- `POST /api/lessons/:id/complete`。

## 9.3 复习

- `GET /api/review/due`；
- `POST /api/review/:cardId/answer`；
- `POST /api/review/:cardId/suspend`；
- `GET /api/review/stats`。

每次答案都保存 review log，并通过 FSRS 更新 card state。确保同一个请求重试不会意外创建重复日志（使用 idempotency key 或 request id）。

## 9.4 AI

- `POST /api/ai/chat`；
- `POST /api/ai/chat/stream`；
- `POST /api/ai/voice/session`：创建短时效实时会话凭证；
- `POST /api/ai/transcribe`；
- `POST /api/ai/synthesize`；
- `POST /api/ai/evaluate-speaking`；
- `POST /api/ai/evaluate-writing`；
- `GET /api/ai/usage`。

不得在日志中记录 API Key、完整授权头或未经用户允许的原始音频。

## 9.5 内容导入

- `POST /api/import/text`；
- `POST /api/import/file`；
- `POST /api/import/subtitles`；
- `POST /api/import/vocabulary`；
- `POST /api/import/:id/analyze`；
- `POST /api/import/:id/publish`。

导入先进入 draft 状态，用户确认后才进入正式学习库。

## 9.6 PTE

- `GET /api/pte/versions`；
- `GET /api/pte/task-types`；
- `GET /api/pte/prompts`；
- `POST /api/pte/attempts`；
- `GET /api/pte/progress`。

---

# 10. AI Prompt 与教学质量规范

## 10.1 System Prompt 核心规则

AI 英语教师应遵循以下系统规则：

- 你是一位耐心、准确、适合成年中文母语学习者的英语教师；
- 以学习者当前技能水平为准，不因某项能力强就假设其他能力也强；
- 用当前目标级别可理解的英语交流；
- 初级阶段允许用中文解释，但必须保留英文例句和实际输出；
- 一次只引入有限的新知识；
- 发现错误先判断是否影响理解，再决定优先级；
- 纠正时解释原因，不只给正确句子；
- 不要替学习者直接完成可由学习者完成的任务；
- 鼓励主动回忆和再次尝试；
- 不伪造词源、语法规则、IPA、CEFR 级别或考试评分；
- 无法确定时明确表示不确定；
- 不复制用户没有授权的受版权保护内容；
- 生成的教学材料应自然、可理解、符合级别。

## 10.2 初级语音老师 Prompt 行为

- 语速自然偏慢，但不夸张拖长每个音节；
- 每轮只问一个问题；
- 使用高频、短句和熟悉主题；
- 用户沉默时提供关键词或句型支架；
- 不要立即切换到复杂抽象话题；
- 用户说错时先确认意思，再纠正一个关键点；
- 用户可以要求中文解释；
- 对错误发音描述具体声音、重音或口型，不说笼统的“发音不好”。

## 10.3 AI 内容生成流程

1. 读取目标 CEFR、目标技能和前置知识；
2. 从 schema 约束的 Prompt 生成 JSON；
3. Zod 校验结构；
4. 检查目标词汇和语法复杂度；
5. 检查答案唯一性或明确的开放答案评分规则；
6. 检查文本自然度、事实风险和版权风险；
7. 生成后置状态 `draft`；
8. 用户或管理员预览；
9. 审核通过后才发布到个人学习库。

首版个人应用可以简化审核界面，但不能跳过结构校验、来源记录和 draft 状态。

## 10.4 AI 评分置信度

每个自动评价都应包含：

- `score_or_band`（若适用）；
- `confidence`（low/medium/high）；
- `evidence`；
- `limitations`；
- `next_action`。

低置信度结果不应进入正式能力等级计算。单次口语模型的分数不能直接改变 CEFR 主等级。

---

# 11. 数据安全、隐私与可靠性

## 11.1 安全基线

- 服务端密钥管理；
- 密码哈希；
- CSRF/Origin 防护（按所选框架机制）；
- XSS 防护和安全渲染；
- SQL 参数化查询；
- 上传文件校验；
- API 限流；
- session 轮换与注销；
- 错误信息不泄漏内部堆栈；
- 生产日志不含密码、密钥、session token 和完整个人录音；
- `APP_SECRET` 使用强随机值；
- PostgreSQL 不直接暴露公网。

## 11.2 隐私设置

用户可以：

- 查看保存的口语转录；
- 删除单次录音；
- 删除单次 AI 会话；
- 关闭自动保存语音；
- 导出学习数据；
- 删除所有数据并重置系统；
- 设置材料保留策略。

语音录制开始前清楚说明是否保存录音、是否保存转录、是否发送到第三方 Provider。

## 11.3 备份与恢复

提供脚本：

- `scripts/backup.sh`：数据库 dump + 用户文件归档；
- `scripts/restore.sh`：先校验备份，再恢复；
- `scripts/healthcheck.sh`：检查应用、DB、磁盘、AI 配置；
- `scripts/update.sh`：拉取新镜像/构建、备份、迁移、重启。

备份建议至少包含：数据库、用户上传材料、录音（用户未关闭保存时）、关键环境变量模板（不包含明文密钥）。

必须在文档中强调：只备份数据库而不备份 `/app/data` 会丢失用户文件；只备份文件而不备份数据库会丢失索引和进度。

## 11.4 可观测性

- 结构化日志；
- 应用版本；
- 请求 ID；
- 错误追踪；
- AI provider 错误和延迟；
- 数据库连接状态；
- 文件存储空间；
- 复习任务执行错误。

首版不需要引入复杂监控平台，但要能通过 Docker logs 快速定位问题。

---

# 12. 内容质量和版权策略

## 12.1 内容来源分类

每项内容必须记录 `source_type`：

- `first_party`：本项目原创；
- `ai_generated`：AI 生成；
- `user_imported`：用户导入；
- `licensed`：已获得授权；
- `public_domain`：公有领域；
- `external_link`：只保存外链和必要元数据。

## 12.2 教材参考方式

可参考优秀书籍的教学组织方式、理论和练习设计思想，但不复制教材页面、题目、答案、整段文字或音频。书籍的版权内容应由用户自行购买和使用；本系统只提供用户合法导入自己的学习笔记/短片段的工具。

建议阅读与设计参考：

1. **Patsy Lightbown & Nina Spada — *How Languages are Learned*（第 5 版）**：第二语言习得理论、输入、互动、反馈与学习者差异；
2. **I. S. P. Nation — *Learning Vocabulary in Another Language*（第 3 版）**：词汇知识维度、词汇学习策略与课程平衡；
3. **Paul Nation — “The Four Strands”**：输入、输出、语言聚焦学习、流利度发展；
4. **H. Douglas Brown & Heekyeong Lee — *Teaching by Principles*（第 4 版）**：交际教学、任务和课程方法；
5. **Peter C. Brown, Henry L. Roediger III & Mark A. McDaniel — *Make It Stick***：检索练习、间隔练习、交错练习和长期记忆；
6. **Grant Wiggins & Jay McTighe — *Understanding by Design*（Expanded 2nd Edition）**：逆向课程设计，先明确学习结果和评估证据；
7. **Richard E. Mayer — *The Cambridge Handbook of Multimedia Learning***：分段、预训练、信号提示、减少无关认知负荷；
8. **Raymond Murphy — *English Grammar in Use*（第 5 版）**：B1–B2 阶段语法自学练习的参考，不作为整个课程体系；
9. **Cambridge English “In Use” 系列**：按等级选取 Grammar、Vocabulary、Pronunciation 等练习组织思路，不复制内容。

## 12.3 内容审核标准

发布内容前至少检查：

- CEFR 级别是否合理；
- 词汇和语法是否超出目标级别；
- 例句是否自然；
- 答案是否正确；
- 开放题是否具有评分说明；
- 音频转录是否与音频一致；
- 内容是否重复；
- 来源和版权状态是否清楚；
- AI 生成内容是否含有事实错误或不自然表达。

---

# 13. 开发阶段与优先级

## Phase 0 — 项目基础

- 仓库审查；
- Next.js + TypeScript 项目；
- Tailwind + 设计令牌；
- 统一 AppShell；
- PostgreSQL + Drizzle；
- Docker Compose；
- 首次 owner setup + 登录；
- 健康检查；
- migrations 和 seed 机制；
- lint、typecheck、test、build 流程。

**验收**：新机器按 README 能用 Docker 启动，创建 owner，登录，刷新后状态保留，数据写入 PostgreSQL。

## Phase 1 — 学习核心 MVP

- learner profile；
- onboarding；
- 基础诊断；
- 首页今日计划；
- CEFR 路线图；
- Pre-A1 课程；
- A1 课程首批内容；
- Lesson Player；
- Vocabulary Lab；
- FSRS review；
- 基础进度统计。

**验收**：用户可以完成一节课，课程记录被保存；从课程中加入单词，建立复习卡；复习后状态更新；重新登录数据依然存在。

## Phase 2 — 输入与语言知识

- Grammar Studio；
- Reading Room；
- Listening Studio；
- transcript；
- 用户文本/字幕/词表导入；
- Error Notebook；
- 阅读/听力的词汇采集。

**验收**：导入一份合法文本或字幕，预览并保存；能阅读、查词、收藏；听力支持播放、字幕和逐句操作；练习错误写入错误本。

## Phase 3 — AI Tutor 与语音

- Provider Adapter；
- AI Tutor 文本模式；
- 结构化内容生成；
- AI 写作反馈；
- WebRTC 语音会话；
- STT/TTS 降级路径；
- Speaking Lab；
- AI 成本控制和使用记录。

**验收**：前端无法获取长期 API Key；可创建并结束语音会话；AI 难度按用户等级调整；失败时可显示原因并降级；会话记录按设置保存/删除。

## Phase 4 — 评估和 PTE 专区

- 技能评估历史；
- CEFR can-do 证据；
- PTE 题型数据模型；
- 原创 PTE 练习；
- 计时模式；
- 练习报告；
- 官方题型来源和版本日期。

**验收**：用户可完成至少一个代表性任务类型的练习并看到反馈；数据能绑定当前考试版本；修改考试版本不会破坏旧记录。

## Phase 5 — A2–C2 内容与优化

- A2/B1 课程逐步补全；
- B2/C1/C2 课程骨架和内容；
- 个性化推荐改进；
- 离线/弱网体验（视浏览器限制）；
- 高级数据分析；
- 备份恢复演练；
- 移动端深度优化。

**验收**：不是只有等级目录，所标记为 published 的课程必须真实可学习、有练习、有答案/评分说明、有来源。

---

# 14. 测试与验收标准

## 14.1 通用

- `npm run lint` 通过；
- `npm run typecheck` 通过；
- `npm run test` 通过；
- `npm run build` 通过；
- `npm run test:e2e` 的关键流程通过；
- 无明显控制台错误；
- 无横向溢出；
- Loading/Empty/Error/Success 状态完整；
- 桌面、平板、手机布局可用。

## 14.2 关键业务验收

### 用户与设置

- 首次创建 owner；
- 再次访问转为登录；
- 错误密码不泄漏账号信息；
- 注销后受保护页面无法访问；
- owner 可更换密码。

### 课程

- 课程目录来自数据库；
- 用户开始课程后创建进度；
- 每个步骤完成后状态保存；
- 刷新恢复到正确步骤；
- 课程完成触发总结和复习关联。

### 复习

- due queue 正确；
- 四种评分可用；
- 每次复习都产生 log；
- 重试不会产生重复日志；
- FSRS 状态更新可复现；
- 修改调度器版本时不破坏历史 log。

### AI

- Provider 未配置时，非 AI 功能仍可用；
- Provider 错误能显示可理解的错误；
- 不泄露密钥；
- AI 响应经过 schema 验证；
- AI 评分有置信度和限制说明；
- 超预算策略生效。

### 音频

- 麦克风权限拒绝可处理；
- 浏览器不支持 WebRTC 时能提示降级；
- 会话断线后不会无限 loading；
- 用户可停止并释放麦克风轨道；
- 未经同意不保存音频。

### 数据与隐私

- owner 以外的用户数据不可见（即使首版只有单用户，也要测试 repository scope）；
- 用户删除音频后文件和数据库引用一致清理；
- 备份能恢复；
- 文件上传大小和类型限制有效。

## 14.3 学习质量验收

- 每个 published lesson 至少有明确学习目标；
- 每个 unit 至少一个 meaning-focused input 和一个 output；
- 复习卡能区分 receptive/productive；
- 题目有答案或开放题评分 rubric；
- 内容有 CEFR 标签和来源；
- 学习统计能够追溯到真实练习记录；
- AI 不把一次练习分数直接等同 CEFR 等级；
- PTE AI 反馈不声称为 Pearson 官方分数。

---

# 15. 首版种子内容要求

Claude 在构建首版时，不要一次性虚构“Pre-A1 到 C2 全部课程已经完成”。优先确保以下内容质量：

## 15.1 首发课程内容

- Pre-A1：至少 8 个 Unit 的完整目录，首批至少 3 个 Unit 有可学习课程；
- A1：至少 20 个 Unit/主题目录，首批至少 3 个 Unit 有可学习课程；
- A2–C2：建立课程蓝图、技能目标、语法/主题地图，状态标记为 `planned` 或 `draft`；
- 不得把空课程标成 `published`。

## 15.2 每个首发 Unit 至少

- 3 个 Lesson；
- 1 个 Unit Review；
- 1 个 Listening activity；
- 1 个 Speaking/Output activity；
- 1 个词汇清单；
- 1 个语法/语言功能点；
- 对应 CEFR can-do 目标。

## 15.3 内容样例

为 Pre-A1 的“Hello!”设计真实完整课程：

- greetings 的输入对话；
- 英文音频或 TTS 生成路径；
- 语块 `Hello`、`Good morning`、`How are you?`、`I'm fine, thank you.`；
- 句子理解；
- 听辨；
- 角色扮演；
- 用户口语输出；
- 错误反馈；
- 复习卡；
- 完成评估。

课程语言自然，避免机械、过时或不符合真实交际的例句。

---

# 16. 重要工程约束

1. 不把课程数据写死在组件中；
2. 不把复习逻辑写在 React 组件里；
3. 不在客户端存放第三方秘密；
4. 不以 localStorage 作为唯一权威学习数据存储；可用它保存非敏感 UI 偏好或草稿缓存；
5. 所有学习进度必须持久化到 PostgreSQL；
6. 所有 AI 输出必须有 schema、超时和错误处理；
7. 文件操作必须限制在配置存储目录内，避免路径穿越；
8. 数据库变更必须通过 migration；
9. 不允许生产环境自动 `drizzle-kit push` 作为迁移策略；
10. 不允许把用户导入内容直接作为可信系统 Prompt；
11. 把用户材料视作不可信数据，防止 Prompt Injection；
12. AI 不应执行来自阅读材料或字幕的命令；
13. PTE 题库与官方考试结构要可版本化；
14. UI 组件要兼顾移动端和键盘使用；
15. 不要为了一次性“视觉效果”牺牲信息层级和学习可用性；
16. 课程审核状态必须和发布状态分离；
17. 用户可以导出数据，避免产品锁定；
18. 应用升级前先备份并运行 migrations；
19. 不要在没有必要时引入 Redis、向量数据库、微服务或复杂消息队列；
20. 文档、README 和真实行为必须一致。

---

# 17. 开发完成后 README 应包含

- 产品截图（真实页面）；
- 项目功能概览；
- 技术栈；
- Docker 启动命令；
- 首次初始化和登录；
- 环境变量说明；
- AI Provider 配置；
- 语音功能浏览器要求（HTTPS/localhost、麦克风授权）；
- 课程内容如何新增；
- 用户材料如何导入；
- 数据备份和恢复；
- 更新与回滚；
- 常见问题；
- 已知限制和未完成功能。

README 不得写“支持所有 AI 模型”或“口语评分精准”等未经验证的承诺。

---

# 18. 参考书籍、研究与官方文档

以下资料用于指导产品和教学设计，不意味着可以复制其受版权保护的原文、题目、答案或音频。

## 18.1 语言习得与课程设计

- Council of Europe, **CEFR Companion Volume (2020)**：https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors
- Patsy Lightbown & Nina Spada, **How Languages are Learned, 5th Edition**（Oxford University Press, 2021）：https://www.oup.com.au/books/english-language-teaching/secondary-courses/9780194406291
- H. Douglas Brown & Heekyeong Lee, **Teaching by Principles, 4th Edition**（Pearson）：https://www.longmanhomeusa.com/catalog/products/teaching-by-principles-4e-an-interactive-approach-to-language-pedagogy/
- Grant Wiggins & Jay McTighe, **Understanding by Design, Expanded 2nd Edition**（ASCD）：https://ascd.org/books/understanding-by-design-expanded-2nd-edition
- Paul Nation, **The Four Strands**（2007）：https://www.wgtn.ac.nz/lals/resources/paul-nations-resources/paul-nations-publications/publications/documents/2007-Four-strands.pdf

## 18.2 词汇与记忆

- I. S. P. Nation, **Learning Vocabulary in Another Language, 3rd Edition**（Cambridge University Press, 2022）：https://www.cambridge.org/core/books/learning-vocabulary-in-another-language/97C1293EBC8716EA70B77626E00740AA
- Peter C. Brown, Henry L. Roediger III & Mark A. McDaniel, **Make It Stick: The Science of Successful Learning**（2014）：https://www.harvard.com/book/9780674729018
- Webb, **The Effects of Spaced Practice on Second Language Learning: A Meta-Analysis**（2022）：https://onlinelibrary.wiley.com/doi/full/10.1111/lang.12479
- Webb, Yan & Uchihara, **How Effective Are Intentional Vocabulary-Learning Activities? A Meta-Analysis**（2020）：https://onlinelibrary.wiley.com/doi/10.1111/modl.12671

## 18.3 语法与多媒体学习

- Raymond Murphy, **English Grammar in Use, 5th Edition**（Cambridge University Press）：https://shop.cambridge.org/english/product/2700199294
- Cambridge English, **In Use Series**（Grammar / Vocabulary / Pronunciation）：https://www.cambridgeenglish.org/cmp/in-use-for-teachers/
- Richard E. Mayer, **The Cambridge Handbook of Multimedia Learning**：https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/
- Mayer & Fiorella, **Segmenting, Pre-training, and Modality Principles**：https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/principles-for-managing-essential-processing-in-multimedia-learning/A9E77D0172F905AC957689D1771E2888

## 18.4 PTE 官方资料

- Pearson PTE Academic Test Format：https://www.pearsonpte.com/pte-academic/test-format/
- Speaking & Writing： https://www.pearsonpte.com/pte-academic/test-format/speaking-writing/
- Reading： https://www.pearsonpte.com/pte-academic/test-format/reading/
- Listening： https://www.pearsonpte.com/pte-academic/test-format/listening/

在正式实现 PTE 题型、时间和评分时重新访问以上官方来源，保存复核日期和考试版本。

## 18.5 工程文档

- Next.js App Router：https://nextjs.org/docs/app
- Drizzle ORM + PostgreSQL：https://orm.drizzle.team/docs/get-started/postgresql-new
- Drizzle Migrations：https://orm.drizzle.team/docs/migrations
- `ts-fsrs` 文档：https://open-spaced-repetition.github.io/ts-fsrs/guide/
- OpenAI Realtime API：https://developers.openai.com/api/docs/guides/realtime
- OpenAI WebRTC：https://developers.openai.com/api/docs/guides/voice-webrtc
- OpenAI Audio & Voice：https://developers.openai.com/api/docs/guides/audio
- pgvector（仅未来需要语义检索时评估，不是 MVP 依赖）：https://github.com/pgvector/pgvector

---

# 19. 最终产品定义与优先顺序

按以下优先级做产品取舍：

1. **学习闭环优先于页面数量**：课程 → 练习 → 反馈 → 复习 → 再次使用；
2. **基础质量优先于全等级空壳**：先把 Pre-A1/A1 做扎实；
3. **通用英语优先于 PTE 技巧**：PTE 是未来专项模块；
4. **真实输出优先于积分游戏**：口语、写作和交际任务必须进入日常路径；
5. **可靠数据优先于花哨统计**：数据必须来自真实练习；
6. **可维护架构优先于技术炫技**：Next.js + PostgreSQL 模块化单体；
7. **有趣 UI 服务于学习**：轻松但不幼稚，精致但不复杂；
8. **AI 辅助而非 AI 代学**：AI 应引导学习者自己回忆、组织和表达；
9. **隐私和可迁移性优先**：私有 Docker 部署、数据可导出、备份可恢复。

## 给 Claude Code 的最终执行要求

现在开始实施时：

1. 先检查仓库；
2. 写实施计划和架构决策；
3. 初始化 Next.js、设计系统、数据库和 Docker；
4. 实现可用的登录、个人档案和首页；
5. 实现 Pre-A1/A1 课程学习器与词汇 FSRS 闭环；
6. 再按阶段加入语法、阅读、听力、AI Tutor、语音、写作、PTE；
7. 每个阶段完成后运行测试并更新状态文档；
8. 最终提供真实启动方法、环境变量、截图、测试结果和已知限制。

**不要只输出计划或代码片段。需要在当前代码仓库中真实创建、修改和验证项目文件。若某个外部 API 因缺少密钥不能实测，应完成接口、模拟测试和配置说明，并明确标记该限制，不得伪称已经连接成功。**

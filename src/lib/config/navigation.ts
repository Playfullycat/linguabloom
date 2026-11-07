import {
  AudioLines,
  BookA,
  BookOpen,
  CalendarCheck,
  ChartLine,
  Dumbbell,
  GraduationCap,
  Headphones,
  Layers,
  Library,
  Map,
  Mic,
  NotebookPen,
  PenLine,
  Puzzle,
  RotateCcw,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/**
 * App navigation and feature registry.
 *
 * This is application chrome (where things live and when they ship), not
 * learning content — course/lesson/vocabulary data never goes here.
 * `phase` refers to the delivery phases in docs/IMPLEMENTATION_PLAN.md.
 */

export type Phase = 0 | 1 | 2 | 3 | 4 | 5;

export type Feature = {
  key: string;
  href: string;
  label: string;
  labelZh: string;
  icon: LucideIcon;
  /** One-line purpose, shown in headers and hub cards. */
  summary: string;
  /** Phase in which the feature becomes usable. */
  phase: Phase;
  /** Already usable (shown as "可以使用" instead of the planned phase). */
  available?: boolean;
  /** What the learner will be able to do here (shown while not yet built). */
  highlights: string[];
  /** Other routes that belong to this feature (highlight it there too). */
  alsoActiveOn?: string[];
};

export type NavGroup = {
  key: string;
  href: string;
  label: string;
  labelZh: string;
  icon: LucideIcon;
  summary: string;
  children: Feature[];
};

export type NavEntry = Feature | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

const today: Feature = {
  key: "today",
  href: "/today",
  label: "Today",
  labelZh: "今日",
  icon: CalendarCheck,
  summary: "打开就知道今天最值得做什么。",
  phase: 1,
    available: true,
  highlights: [
    "根据到期复习、课程进度和薄弱点生成今日计划",
    "可切换 15 / 25 / 40 / 60 分钟模式，也可以只做复习",
    "可调整任务顺序、跳过任务并说明原因",
  ],
};

const learnChildren: Feature[] = [
  {
    key: "path",
    href: "/learn/path",
    label: "Learning Path",
    labelZh: "学习路径",
    icon: Map,
    summary: "从 Pre-A1 到 C2 的能力路线和课程单元。",
    phase: 1,
    available: true,
    alsoActiveOn: ["/learn/levels", "/learn/units"],
    highlights: [
      "七个 CEFR 等级的学习目标、单元与完成度",
      "前置能力提示，但不强制锁定跳级",
      "按技能、主题、等级筛选课程",
    ],
  },
  {
    key: "vocabulary",
    href: "/vocabulary",
    label: "Vocabulary",
    labelZh: "词汇",
    icon: BookA,
    summary: "区分“看得懂”和“用得出”的词汇库。",
    phase: 1,
    available: true,
    highlights: [
      "新词学习与 FSRS 间隔复习",
      "英→义、义→英、听音识别、拼写、语境填空等卡片",
      "从阅读、听力、对话中收集词汇，支持 CSV/TSV 导入导出",
    ],
  },
  {
    key: "grammar",
    href: "/grammar",
    label: "Grammar",
    labelZh: "语法",
    icon: Puzzle,
    summary: "放在交际场景里的语法地图。",
    phase: 2,
    available: true,
    highlights: [
      "按等级和先修关系浏览语法点",
      "句子结构拆解与易混语法对比",
      "根据错题生成专项微课",
    ],
  },
  {
    key: "reading",
    href: "/reading",
    label: "Reading",
    labelZh: "阅读",
    icon: BookOpen,
    summary: "略高于当前水平、但能读懂的分级阅读。",
    phase: 2,
    available: true,
    highlights: [
      "点击单词看释义、音标和发音，可选择是否收藏",
      "按级别调整中文辅助：逐句翻译 → 关键词提示 → 全英文",
      "理解练习、摘要与阅读笔记",
    ],
  },
  {
    key: "listening",
    href: "/listening",
    label: "Listening",
    labelZh: "听力",
    icon: Headphones,
    summary: "先听后看，按句循环和变速播放。",
    phase: 2,
    available: true,
    highlights: [
      "0.75× 到 1.5× 变速，逐句 / 逐段 / A-B 循环",
      "字幕可切换：隐藏、英文、中文辅助、双语",
      "逐句听写、关键词听辨和跟读",
    ],
  },
  {
    key: "pronunciation",
    href: "/pronunciation",
    label: "Pronunciation",
    labelZh: "发音",
    icon: AudioLines,
    summary: "以“听得懂”为目标的发音练习。",
    phase: 3,
    highlights: [
      "IPA 音标表、重音、节奏、弱读与连读",
      "最小对立体练习",
      "录音与参考音频对比",
    ],
  },
];

const practiceChildren: Feature[] = [
  {
    key: "review",
    href: "/review",
    label: "Review",
    labelZh: "复习",
    icon: RotateCcw,
    summary: "按 FSRS 调度的到期复习。",
    phase: 1,
    available: true,
    highlights: [
      "四档评分：忘记了 / 很吃力 / 记得 / 很轻松",
      "答错先看正确答案和简短解释，再立即重试",
      "每次复习都保留不可覆盖的记录",
    ],
  },
  {
    key: "speaking",
    href: "/speaking",
    label: "Speaking",
    labelZh: "口语",
    icon: Mic,
    summary: "朗读、复述、情境对话等口语任务。",
    phase: 3,
    highlights: [
      "实时语音对话，网络不佳时自动切换到标准语音模式",
      "反馈先看对方能否理解，再纠正一个最关键的问题",
      "录音和转录可查看、可删除",
    ],
  },
  {
    key: "writing",
    href: "/writing",
    label: "Writing",
    labelZh: "写作",
    icon: PenLine,
    summary: "从句子改写到短文的分层批改。",
    phase: 3,
    highlights: [
      "日记、邮件、图片描述、观点表达",
      "按任务完成度 → 内容 → 语法 → 词汇 → 衔接分层反馈",
      "先改最重要的问题，再写自己的第二版",
    ],
  },
  {
    key: "errors",
    href: "/errors",
    label: "Error Notebook",
    labelZh: "错误本",
    icon: NotebookPen,
    summary: "把反复出现的错误变成补救练习。",
    phase: 2,
    available: true,
    highlights: [
      "错误关联知识点和错误类型",
      "同类错误反复出现时生成补救任务",
      "补救后换语境再测，检验是否真正掌握",
    ],
  },
  {
    key: "pte",
    href: "/pte",
    label: "PTE",
    labelZh: "PTE 专区",
    icon: GraduationCap,
    summary: "基础打牢后再开启的 PTE Academic 专项训练。",
    phase: 4,
    highlights: [
      "按官方题型分类训练，带计时",
      "客观题精确判分；口语和写作只提供 AI 辅助反馈，不等同官方成绩",
      "题型信息按考试版本和复核日期保存",
    ],
  },
];

const tutor: Feature = {
  key: "tutor",
  href: "/tutor",
  label: "AI Tutor",
  labelZh: "AI 辅导",
  icon: Sparkles,
  summary: "按你的真实水平调整说话方式的英语老师。",
  phase: 3,
  highlights: [
    "讲解、练习、自由对话、情景角色扮演、纠错",
    "根据各项技能水平控制语速、词汇和中文辅助比例",
    "未配置 AI 时，其他学习功能照常可用",
  ],
};

const progress: Feature = {
  key: "progress",
  href: "/progress",
  label: "Progress",
  labelZh: "进度",
  icon: ChartLine,
  summary: "来自真实练习记录的学习数据。",
  phase: 1,
    available: true,
  highlights: [
    "各技能分项趋势与证据数量",
    "词汇被动 / 主动掌握差距与保留率",
    "趋势是学习记录，不是官方 CEFR 认证",
  ],
};

export const library: Feature = {
  key: "library",
  href: "/library",
  label: "Library",
  labelZh: "我的材料",
  icon: Library,
  summary: "导入你自己的文章、字幕和词表。",
  phase: 2,
  available: true,
  highlights: [
    "支持粘贴文本、TXT、Markdown、SRT/VTT 字幕、CSV/TSV 词表",
    "导入先进入草稿，预览确认后才进入学习库",
    "导入材料仅供个人使用，记录来源和版权状态",
  ],
};

export const settings: Feature = {
  key: "settings",
  href: "/settings",
  label: "Settings",
  labelZh: "设置",
  icon: Settings,
  summary: "外观、学习计划、AI 服务和数据备份。",
  phase: 0,
    available: true,
  highlights: [],
};

export const learnGroup: NavGroup = {
  key: "learn",
  href: "/learn",
  label: "Learn",
  labelZh: "学习",
  icon: Layers,
  summary: "系统课程与语言知识：路径、词汇、语法、阅读、听力、发音。",
  children: learnChildren,
};

export const practiceGroup: NavGroup = {
  key: "practice",
  href: "/practice",
  label: "Practice",
  labelZh: "练习",
  icon: Dumbbell,
  summary: "复习与输出：复习、口语、写作、错误本、PTE。",
  children: practiceChildren,
};

/** Desktop sidebar, in order. */
export const primaryNav: NavEntry[] = [today, learnGroup, practiceGroup, tutor, progress];
export const secondaryNav: Feature[] = [library, settings];

/** Mobile bottom bar (spec §6.5: 4–5 items). */
export const mobileNav: NavEntry[] = [today, learnGroup, practiceGroup, tutor, progress];

const allFeatures: Feature[] = [today, ...learnChildren, ...practiceChildren, tutor, progress, library, settings];

export function getFeature(key: string): Feature {
  const feature = allFeatures.find((f) => f.key === key);
  if (!feature) throw new Error(`Unknown feature key: ${key}`);
  return feature;
}

/** `href` itself or any nested route under it. */
export function isPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Whether a feature (leaf) is current for `pathname`, including related routes. */
export function isFeatureActive(feature: Feature, pathname: string): boolean {
  return isPathActive(pathname, feature.href) || (feature.alsoActiveOn ?? []).some((p) => isPathActive(pathname, p));
}

/**
 * Whether a top-level section is current for `pathname`. A group is current on
 * its hub page and on any child route (e.g. Learn is current on /vocabulary).
 */
export function isNavEntryActive(entry: NavEntry, pathname: string): boolean {
  if (isNavGroup(entry)) {
    return isPathActive(pathname, entry.href) || entry.children.some((c) => isPathActive(pathname, c.href));
  }
  return isPathActive(pathname, entry.href);
}

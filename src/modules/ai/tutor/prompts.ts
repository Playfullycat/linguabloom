/**
 * Tutor prompts (spec §5.9, §10.1). The system prompt carries the teaching
 * rules, the level policy and only the learning context the mode needs.
 */

export const TUTOR_MODES = [
  "explain",
  "practice",
  "conversation",
  "roleplay",
  "correct",
  "ask_me",
  "review",
  "reading_coach",
  "listening_coach",
] as const;
export type TutorMode = (typeof TUTOR_MODES)[number];

export const TUTOR_MODE_INFO: Record<TutorMode, { title: string; titleEn: string; description: string; structured: boolean; placeholder: string }> = {
  explain: { title: "讲解", titleEn: "Explain", description: "解释一个语法、词汇或表达。", structured: true, placeholder: "例如：what's the difference between say and tell?" },
  practice: { title: "练习", titleEn: "Practice", description: "针对一个知识点出题，你来回答。", structured: true, placeholder: "例如：考考我 there is / there are" },
  conversation: { title: "自由对话", titleEn: "Conversation", description: "按话题聊天，AI 按你的水平说话。", structured: false, placeholder: "例如：I went to a café yesterday." },
  roleplay: { title: "情景角色扮演", titleEn: "Roleplay", description: "旅行、购物、问路、电话、面试等场景。", structured: false, placeholder: "先在上面选一个场景，再开始说第一句。" },
  correct: { title: "纠错", titleEn: "Correct my sentence", description: "帮你改句子，并解释为什么。", structured: true, placeholder: "写一句你想检查的英文" },
  ask_me: { title: "AI 提问", titleEn: "Ask me questions", description: "AI 主动问问题，你来回答。", structured: true, placeholder: "回答 AI 的问题，或者说 Start" },
  review: { title: "陪你复习", titleEn: "Review with me", description: "复习你最近学过的词和容易错的地方。", structured: true, placeholder: "说 Let's review 开始" },
  reading_coach: { title: "阅读教练", titleEn: "Reading coach", description: "陪你读当前的阅读材料。", structured: true, placeholder: "例如：第 3 句是什么意思？" },
  listening_coach: { title: "听力教练", titleEn: "Listening coach", description: "帮你分析听力材料里的句子。", structured: true, placeholder: "例如：为什么这里听起来像连在一起？" },
};

export const ROLEPLAY_SCENES = [
  { id: "cafe", title: "在咖啡馆点单", setup: "You are a friendly barista in a café. The learner is a customer ordering." },
  { id: "directions", title: "问路", setup: "You are a local person on the street. The learner asks for directions to the train station." },
  { id: "shopping", title: "买衣服", setup: "You are a shop assistant in a clothes shop. The learner wants to buy a jacket." },
  { id: "hotel", title: "酒店入住", setup: "You are a hotel receptionist. The learner is checking in." },
  { id: "phone", title: "打电话预约", setup: "You are a receptionist at a dental clinic taking a phone call. The learner wants to book an appointment." },
  { id: "interview", title: "简单面试", setup: "You are a friendly interviewer for a part-time job. Ask simple questions one at a time." },
] as const;
export type RoleplayScene = (typeof ROLEPLAY_SCENES)[number]["id"];

export type TutorContext = {
  /** CEFR label used for the AI's language (e.g. "A1"). */
  level: string;
  levelBasis: string;
  explanationLanguage: "zh" | "mixed" | "en";
  goals: string[];
  recentWords: string[];
  recentLessons: string[];
  weakSpots: string[];
  material: { title: string; sentences: { n: number; en: string }[]; focus: number | null } | null;
};

const LEVEL_POLICY: Record<string, string> = {
  "Pre-A1": "Use very short sentences and the most common words. One question at a time. Explain in Chinese when needed, but always keep an English example.",
  A1: "Use short sentences and common words. One question at a time. Explain difficult points in Chinese, with an English example.",
  A2: "Use simple English. Add a short Chinese note only for hard points.",
  B1: "Use mostly English. Complex grammar may be explained in Chinese.",
  B2: "Use English. Do not add Chinese unless the learner asks.",
  C1: "Discuss naturally in English. Focus on precision, register and implied meaning.",
  C2: "Discuss naturally in English. Focus on precision, register and implied meaning.",
};

const EXPLANATION: Record<TutorContext["explanationLanguage"], string> = {
  zh: "The learner prefers explanations in Chinese (Simplified).",
  mixed: "The learner prefers explanations mostly in Chinese with simple English.",
  en: "The learner prefers explanations in simple English.",
};

/** Core teaching rules (spec §10.1). */
const CORE_RULES = `You are a patient, accurate English teacher for an adult whose first language is Chinese.
- Match the learner's current level. Do not assume one strong skill means every skill is strong.
- Introduce only a little new language at a time.
- When the learner makes a mistake, first judge whether it affects understanding; correct the most important point and explain why, not just the right sentence.
- Do not do for the learner what they can do themselves; encourage them to try again.
- Never invent etymologies, grammar rules, IPA, CEFR levels or exam scores. Say so when you are not sure.
- Do not reproduce copyrighted text the learner has not provided.
- Keep everything natural, clear and suitable for the level.`;

const JSON_FORMAT = `Reply with ONE JSON object only, no other text:
{"response_text": string, "level_adaptation": string, "correction": {"original": string, "corrected": string, "explanation_zh": string, "explanation_en": string} | null, "new_vocabulary": [{"text": string, "zh": string, "example": string}], "follow_up_question": string | null, "suggested_practice": [{"title": string, "href": string | null}]}
Use "correction" only for a real mistake in the learner's last message. Keep "new_vocabulary" to at most 3 useful items. "href" may only be one of: /grammar, /reading, /listening, /review, /vocabulary.`;

const MODE_INSTRUCTIONS: Record<TutorMode, string> = {
  explain: "Explain what the learner asks about with one or two short examples. Then check understanding with one question.",
  practice: "Give one short practice question on the topic the learner names. After they answer, give feedback and the next question.",
  conversation: "Have a friendly conversation on the learner's topic. Reply in 1–3 sentences and ask one question back. Do not correct every small mistake; if a mistake blocks understanding, rephrase it naturally.",
  roleplay: "Stay in character for the scene below. Reply in 1–3 sentences, one question at a time. If the learner is stuck, offer a useful phrase in brackets.",
  correct: "Check the learner's sentence. If it has mistakes, correct the most important one(s) and explain. If it is already correct, say so and offer a more natural alternative only if there is one.",
  ask_me: "Ask the learner one simple question at a time about everyday topics, using their recent words when possible. React to each answer briefly before the next question.",
  review: "Review with the learner: use their recent words and weak spots listed below. Ask them to recall, use or correct one item at a time.",
  reading_coach: "Help the learner understand the reading passage below. Answer about the sentences they mention; do not translate the whole text unless asked.",
  listening_coach: "Help the learner with the listening transcript below: meaning, sounds that link together, stress and useful phrases. Be specific.",
};

export function buildSystemPrompt(mode: TutorMode, ctx: TutorContext, scene?: RoleplayScene): string {
  const lines = [
    CORE_RULES,
    "",
    `LEVEL: ${ctx.level}`,
    `MODE: ${mode}`,
    `Level policy: ${LEVEL_POLICY[ctx.level] ?? LEVEL_POLICY.A1}`,
    EXPLANATION[ctx.explanationLanguage],
    `Task: ${MODE_INSTRUCTIONS[mode]}`,
  ];
  if (mode === "roleplay") {
    const s = ROLEPLAY_SCENES.find((x) => x.id === scene) ?? ROLEPLAY_SCENES[0];
    lines.push(`Scene: ${s.setup}`);
  }
  if (ctx.goals.length > 0) lines.push(`Learner goals: ${ctx.goals.join(", ")}.`);
  if ((mode === "review" || mode === "ask_me" || mode === "practice") && ctx.recentWords.length > 0) lines.push(`Recently learned words: ${ctx.recentWords.join(", ")}.`);
  if (mode === "review" && ctx.weakSpots.length > 0) lines.push(`Recent weak spots: ${ctx.weakSpots.join("; ")}.`);
  if ((mode === "reading_coach" || mode === "listening_coach") && ctx.material) {
    lines.push(`Material: "${ctx.material.title}"`, ...ctx.material.sentences.map((s) => `[${s.n}] ${s.en}`));
    if (ctx.material.focus !== null) lines.push(`The learner is looking at sentence [${ctx.material.focus}].`);
  }
  if (TUTOR_MODE_INFO[mode].structured) lines.push("", JSON_FORMAT);
  return lines.join("\n");
}

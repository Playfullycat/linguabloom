import { AIError, AI_ERROR_CODES, type AIErrorCode } from "./errors";
import type {
  AIProvider,
  ChatMessage,
  RealtimeConnectInput,
  RealtimeConnectResult,
  SpeechInput,
  SpeechResult,
  TextDelta,
  TextGenerationInput,
  TextGenerationResult,
  TranscriptionInput,
  TranscriptionResult,
} from "./types";

/**
 * Local stand-in for a real provider (AI_PROVIDER=mock): no network, no cost,
 * deterministic. Every reply is clearly marked as simulated. Used by the
 * automated tests and for trying the UI without a key.
 *
 * Test hooks inside a user message: "[mock:error:<code>]" fails with that
 * error, "[mock:invalid]" returns malformed JSON.
 */

const tokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

/** A few common learner errors, enough to exercise the correction UI. */
const RULES: { test: RegExp; fix: (s: string) => string; zh: string; en: string }[] = [
  { test: /\b(I|you|we|they|he|she|it)\s+(very|so|really)\s+(\w+)/i, fix: (s) => s.replace(/\b(I|you|we|they|he|she|it)\s+(very|so|really)\b/i, (_, p: string, adv: string) => `${p} ${beFor(p)} ${adv}`), zh: "形容词前面少了 be 动词（am / is / are）。", en: "You need a form of 'be' before an adjective." },
  { test: /\b(he|she|it)\s+(go|like|want|work|live|have)\b/i, fix: (s) => s.replace(/\b(he|she|it)\s+(go|like|want|work|live|have)\b/i, (_, p: string, v: string) => `${p} ${thirdPerson(v)}`), zh: "he / she / it 作主语时，一般现在时的动词要加 -s。", en: "Use the -s form of the verb after he/she/it." },
  { test: /\b(she|he|it)\s+are\b/i, fix: (s) => s.replace(/\b(she|he|it)\s+are\b/i, (_, p: string) => `${p} is`), zh: "he / she / it 后面用 is。", en: "Use 'is' with he/she/it." },
  { test: /\ba\s+([aeiou]\w*)/i, fix: (s) => s.replace(/\ba\s+([aeiou]\w*)/i, (_, w: string) => `an ${w}`), zh: "元音音素开头的词前用 an。", en: "Use 'an' before a vowel sound." },
];
function beFor(p: string) {
  const l = p.toLowerCase();
  return l === "i" ? "am" : ["he", "she", "it"].includes(l) ? "is" : "are";
}
function thirdPerson(v: string) {
  return v === "go" ? "goes" : v === "have" ? "has" : `${v}s`;
}

const lastUser = (messages: ChatMessage[]) => [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
const field = (system: string, name: string) => system.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";

function failIfAsked(text: string) {
  const m = text.match(/\[mock:error:([a-z_]+)\]/);
  if (m && (AI_ERROR_CODES as readonly string[]).includes(m[1]!)) throw new AIError(m[1] as AIErrorCode, "mock");
}

export class MockProvider implements AIProvider {
  readonly name = "mock" as const;
  readonly textModel = "mock-tutor";
  readonly voice = { realtime: true, transcription: true, speech: true };

  async generateText(input: TextGenerationInput): Promise<TextGenerationResult> {
    const user = lastUser(input.messages);
    failIfAsked(user);
    const level = field(input.system, "LEVEL") || "A1";
    const mode = field(input.system, "MODE") || "explain";
    let text: string;
    if (user.includes("[mock:invalid]")) text = "{ not json";
    else if (input.task === "writing_feedback") text = JSON.stringify(mockWritingFeedback(input.system, user, level));
    else if (input.task === "speaking_feedback") text = JSON.stringify(mockSpeakingFeedback(user));
    else if (input.task === "speaking_reply") text = mockSpeakingReply(user, level);
    else if (input.task === "definition") text = JSON.stringify(mockDefinition(user));
    else if (input.task === "generation") text = JSON.stringify(mockGeneration(mode, user, level));
    else if (input.json) text = JSON.stringify(this.structured(user, level, mode));
    else text = `（模拟回复）You said: "${user.slice(0, 80)}". That's a good start!`;
    return { text, usage: { inputTokens: tokens(input.system + input.messages.map((m) => m.content).join(" ")), outputTokens: tokens(text) }, model: this.textModel };
  }

  private structured(user: string, level: string, mode: string) {
    const rule = RULES.find((r) => r.test.test(user));
    const corrected = rule ? rule.fix(user) : null;
    const isBeginner = level === "Pre-A1" || level === "A1";
    return {
      response_text: rule
        ? `（模拟回复）Nice try! A more natural way to say it: "${corrected}"`
        : mode === "explain"
          ? `（模拟回复）Here is a short explanation${isBeginner ? "（用简单的英语和中文）" : ""}: "${user.slice(0, 60)}" — let's look at one example together.`
          : `（模拟回复）Good! ${isBeginner ? "Short answer, one idea at a time." : "Let's go a little deeper."}`,
      level_adaptation: level,
      correction: rule ? { original: user, corrected, explanation_zh: rule.zh, explanation_en: rule.en } : null,
      new_vocabulary: [{ text: "practice", zh: "练习", example: "I practice English every day." }],
      follow_up_question: isBeginner ? "What do you do every morning?" : "Can you tell me more about that?",
      suggested_practice: rule ? [{ title: "相关语法练习", href: "/grammar" }] : [],
    };
  }

  async *streamText(input: Omit<TextGenerationInput, "json">): AsyncIterable<TextDelta> {
    const user = lastUser(input.messages);
    failIfAsked(user);
    const level = field(input.system, "LEVEL") || "A1";
    const reply =
      level === "Pre-A1" || level === "A1"
        ? `（模拟回复）That sounds nice! I like it too. What do you like to do on weekends?`
        : `（模拟回复）That's interesting. Why do you think that is? Tell me a bit more about your experience.`;
    for (const word of reply.split(/(?<= )/)) {
      if (input.signal?.aborted) return;
      yield { type: "delta", text: word };
      await new Promise((r) => setTimeout(r, 5));
    }
    yield { type: "done", usage: { inputTokens: tokens(input.system + user), outputTokens: tokens(reply) }, model: this.textModel };
  }

  /** No network: the browser runs a simulated session (clearly labelled) instead of WebRTC. */
  async connectRealtime(input: RealtimeConnectInput): Promise<RealtimeConnectResult> {
    failIfAsked(input.offerSdp);
    return { answerSdp: "mock-answer", model: "mock-realtime", credentialExpiresAt: new Date(Date.now() + 60_000) };
  }

  /**
   * Can't hear anything: near-empty audio counts as silence; otherwise the
   * expected text (read-aloud) is echoed with its last word missing, or a fixed
   * sentence with one typical mistake, so feedback has something to show.
   */
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    failIfAsked(input.expected ?? "");
    let text: string;
    if (input.audio.byteLength < 300) text = "";
    else if (input.expected) {
      const words = input.expected.trim().split(/\s+/);
      text = words.length > 3 ? words.slice(0, -1).join(" ").replace(/[,;:]$/, "") : input.expected;
    } else text = "She like reading books in the evening. It is relaxing.";
    return { text, model: "mock-transcribe", usage: { inputTokens: 0, outputTokens: tokens(text) } };
  }

  /** A short silent WAV whose length follows the text, so the speaking state is visible. */
  async synthesizeSpeech(input: SpeechInput): Promise<SpeechResult> {
    failIfAsked(input.text);
    const seconds = Math.min(2.5, Math.max(0.4, input.text.length * 0.02));
    return { audio: silentWav(seconds), mimeType: "audio/wav", model: "mock-tts", usage: { inputTokens: tokens(input.text), outputTokens: 0 } };
  }
}

/** 8 kHz, 8-bit mono PCM silence. */
export function silentWav(seconds: number): Uint8Array {
  const samples = Math.round(8000 * seconds);
  const buf = new Uint8Array(44 + samples);
  const view = new DataView(buf.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);
  buf.fill(128, 44);
  return buf;
}

// ------------------------------------------------------ speaking mock ----

function mockSpeakingReply(user: string, level: string) {
  const beginner = level === "Pre-A1" || level === "A1";
  const rule = RULES.find((r) => r.test.test(user));
  const recast = rule ? ` I see — "${rule.fix(user).slice(0, 60)}".` : "";
  return beginner ? `（模拟）Thank you!${recast} What do you like to do after work?` : `（模拟）That's interesting.${recast} Why do you think so?`;
}

/** Feedback from the learner lines of a transcript ("LEARNER: ..."). */
function mockSpeakingFeedback(user: string) {
  const lines = [...user.matchAll(/^LEARNER: (.*)$/gm)].map((m) => m[1]!.trim()).filter(Boolean);
  const all = lines.join(" ");
  const words = (all.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) ?? []).length;
  const grammar = sentencesOf(all).flatMap((s) => {
    const i = RULES.findIndex((r) => r.test.test(s));
    if (i === -1) return [];
    return [{ original: s, corrected: RULES[i]!.fix(s), explanation_zh: RULES[i]!.zh, category: CATEGORY_FOR_RULE[i], severity: "medium" }];
  });
  return {
    task_completion: { rating: words >= 8 ? "met" : words > 0 ? "partly" : "not_met", comment_zh: `（模拟反馈）一共说了 ${lines.length} 次、约 ${words} 个词。` },
    comprehensibility: { rating: "clear", comment_zh: "（模拟反馈）意思能听懂。" },
    fluency: { comment_zh: "（模拟反馈）可以试着把两个短句用 and / because 连起来说。" },
    grammar,
    vocabulary: { comment_zh: "（模拟反馈）用词适合这个话题。", suggestions: [] },
    pronunciation: { assessed: true, comment_zh: "这一条应该被系统去掉" },
    self_correction: null,
    strengths: ["敢开口，回答切题"],
    can_do_evidence: words > 0 ? ["能用简单句子谈论自己的日常"] : [],
    priorities: grammar.length > 0 ? [`先改：${grammar[0]!.explanation_zh}`] : ["下次试着每次多说一句。"],
    confidence: "high",
    limitations: ["这是模拟 AI 的反馈，只用于测试界面。"],
    next_action: "再做一次同样的任务，试着每次多说一句。",
  };
}


// ------------------------------------------------- other mock tasks ----

const POINT_FOR_RULE = ["be-verb", "present-simple", "be-verb", "articles"];
const CATEGORY_FOR_RULE = ["agreement", "agreement", "agreement", "article"];

function sentencesOf(text: string) {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Layered writing feedback built from the same simple rules as the tutor mock. */
function mockWritingFeedback(system: string, user: string, level: string) {
  const revision = user.includes("LEARNER TEXT (second version):");
  const text = user.split(/LEARNER TEXT(?: \(second version\))?:\n/).pop() ?? "";
  const [min, max] = (field(system, "WORDS") || "20-200").split("-").map(Number);
  const count = (text.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) ?? []).length;
  const grammar = sentencesOf(text).flatMap((s) => {
    const i = RULES.findIndex((r) => r.test.test(s));
    if (i === -1) return [];
    return [{ original: s, corrected: RULES[i]!.fix(s), explanation_zh: RULES[i]!.zh, category: CATEGORY_FOR_RULE[i], grammar_point: POINT_FOR_RULE[i], severity: "high" }];
  });
  const corrected = sentencesOf(text)
    .map((s) => {
      const r = RULES.find((x) => x.test.test(s));
      return r ? r.fix(s) : s;
    })
    .join(" ");
  return {
    task_completion: { rating: count >= min! ? "met" : count >= min! / 2 ? "partly" : "not_met", comment_zh: `（模拟反馈）写了 ${count} 个词，任务要求 ${min}–${max} 个词。` },
    content: { clear: true, comment_zh: "（模拟反馈）主要意思清楚。" },
    grammar,
    vocabulary: [],
    organization: { comment_zh: "（模拟反馈）句子之间可以多用 and / but / because 连接。", suggestions_zh: ["试着用 because 说明原因"] },
    natural_expressions: [],
    priorities: grammar.length > 0 ? [`先改：${grammar[0]!.explanation_zh}`] : ["这次没有明显的语法错误，可以试着写长一点。"],
    level_evidence: count >= 20 ? { level, comment_zh: "（模拟）按任务等级给出，仅用于测试。" } : null,
    confidence: "medium",
    evidence: [`共 ${count} 个词`],
    limitations: ["这是模拟 AI 的反馈，只用于测试界面，不代表真实水平。"],
    next_action: grammar.length > 0 ? "改掉标出的问题，写第二版。" : "试着加一两句细节。",
    model_rewrite: corrected,
    comparison: revision ? { improved: grammar.length === 0 ? ["第一版的语法问题都改好了"] : [], still_to_fix: grammar.map((g) => g.explanation_zh) } : null,
  };
}

function mockDefinition(user: string) {
  const word = user.match(/^WORD:\s*(.+)$/m)?.[1]?.trim() ?? "word";
  const sentence = user.match(/^SENTENCE:\s*(.+)$/m)?.[1]?.trim() ?? null;
  return { text: word, pos: null, ipa: null, zh: `（模拟释义）${word}`, explanation_zh: "这是模拟 AI 生成的释义，只用于测试界面。", example_en: sentence, example_zh: null };
}

function mockGeneration(mode: string, user: string, level: string) {
  if (mode === "generate_enrichment") {
    const lines = [...user.matchAll(/^\[(\d+)\] (.+)$/gm)].map((m) => ({ n: Number(m[1]), en: m[2]! }));
    const candidates = [...new Set(lines.flatMap((l) => l.en.match(/[A-Za-z]{6,}/g) ?? []).map((w) => w.toLowerCase()))].slice(0, 3);
    return {
      glossary: [...candidates.map((w) => ({ text: w, pos: "word", ipa: null, zh: `（模拟释义）${w}`, note_zh: null })), { text: "notinthetextatall", pos: "noun", zh: "不存在的词" }],
      questions: [
        { prompt_zh: "（模拟题）第一句讲的是什么？", options: [lines[0]?.en.slice(0, 60) ?? "A", "Something else", "Nothing"], answer: 0, explanation_zh: "看第一句。", segment: 0 },
        { prompt_zh: "（模拟题）这段材料一共有几句？", options: [String(lines.length), String(lines.length + 3)], answer: 0, explanation_zh: "数一数。", segment: lines.length - 1 },
      ],
    };
  }
  if (mode.startsWith("generate_graded_")) {
    const topic = user.match(/^TOPIC:\s*(.+)$/m)?.[1]?.trim() ?? "music";
    const dialogue = mode === "generate_graded_listening";
    const lines = [
      ["Lin", `Hi Max, do you like ${topic}?`, `嗨 Max，你喜欢${topic}吗？`],
      ["Max", `Yes, I do. I spend some time on it every weekend.`, `喜欢。我每个周末都花一些时间在上面。`],
      ["Lin", "That sounds fun. How did you start?", "听起来很有意思。你是怎么开始的？"],
      ["Max", "My sister showed me last year.", "去年我姐姐教我的。"],
      ["Lin", "Was it difficult at first?", "一开始难吗？"],
      ["Max", "A little, but now it is easy.", "有一点，不过现在很容易了。"],
      ["Lin", "Can you show me this weekend?", "这个周末你能教教我吗？"],
      ["Max", "Sure. See you on Saturday!", "当然。周六见！"],
    ];
    return {
      title_en: dialogue ? `Talking About ${topic}` : `Max and ${topic}`,
      title_zh: `（模拟）关于${topic}`,
      summary_zh: `（模拟生成）两个朋友聊${topic}。`,
      segments: lines.map(([speaker, en, zh]) => ({ speaker: dialogue ? speaker : null, en: dialogue ? en : en!.replace(/^Hi Max, /, "Lin asks: "), zh })),
      glossary: [
        { text: "weekend", pos: "noun", ipa: null, zh: "周末", note_zh: null },
        { text: "showed", pos: "verb", ipa: null, zh: "教；给……看（show 的过去式）", note_zh: null },
        { text: "difficult", pos: "adjective", ipa: null, zh: "困难的", note_zh: null },
      ],
      questions: [
        { prompt_zh: "Max 什么时候练习？", options: ["每个周末", "每天早上", "从来不"], answer: 0, explanation_zh: "I spend some time on it every weekend.", segment: 1 },
        { prompt_zh: "谁教 Max 的？", options: ["他的姐姐", "他的老师", "Lin"], answer: 0, explanation_zh: "My sister showed me last year.", segment: 3 },
      ],
      level_note: level,
    };
  }
  if (mode === "generate_micro_lesson") {
    const wrong = user.match(/^WRONG: (.*) → RIGHT: (.*)$/m);
    const bad = wrong?.[1]?.trim() || "She are happy.";
    const good = wrong?.[2]?.trim() || "She is happy.";
    return {
      title_zh: "（模拟微课）再看一遍这个错误",
      explanation_zh: "（模拟）先找到句子的主语，再决定动词的形式。",
      examples: [{ en: good, zh: "（模拟）正确的说法" }],
      exercises: [
        { type: "choice", difficulty: 1, prompt_zh: "哪一句是对的？", options: [good, bad], answer: 0, explanation_zh: "第一句是正确的。" },
        { type: "correction", difficulty: 2, wrong_en: "He are my brother.", translation_zh: "他是我哥哥。", answers: ["He is my brother.", "He's my brother."], explanation_zh: "he 用 is。" },
        { type: "cloze", difficulty: 2, sentence_en: "They ___ at home.", translation_zh: "他们在家。", answers: ["are"], explanation_zh: "they 用 are。" },
        { type: "essay", nonsense: true },
      ],
    };
  }
  return {};
}

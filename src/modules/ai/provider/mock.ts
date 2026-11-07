import { AIError, AI_ERROR_CODES, type AIErrorCode } from "./errors";
import type { AIProvider, ChatMessage, TextDelta, TextGenerationInput, TextGenerationResult } from "./types";

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

  async generateText(input: TextGenerationInput): Promise<TextGenerationResult> {
    const user = lastUser(input.messages);
    failIfAsked(user);
    const level = field(input.system, "LEVEL") || "A1";
    const mode = field(input.system, "MODE") || "explain";
    let text: string;
    if (user.includes("[mock:invalid]")) text = "{ not json";
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
}

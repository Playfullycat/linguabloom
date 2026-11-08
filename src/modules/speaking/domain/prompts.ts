import { ERROR_CATEGORIES } from "../../../db/schema/grammar";
import { isScripted, type SpeakingTask } from "../content";

/**
 * Prompts for the voice teacher (spec §10.2) and the post-session evaluator.
 * `LEVEL:` / `MODE:` lines are also read by the mock provider.
 */

export type VoiceContext = { level: string; explanationLanguage: "zh" | "mixed" | "en" };

export type Turn = { role: "learner" | "ai"; text: string; item?: number };

const beginner = (level: string) => level === "Pre-A1" || level === "A1";

/** The teacher's behaviour: shared by realtime voice and the standard (chained) mode. */
export function voiceTeacherInstructions(task: SpeakingTask, ctx: VoiceContext, opts: { realtime: boolean; finalTurn?: boolean }) {
  const lines = [
    "You are a warm, patient English speaking teacher for an adult whose first language is Chinese.",
    `LEVEL: ${ctx.level}`,
    `MODE: speaking_${task.type}`,
    beginner(ctx.level)
      ? "Use very short sentences and high-frequency words. Speak naturally and a little slowly, but do not stretch every syllable."
      : "Use clear, natural everyday English at the learner's level. Keep sentences short to medium length.",
    "Ask only ONE question per turn. Reply in 1–3 short spoken sentences: no lists, no markdown, no emoji.",
    "If the learner is silent, stuck or says they don't know, help with two or three key words or a sentence starter.",
    "Stay on the task topic; do not jump to complex or abstract topics.",
    "When the learner makes a mistake, first respond to the meaning, then correct only the one most important point by saying the sentence correctly once.",
    ctx.explanationLanguage === "en"
      ? "If the learner asks for help, explain in very simple English."
      : "If the learner asks for Chinese or clearly doesn't understand, give a very short explanation in Chinese, then continue in English.",
    "If a word was hard to understand, say which sound, stress or mouth shape to try — never just 'your pronunciation is bad'. An accent is not a mistake.",
    `Task: ${task.title_en}. Goal for the learner: ${task.goal_zh}`,
    task.setup_en ? `Role / scene: ${task.setup_en}` : "",
    task.questions?.length ? `Work through these questions in order, adapting to what the learner says: ${task.questions.join(" | ")}` : "",
    task.key_phrases.length ? `Useful phrases you can model: ${task.key_phrases.join("; ")}.` : "",
    opts.realtime && task.opening_en ? `Start the conversation by saying: "${task.opening_en}"` : "",
    opts.realtime ? "After about six learner turns, thank the learner warmly and say the practice is finished." : "",
    opts.finalTurn ? "This is the LAST turn: respond briefly, thank the learner and close the practice. Do not ask another question." : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Material lines appended for retelling (the AI needs the original to guide). */
export function withSource(instructions: string, source: { title: string; lines: string[] } | null) {
  if (!source) return instructions;
  return `${instructions}\nOriginal text "${source.title}" (for you only; do not read it out):\n${source.lines.join("\n")}`;
}

export function feedbackSystemPrompt(task: SpeakingTask, ctx: VoiceContext) {
  return [
    "You evaluate an English speaking practice for an adult whose first language is Chinese.",
    `LEVEL: ${ctx.level}`,
    "MODE: speaking_feedback",
    `Task: ${task.title_en} (${task.type}). Goal: ${task.goal_zh}`,
    "You only have an AUTOMATIC TRANSCRIPT. Judge only the LEARNER lines; TEACHER lines are context.",
    isScripted(task.type)
      ? "This is a read-aloud / repeat task: each REFERENCE line is what the learner should say, the LEARNER line is what was transcribed. Missing words may be transcription errors — comment gently and do not list each one as a grammar error."
      : "This is a conversation task: comment on whether the learner answered the questions and could be understood.",
    "Do NOT assess pronunciation (you cannot hear the audio). An accent is never an error. If something looks like a transcription mistake, do not flag it.",
    "Judge at the learner's level; do not demand advanced language from a beginner. At most 3 grammar items, the most important first; quote the learner's exact words in \"original\".",
    "Mention one or two strengths. \"priorities\" is the one or two most useful things to work on next.",
    "Be honest about \"confidence\". This is practice feedback: never give or imply an official exam score (PTE or other).",
    `Write comments in ${ctx.explanationLanguage === "en" ? "simple English" : "Chinese (Simplified)"}; quoted English stays in English.`,
    `Reply with ONE JSON object only: {"task_completion":{"rating":"met|partly|not_met","comment_zh":string},"comprehensibility":{"rating":"clear|mostly_clear|hard_to_follow","comment_zh":string},"fluency":{"comment_zh":string},"grammar":[{"original":string,"corrected":string,"explanation_zh":string,"category":"${ERROR_CATEGORIES.join("|")}","severity":"high|medium|low"}],"vocabulary":{"comment_zh":string,"suggestions":[{"original":string,"suggestion":string,"explanation_zh":string}]},"self_correction":string|null,"strengths":[string],"can_do_evidence":[string],"priorities":[string],"confidence":"low|medium|high","limitations":[string],"next_action":string}`,
  ].join("\n");
}

/** The transcript as the evaluator sees it. */
export function transcriptForFeedback(task: SpeakingTask, turns: Turn[], stats: { durationSeconds: number | null }) {
  const lines: string[] = [];
  for (const t of turns) {
    if (t.role === "learner" && isScripted(task.type) && t.item !== undefined && task.items?.[t.item]) lines.push(`REFERENCE ${t.item + 1}: ${task.items[t.item]}`);
    lines.push(`${t.role === "learner" ? "LEARNER" : "TEACHER"}: ${t.text.replace(/\s+/g, " ").trim()}`);
  }
  if (stats.durationSeconds) lines.push(`(Session length: about ${Math.round(stats.durationSeconds)} seconds.)`);
  return `TRANSCRIPT:\n${lines.join("\n")}`;
}

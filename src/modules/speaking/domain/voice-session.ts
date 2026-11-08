/**
 * Realtime voice session state (spec §5.10 session flow, §14.2 audio):
 * connecting → listening ⇄ thinking ⇄ speaking → ended | failed.
 *
 * A pure reducer over the provider's data-channel events (OpenAI Realtime;
 * both the GA and the older beta event names) plus a few local events. The
 * simulated session used with AI_PROVIDER=mock emits the same events, so the
 * UI logic is the same in both.
 */

export type VoicePhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended" | "failed";

export type LiveTurn = { id: string; role: "learner" | "ai"; text: string; final: boolean; interrupted: boolean; startedAt: number; endedAt: number | null };

export type VoiceState = {
  phase: VoicePhase;
  turns: LiveTurn[];
  /** Why the session failed (shown to the learner), or a non-fatal provider warning. */
  error: string | null;
  learnerSpeaking: boolean;
  /** Seconds the learner was speaking (from VAD start/stop), for the rate estimate. */
  learnerSpeechMs: number;
};

export const initialVoiceState: VoiceState = { phase: "idle", turns: [], error: null, learnerSpeaking: false, learnerSpeechMs: 0 };

export type LocalEvent =
  | { type: "local.connecting" }
  | { type: "local.connected" }
  | { type: "local.failed"; message: string }
  | { type: "local.interrupt" }
  | { type: "local.ended" };

/** Loose shape of provider events: only the fields we read. */
export type ProviderEvent = {
  type: string;
  item_id?: string;
  response_id?: string;
  delta?: string;
  transcript?: string;
  response?: { id?: string; status?: string };
  error?: { message?: string; code?: string };
};

export type VoiceEvent = LocalEvent | ProviderEvent;

const AI_DELTA = new Set(["response.output_audio_transcript.delta", "response.audio_transcript.delta", "response.output_text.delta", "response.text.delta"]);
const AI_DONE = new Set(["response.output_audio_transcript.done", "response.audio_transcript.done", "response.output_text.done", "response.text.done"]);

const isOver = (s: VoiceState) => s.phase === "ended" || s.phase === "failed";

/** Session stops: unfinished teacher lines were cut off (interrupted); unfinished learner lines just end. */
function closeOpen(turns: LiveTurn[], now: number): LiveTurn[] {
  return turns.map((t) => (t.final ? t : { ...t, final: true, endedAt: now, interrupted: t.role === "ai" }));
}

function upsert(turns: LiveTurn[], id: string, role: LiveTurn["role"], now: number, patch: (t: LiveTurn) => LiveTurn): LiveTurn[] {
  const i = turns.findIndex((t) => t.id === id);
  if (i === -1) return [...turns, patch({ id, role, text: "", final: false, interrupted: false, startedAt: now, endedAt: null })];
  const next = [...turns];
  next[i] = patch(next[i]!);
  return next;
}

/** Mark the AI turn that is still being spoken as interrupted. */
function interruptAi(turns: LiveTurn[], now: number): LiveTurn[] {
  return turns.map((t) => (t.role === "ai" && !t.final ? { ...t, final: true, interrupted: true, endedAt: now } : t));
}

export function voiceReducer(state: VoiceState, event: VoiceEvent, now = Date.now()): VoiceState {
  switch (event.type) {
    case "local.connecting":
      // A reconnect keeps what was already said.
      return { ...initialVoiceState, turns: closeOpen(state.turns, now), learnerSpeechMs: state.learnerSpeechMs, phase: "connecting" };
    case "local.connected":
      return state.phase === "connecting" ? { ...state, phase: "thinking" } : state;
    case "local.failed":
      return isOver(state) ? state : { ...state, phase: "failed", error: (event as { message: string }).message, learnerSpeaking: false, turns: closeOpen(state.turns, now) };
    case "local.ended":
      return isOver(state) ? state : { ...state, phase: "ended", learnerSpeaking: false, turns: closeOpen(state.turns, now) };
    case "local.interrupt":
      return isOver(state) ? state : { ...state, phase: "listening", turns: interruptAi(state.turns, now) };
  }
  if (isOver(state)) return state;
  const e = event as ProviderEvent;

  if (e.type === "input_audio_buffer.speech_started") {
    // The learner talks over the AI: the AI stops (server VAD cancels the response).
    const turns = interruptAi(state.turns, now);
    return { ...state, phase: "listening", learnerSpeaking: true, turns: e.item_id ? upsert(turns, e.item_id, "learner", now, (t) => t) : turns };
  }
  if (e.type === "input_audio_buffer.speech_stopped") {
    const started = e.item_id ? state.turns.find((t) => t.id === e.item_id)?.startedAt : undefined;
    return { ...state, phase: "thinking", learnerSpeaking: false, learnerSpeechMs: state.learnerSpeechMs + (started ? Math.max(0, now - started) : 0) };
  }
  if (e.type === "conversation.item.input_audio_transcription.delta" && e.item_id) {
    return { ...state, turns: upsert(state.turns, e.item_id, "learner", now, (t) => ({ ...t, text: t.text + (e.delta ?? "") })) };
  }
  if (e.type === "conversation.item.input_audio_transcription.completed" && e.item_id) {
    return { ...state, turns: upsert(state.turns, e.item_id, "learner", now, (t) => ({ ...t, text: (e.transcript ?? t.text).trim(), final: true, endedAt: now })) };
  }
  if (e.type === "conversation.item.input_audio_transcription.failed" && e.item_id) {
    return { ...state, turns: upsert(state.turns, e.item_id, "learner", now, (t) => ({ ...t, text: t.text || "（这句没有转写出来）", final: true, endedAt: now })) };
  }
  if (e.type === "response.created") {
    return { ...state, phase: state.learnerSpeaking ? state.phase : "thinking" };
  }
  if (AI_DELTA.has(e.type)) {
    const id = e.item_id ?? e.response_id ?? "ai";
    return { ...state, phase: "speaking", turns: upsert(state.turns, id, "ai", now, (t) => (t.final ? t : { ...t, text: t.text + (e.delta ?? "") })) };
  }
  if (AI_DONE.has(e.type)) {
    const id = e.item_id ?? e.response_id ?? "ai";
    return { ...state, turns: upsert(state.turns, id, "ai", now, (t) => (t.interrupted ? t : { ...t, text: e.transcript ?? t.text, final: true, endedAt: now })) };
  }
  if (e.type === "output_audio_buffer.started") return { ...state, phase: "speaking" };
  if (e.type === "output_audio_buffer.stopped" || e.type === "output_audio_buffer.cleared") {
    return { ...state, phase: "listening" };
  }
  if (e.type === "response.done") {
    const cancelled = e.response?.status === "cancelled";
    const turns = cancelled ? interruptAi(state.turns, now) : state.turns;
    // With WebRTC the audio may still be playing; output_audio_buffer.stopped moves to listening.
    return { ...state, turns, phase: state.phase === "thinking" ? "listening" : state.phase };
  }
  if (e.type === "error") {
    // Provider errors on a live session are usually recoverable (e.g. a cancelled response); keep going.
    return { ...state, error: e.error?.message ? `AI 服务提示：${e.error.message.slice(0, 160)}` : state.error };
  }
  return state;
}

/** The turns worth keeping: final, non-empty, in order. */
export function finalTurns(state: VoiceState): { role: "learner" | "ai"; text: string; interrupted: boolean }[] {
  return state.turns.filter((t) => t.text.trim() !== "").map((t) => ({ role: t.role, text: t.text.trim(), interrupted: t.interrupted }));
}

export const PHASE_LABELS: Record<VoicePhase, string> = {
  idle: "还没开始",
  connecting: "正在连接…",
  listening: "在听你说",
  thinking: "正在想…",
  speaking: "老师在说话",
  ended: "已结束",
  failed: "连接中断",
};

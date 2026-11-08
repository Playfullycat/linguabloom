/**
 * Business contract for AI providers (spec §7.6). Implementations translate
 * to and from a vendor API; nothing vendor-specific leaks past this file.
 */

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** What the request is for: used for usage records, budgets and the mock provider. */
export type AITask =
  | "tutor_structured"
  | "tutor_chat"
  | "writing_feedback"
  | "definition"
  | "generation"
  | "speaking_feedback"
  | "speaking_reply"
  | "speaking_realtime"
  | "transcription"
  | "speech";

export type TextGenerationInput = {
  task: AITask;
  system: string;
  messages: ChatMessage[];
  /** Ask for a single JSON object (validated by the caller with Zod). */
  json: boolean;
  maxOutputTokens: number;
  signal?: AbortSignal;
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type TextGenerationResult = { text: string; usage: TokenUsage; model: string };

export type TextDelta = { type: "delta"; text: string } | { type: "done"; usage: TokenUsage; model: string };

/** Which voice features this provider can serve (each needs its own model). */
export type VoiceCapabilities = { realtime: boolean; transcription: boolean; speech: boolean };

export type RealtimeConnectInput = {
  /** The browser's WebRTC SDP offer. */
  offerSdp: string;
  instructions: string;
  voice: string;
  signal?: AbortSignal;
};

/**
 * The server mints a short-lived provider credential, uses it once for the
 * SDP exchange and discards it: the browser receives only the answer SDP.
 */
export type RealtimeConnectResult = { answerSdp: string; model: string; credentialExpiresAt: Date };

export type TranscriptionInput = {
  audio: Uint8Array;
  mimeType: string;
  /** Spelling hints (key words of the task), never the expected answer. */
  hint?: string;
  /** Only the mock provider reads this (to simulate a transcript); real providers never send it. */
  expected?: string;
  signal?: AbortSignal;
};
export type TranscriptionResult = { text: string; model: string; usage: TokenUsage };

export type SpeechInput = { text: string; voice: string; slow: boolean; signal?: AbortSignal };
export type SpeechResult = { audio: Uint8Array; mimeType: string; model: string; usage: TokenUsage };

export interface AIProvider {
  readonly name: "openai" | "mock";
  readonly textModel: string;
  readonly voice: VoiceCapabilities;
  generateText(input: TextGenerationInput): Promise<TextGenerationResult>;
  streamText(input: Omit<TextGenerationInput, "json">): AsyncIterable<TextDelta>;
  connectRealtime(input: RealtimeConnectInput): Promise<RealtimeConnectResult>;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
  synthesizeSpeech(input: SpeechInput): Promise<SpeechResult>;
}

/**
 * Business contract for AI providers (spec §7.6). Implementations translate
 * to and from a vendor API; nothing vendor-specific leaks past this file.
 */

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** What the request is for: used for usage records, budgets and the mock provider. */
export type AITask = "tutor_structured" | "tutor_chat" | "writing_feedback" | "definition" | "generation" | "speaking_feedback";

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

export interface AIProvider {
  readonly name: "openai" | "mock";
  readonly textModel: string;
  generateText(input: TextGenerationInput): Promise<TextGenerationResult>;
  streamText(input: Omit<TextGenerationInput, "json">): AsyncIterable<TextDelta>;
}

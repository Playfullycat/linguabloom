import { AIError, codeForStatus } from "./errors";
import type { AIProvider, TextDelta, TextGenerationInput, TextGenerationResult, TokenUsage } from "./types";

/**
 * OpenAI (or an OpenAI-compatible endpoint) via the Chat Completions API.
 * Server-only: the key is read from the environment and never returned.
 */

type Config = { apiKey: string; baseUrl: string; textModel: string; timeoutMs: number; fetchImpl?: typeof fetch };

type ChatCompletion = {
  model?: string;
  choices?: { message?: { content?: string | null }; delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

const usageOf = (u: ChatCompletion["usage"]): TokenUsage => ({ inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0 });

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;
  readonly textModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: Config) {
    this.textModel = config.textModel;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private body(input: Omit<TextGenerationInput, "json"> & { json?: boolean }, stream: boolean) {
    return JSON.stringify({
      model: this.textModel,
      messages: [{ role: "system", content: input.system }, ...input.messages],
      max_completion_tokens: input.maxOutputTokens,
      ...(input.json ? { response_format: { type: "json_object" } } : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    });
  }

  private async post(body: string, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
        body,
        signal: combined,
      });
    } catch (error) {
      if (timeout.aborted) throw new AIError("timeout");
      if (signal?.aborted) throw new AIError("unknown", "aborted");
      throw new AIError("network", error instanceof Error ? error.name : undefined);
    }
    if (!res.ok) throw new AIError(codeForStatus(res.status), `HTTP ${res.status}`);
    return res;
  }

  async generateText(input: TextGenerationInput): Promise<TextGenerationResult> {
    const res = await this.post(this.body(input, false), input.signal);
    let data: ChatCompletion;
    try {
      data = (await res.json()) as ChatCompletion;
    } catch {
      throw new AIError("invalid_response", "body is not JSON");
    }
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) throw new AIError("invalid_response", "empty content");
    return { text, usage: usageOf(data.usage), model: data.model ?? this.textModel };
  }

  async *streamText(input: Omit<TextGenerationInput, "json">): AsyncIterable<TextDelta> {
    const res = await this.post(this.body(input, true), input.signal);
    if (!res.body) throw new AIError("invalid_response", "no stream");
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let model = this.textModel;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        let chunk: ChatCompletion;
        try {
          chunk = JSON.parse(payload) as ChatCompletion;
        } catch {
          continue;
        }
        if (chunk.model) model = chunk.model;
        if (chunk.usage) usage = usageOf(chunk.usage);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield { type: "delta", text: delta };
      }
    }
    yield { type: "done", usage, model };
  }
}

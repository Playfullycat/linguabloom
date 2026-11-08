import { AIError, codeForStatus } from "./errors";
import type {
  AIProvider,
  RealtimeConnectInput,
  RealtimeConnectResult,
  SpeechInput,
  SpeechResult,
  TextDelta,
  TextGenerationInput,
  TextGenerationResult,
  TokenUsage,
  TranscriptionInput,
  TranscriptionResult,
  VoiceCapabilities,
} from "./types";

/**
 * OpenAI (or an OpenAI-compatible endpoint): Chat Completions for text,
 * Realtime (WebRTC) for live voice, audio endpoints for transcription and
 * speech. Server-only: the key is read from the environment and never returned.
 */

type Config = {
  apiKey: string;
  baseUrl: string;
  textModel: string;
  realtimeModel?: string;
  transcriptionModel?: string;
  ttsModel?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

type ChatCompletion = {
  model?: string;
  choices?: { message?: { content?: string | null }; delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

const usageOf = (u: ChatCompletion["usage"]): TokenUsage => ({ inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0 });

/** Realtime credentials live just long enough for one SDP exchange. */
export const REALTIME_CREDENTIAL_SECONDS = 60;

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;
  readonly textModel: string;
  readonly voice: VoiceCapabilities;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: Config) {
    this.textModel = config.textModel;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.voice = { realtime: Boolean(config.realtimeModel), transcription: Boolean(config.transcriptionModel), speech: Boolean(config.ttsModel) };
  }

  private url(path: string) {
    return `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
  }

  /** One request with timeout, error mapping and no secrets in errors. */
  private async send(path: string, init: { body: BodyInit; contentType?: string; bearer?: string; signal?: AbortSignal }): Promise<Response> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const headers: Record<string, string> = { Authorization: `Bearer ${init.bearer ?? this.config.apiKey}` };
    if (init.contentType) headers["Content-Type"] = init.contentType;
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path), { method: "POST", headers, body: init.body, signal: combined });
    } catch (error) {
      if (timeout.aborted) throw new AIError("timeout");
      if (init.signal?.aborted) throw new AIError("unknown", "aborted");
      throw new AIError("network", error instanceof Error ? error.name : undefined);
    }
    if (!res.ok) throw new AIError(codeForStatus(res.status), `HTTP ${res.status} ${path}`);
    return res;
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

  async generateText(input: TextGenerationInput): Promise<TextGenerationResult> {
    const res = await this.send("/chat/completions", { body: this.body(input, false), contentType: "application/json", signal: input.signal });
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
    const res = await this.send("/chat/completions", { body: this.body(input, true), contentType: "application/json", signal: input.signal });
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

  /**
   * 1) mint a short-lived client secret for exactly this session configuration,
   * 2) use it once to exchange SDP (POST /realtime/calls), 3) forget it.
   * Media then flows directly between the browser and the provider over WebRTC.
   */
  async connectRealtime(input: RealtimeConnectInput): Promise<RealtimeConnectResult> {
    const model = this.config.realtimeModel;
    if (!model) throw new AIError("not_configured", "no realtime model");
    const secretRes = await this.send("/realtime/client_secrets", {
      contentType: "application/json",
      signal: input.signal,
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: REALTIME_CREDENTIAL_SECONDS },
        session: {
          type: "realtime",
          model,
          instructions: input.instructions,
          audio: {
            input: {
              transcription: { model: this.config.transcriptionModel ?? "whisper-1", language: "en" },
              turn_detection: { type: "server_vad", silence_duration_ms: 800, create_response: true, interrupt_response: true },
            },
            output: { voice: input.voice },
          },
        },
      }),
    });
    let secret: { value?: string; expires_at?: number; client_secret?: { value?: string; expires_at?: number } };
    try {
      secret = (await secretRes.json()) as typeof secret;
    } catch {
      throw new AIError("invalid_response", "client secret is not JSON");
    }
    const value = secret.value ?? secret.client_secret?.value;
    const expiresAt = secret.expires_at ?? secret.client_secret?.expires_at;
    if (!value) throw new AIError("invalid_response", "no client secret");
    const callRes = await this.send("/realtime/calls", { body: input.offerSdp, contentType: "application/sdp", bearer: value, signal: input.signal });
    const answerSdp = await callRes.text();
    if (!answerSdp.startsWith("v=")) throw new AIError("invalid_response", "answer is not SDP");
    return { answerSdp, model, credentialExpiresAt: new Date(expiresAt ? expiresAt * 1000 : Date.now() + REALTIME_CREDENTIAL_SECONDS * 1000) };
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const model = this.config.transcriptionModel;
    if (!model) throw new AIError("not_configured", "no transcription model");
    const form = new FormData();
    const type = input.mimeType.split(";")[0]!;
    form.append("file", new Blob([input.audio as BlobPart], { type }), `speech.${EXT[type] ?? "webm"}`);
    form.append("model", model);
    form.append("language", "en");
    form.append("response_format", "json");
    if (input.hint) form.append("prompt", input.hint.slice(0, 400));
    const res = await this.send("/audio/transcriptions", { body: form, signal: input.signal });
    let data: { text?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new AIError("invalid_response", "transcription is not JSON");
    }
    if (typeof data.text !== "string") throw new AIError("invalid_response", "no transcription text");
    return { text: data.text.trim(), model, usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 } };
  }

  async synthesizeSpeech(input: SpeechInput): Promise<SpeechResult> {
    const model = this.config.ttsModel;
    if (!model) throw new AIError("not_configured", "no speech model");
    const res = await this.send("/audio/speech", {
      contentType: "application/json",
      signal: input.signal,
      body: JSON.stringify({ model, input: input.text, voice: input.voice, response_format: "mp3", speed: input.slow ? 0.9 : 1 }),
    });
    const audio = new Uint8Array(await res.arrayBuffer());
    if (audio.byteLength === 0) throw new AIError("invalid_response", "empty audio");
    return { audio, mimeType: "audio/mpeg", model, usage: { inputTokens: Math.ceil(input.text.length / 4), outputTokens: 0 } };
  }
}

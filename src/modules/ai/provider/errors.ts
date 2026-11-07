/**
 * AI failures the learner can understand (spec §14.2: "Provider 错误能显示可理解的错误").
 * Never includes keys, authorization headers or raw provider bodies.
 */

export const AI_ERROR_CODES = [
  "not_configured",
  "budget_exceeded",
  "rate_limited",
  "timeout",
  "auth",
  "provider_unavailable",
  "invalid_response",
  "network",
  "unknown",
] as const;
export type AIErrorCode = (typeof AI_ERROR_CODES)[number];

export const AI_ERROR_MESSAGES: Record<AIErrorCode, string> = {
  not_configured: "AI 还没有配置。其他学习功能照常可用；在 .env 里设置 AI_ENABLED、AI_PROVIDER 等即可启用。",
  budget_exceeded: "本月的 AI 预算已经用完，AI 功能先暂停。可以在 .env 里调整 AI_MONTHLY_BUDGET，或者等下个月。",
  rate_limited: "请求太频繁了，或者 AI 服务那边限流了。请稍等一会儿再试。",
  timeout: "AI 服务响应太慢，已经超时。请稍后再试。",
  auth: "AI 服务拒绝了请求：密钥无效或没有权限。请检查 AI_API_KEY。",
  provider_unavailable: "AI 服务暂时不可用，请稍后再试。",
  invalid_response: "AI 返回的内容格式不对，这次没法用。请再试一次。",
  network: "连不上 AI 服务，请检查网络或 AI_BASE_URL。",
  unknown: "AI 请求失败了，请稍后再试。",
};

export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    /** Short technical detail for server logs only (no secrets). */
    public readonly detail?: string,
  ) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
  }
}

/** Map an HTTP status from a provider to an error code. */
export function codeForStatus(status: number): AIErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status === 408) return "timeout";
  if (status >= 500) return "provider_unavailable";
  return "unknown";
}

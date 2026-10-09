const INSUFFICIENT_BALANCE_PATTERNS: RegExp[] = [
  /provider\s+balance\s+is\s+insufficient/i,
  /insufficient\s+balance/i,
];

const MODEL_UNSUPPORTED_PATTERNS: RegExp[] = [
  /当前\s*api\s*不支持所选模型/i,
  /不支持所选模型/i,
  /不支持.*模型/i,
  /模型.*不支持/i,
  /unsupported\s+model/i,
  /model\s+not\s+supported/i,
  /does\s+not\s+support(?:\s+the)?\s+model/i,
  /model.*does\s+not\s+exist/i,
  /no\s+such\s+model/i,
  /unknown\s+model/i,
  /unknown\s+provider\s+for\s+model/i,
  /invalid\s+model/i,
  /model[_\s-]?not[_\s-]?found/i,
  /you\s+do\s+not\s+have\s+access\s+to\s+the\s+model/i,
];

const MODEL_CONTENT_UNSUPPORTED_PATTERNS: RegExp[] = [
  /does\s+not\s+support\s+(image|image[_\s-]input|vision|multimodal|multimodal[_\s-]input)/i,
  /vision[_\s-]capable\s+model/i,
  /does\s+not\s+support\s+(audio|video|file)[_\s-]input/i,
  /不支持.*图片/i,
  /不支持.*视觉/i,
  /不支持.*多模态/i,
];

export const RETRYABLE_TIMEOUT_PATTERNS: RegExp[] = [
  /(request timed out|connection timed out|read timeout|first byte timeout|\btimed out\b)/i,
];

const RETRYABLE_CHANNEL_LOCAL_PATTERNS: RegExp[] = [
  /unsupported\s+legacy\s+protocol/i,
  /please\s+use\s+\/v1\/responses/i,
  /please\s+use\s+\/v1\/messages/i,
  /please\s+use\s+\/v1\/chat\/completions/i,
  /does\s+not\s+allow\s+\/v1\/[a-z0-9/_:-]+\s+dispatch/i,
  /unsupported\s+endpoint/i,
  /unsupported\s+path/i,
  /unknown\s+endpoint/i,
  /unrecognized\s+request\s+url/i,
  /no\s+route\s+matched/i,
  /invalid\s+api\s+key/i,
  /invalid\s+access\s+token/i,
  /forbidden/i,
  /rate\s+limit/i,
  /quota/i,
  /bad\s+gateway/i,
  /gateway\s+time-?out/i,
  /service\s+unavailable/i,
  /cpu\s+overloaded/i,
  ...RETRYABLE_TIMEOUT_PATTERNS,
];

const NON_RETRYABLE_REQUEST_PATTERNS: RegExp[] = [
  /invalid\s+request\s+body/i,
  /validation/i,
  /missing\s+required/i,
  /required\s+parameter/i,
  /unknown\s+parameter/i,
  /unrecognized\s+(field|key|parameter)/i,
  /malformed/i,
  /invalid\s+json/i,
  /cannot\s+parse/i,
  /unsupported\s+media\s+type/i,
];

const SAME_SITE_ENDPOINT_ABORT_PATTERNS: RegExp[] = [
  /\b429\b/i,
  /too\s+many\s+requests/i,
  /rate\s+limit/i,
  /quota(?:\s+exceeded)?/i,
  /bad\s+gateway/i,
  /gateway\s+time-?out/i,
  /service\s+unavailable/i,
  /temporar(?:y|ily)\s+unavailable/i,
  /cpu\s+overloaded/i,
  /connection\s+reset/i,
  /connection\s+refused/i,
  /econnreset/i,
  /econnrefused/i,
  ...RETRYABLE_TIMEOUT_PATTERNS,
];

function isModelUnsupportedErrorMessage(rawMessage?: string | null): boolean {
  const text = (rawMessage || '').trim();
  if (!text) return false;
  return MODEL_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 识别「模型不支持该内容类型」类错误（图片 / vision / 多模态）。
 *
 * 这类错误通常是中转站点自行限制了多模态能力，而不是模型本身不支持
 * （如 GLM-5.3-Flash 官方支持图片，但部分站点屏蔽），属于渠道级能力缺陷：
 * 换一个支持图片的渠道即可成功，因此应触发 failover 而不是把 400 透传给客户端。
 */
/**
 * 识别「工具调用协议不匹配」类错误。
 *
 * 这类错误说明本渠道上游对工具调用的结构校验比转换后请求更严格，
 * 换一个协议兼容性更好的渠道即可成功，属于渠道级能力缺陷，
 * 因此应触发 failover，而不是把 400 透传给客户端。
 */
const TOOL_PROTOCOL_MISMATCH_PATTERNS: RegExp[] = [
  /no\s+tool\s+output\s+found\s+for\s+function\s+call/i,
  /tool_use[_\s-]?id[_\s-]?without\s+tool_result/i,
  /missing\s+tool[_ ]?(result|output|response)/i,
  /tool[_ ]?(result|output)[_\s-]?(is\s+)?(required|missing)/i,
];

function isModelContentUnsupportedErrorMessage(rawMessage?: string | null): boolean {
  const text = (rawMessage || '').trim();
  if (!text) return false;
  return MODEL_CONTENT_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(text));
}

function isToolProtocolMismatchErrorMessage(rawMessage?: string | null): boolean {
  const text = (rawMessage || '').trim();
  if (!text) return false;
  return TOOL_PROTOCOL_MISMATCH_PATTERNS.some((pattern) => pattern.test(text));
}

function matchesAnyPattern(patterns: RegExp[], rawMessage?: string | null): boolean {
  const text = (rawMessage || '').trim();
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

export function shouldRetryProxyRequest(status: number, upstreamErrorText?: string | null): boolean {
  if (status >= 500) return true;
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status === 401 || status === 403) return true;
  // 413 表示请求体超出该渠道/站点的请求体上限（具体限制位置由站点部署决定），
  // 请求本身合法，换一个限制更宽松的渠道可能成功，策略上优先跨渠道 failover。
  if (status === 413) return true;
  if (status === 402) return matchesAnyPattern(INSUFFICIENT_BALANCE_PATTERNS, upstreamErrorText);
  if (isModelUnsupportedErrorMessage(upstreamErrorText)) return true;
  if (isModelContentUnsupportedErrorMessage(upstreamErrorText)) return true;
  if (isToolProtocolMismatchErrorMessage(upstreamErrorText)) return true;
  if (matchesAnyPattern(NON_RETRYABLE_REQUEST_PATTERNS, upstreamErrorText)) return false;
  if (matchesAnyPattern(RETRYABLE_CHANNEL_LOCAL_PATTERNS, upstreamErrorText)) return true;
  if (status === 400 || status === 404 || status === 422) return false;
  return false;
}

export function shouldAbortSameSiteEndpointFallback(status: number, upstreamErrorText?: string | null): boolean {
  // 413 是渠道/站点级的请求体限制，同站其余端点通常共享同一入口限制，
  // 轮换大概率复现；为避免无效尝试，直接跳到渠道 failover。
  if (status === 413) return true;
  if (status < 500 && status !== 408 && status !== 429) {
    return false;
  }
  return matchesAnyPattern(SAME_SITE_ENDPOINT_ABORT_PATTERNS, upstreamErrorText);
}

import { describe, expect, it } from 'vitest';
import { shouldAbortSameSiteEndpointFallback, shouldRetryProxyRequest } from './proxyRetryPolicy.js';

describe('proxyRetryPolicy', () => {
  it('retries on rate limit and server errors', () => {
    expect(shouldRetryProxyRequest(429, 'rate limit')).toBe(true);
    expect(shouldRetryProxyRequest(500, 'internal error')).toBe(true);
    expect(shouldRetryProxyRequest(503, 'service unavailable')).toBe(true);
  });

  it('retries 402 only for upstream insufficient-balance messages', () => {
    expect(shouldRetryProxyRequest(402, 'Upstream returned HTTP 402: Provider balance is insufficient')).toBe(true);
    expect(shouldRetryProxyRequest(402, 'Upstream returned HTTP 402: INSUFFICIENT   BALANCE')).toBe(true);
    expect(shouldRetryProxyRequest(402, 'quota exceeded')).toBe(false);
    expect(shouldRetryProxyRequest(402, 'payment required')).toBe(false);
    expect(shouldRetryProxyRequest(402, 'unsupported model')).toBe(false);
    expect(shouldRetryProxyRequest(400, 'Provider balance is insufficient')).toBe(false);
  });

  it('retries on model unsupported messages from upstream', () => {
    expect(
      shouldRetryProxyRequest(400, '{"error":"当前 API 不支持所选模型 claude-sonnet-4-5-20250929","type":"error"}'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(400, '{"error":{"message":"unsupported model: claude-3"}}'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(404, '{"error":{"message":"The model `gpt-4.1` does not exist"}}'),
    ).toBe(true);
  });

  it('does not retry obvious request-shape errors that will fail on every channel', () => {
    expect(
      shouldRetryProxyRequest(400, '{"error":{"message":"invalid request body"}}'),
    ).toBe(false);
    expect(
      shouldRetryProxyRequest(422, '{"error":{"message":"unprocessable"}}'),
    ).toBe(false);
    expect(
      shouldRetryProxyRequest(404, '{"error":{"message":"not found"}}'),
    ).toBe(false);
  });

  it('keeps retrying channel-local compatibility and auth failures', () => {
    expect(
      shouldRetryProxyRequest(401, '{"error":{"message":"invalid access token"}}'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(403, '{"error":{"message":"forbidden"}}'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(400, 'Unsupported legacy protocol: /v1/chat/completions is not supported. Please use /v1/responses.'),
    ).toBe(true);
  });

  it('does not retry client-side timeout validation errors', () => {
    expect(
      shouldRetryProxyRequest(400, '{"error":{"message":"timeout must be <= 60"}}'),
    ).toBe(false);
    expect(
      shouldRetryProxyRequest(400, '{"error":{"message":"invalid timeout parameter"}}'),
    ).toBe(false);
  });

  it('retries when model does not support image/vision input (channel capability limit)', () => {
    expect(
      shouldRetryProxyRequest(400, 'Model GLM-5.3-Flash does not support image input. Remove the image content or use a vision-capable model.'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(400, 'does not support vision'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(400, 'model does not support multimodal input'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(400, 'vision-capable model required'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(400, '不支持图片输入'),
    ).toBe(true);
  });

  it('retries on tool-protocol mismatch (channel capability limit)', () => {
    expect(
      shouldRetryProxyRequest(400, 'Upstream returned HTTP 400: No tool output found for function call fc_manyv0O0IO7zKvU8e2QeSjGI.'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(400, 'No tool output found for function call fc_abc123'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(400, 'missing tool_result for tool_use'),
    ).toBe(true);
    expect(
      shouldRetryProxyRequest(400, 'tool result is required'),
    ).toBe(true);
  });

  it('keeps plain 400 request-shape errors non-retryable', () => {
    expect(shouldRetryProxyRequest(400, 'invalid request body')).toBe(false);
    expect(shouldRetryProxyRequest(400, 'validation failed')).toBe(false);
    expect(shouldRetryProxyRequest(400, 'unprocessable payload')).toBe(false);
  });

  it('aborts same-site endpoint fallback on rate-limit and quota responses', () => {
    expect(
      shouldAbortSameSiteEndpointFallback(429, '{"error":{"message":"rate limit exceeded"}}'),
    ).toBe(true);
    expect(
      shouldAbortSameSiteEndpointFallback(429, '{"error":{"message":"quota exceeded"}}'),
    ).toBe(true);
    expect(
      shouldAbortSameSiteEndpointFallback(429, '{"error":{"message":"too many requests"}}'),
    ).toBe(true);
  });
});

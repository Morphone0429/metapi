import { Response } from 'undici';
import { describe, expect, it } from 'vitest';

import { createChatEndpointStrategy } from './chatEndpointStrategy.js';
import type { DownstreamFormat } from './normalized.js';

const IMAGE_URL_OBJECT_ERROR = JSON.stringify({
  error: {
    type: 'upstream_error',
    message: "Invalid type for 'input[0].content[1].image_url': expected an image URL, but got an object instead.",
  },
});

function createStrategy(
  downstreamFormat: DownstreamFormat = 'openai',
) {
  return createChatEndpointStrategy({
    downstreamFormat,
    endpointCandidates: ['responses', 'chat', 'messages'],
    modelName: 'gpt-test',
    requestedModelHint: 'gpt-test',
    sitePlatform: 'newapi',
    isStream: false,
    buildRequest: ({ endpoint }) => ({
      endpoint,
      path: endpoint === 'responses'
        ? '/v1/responses'
        : endpoint === 'messages'
          ? '/v1/messages'
          : '/v1/chat/completions',
      headers: {},
      body: { model: 'gpt-test' },
    }),
    dispatchRequest: async () => new Response('ok', { status: 200 }),
  });
}

function createAttemptContext(
  endpoint: 'chat' | 'messages' | 'responses',
  status: number,
  rawErrText: string,
) {
  const path = endpoint === 'responses'
    ? '/v1/responses'
    : endpoint === 'messages'
      ? '/v1/messages'
      : '/v1/chat/completions';
  return {
    request: {
      endpoint,
      path,
      headers: {},
      body: { model: 'gpt-test' },
    },
    targetUrl: `https://upstream.example${path}`,
    response: new Response(rawErrText, { status }),
    rawErrText,
  };
}

describe('createChatEndpointStrategy Responses image_url fallback', () => {
  it('downgrades only the matching 400 from the Responses endpoint', () => {
    const strategy = createStrategy();

    expect(strategy.shouldDowngrade(
      createAttemptContext('responses', 400, IMAGE_URL_OBJECT_ERROR),
    )).toBe(true);
    expect(strategy.shouldDowngrade(
      createAttemptContext('chat', 400, IMAGE_URL_OBJECT_ERROR),
    )).toBe(false);
    expect(strategy.shouldDowngrade(
      createAttemptContext('messages', 400, IMAGE_URL_OBJECT_ERROR),
    )).toBe(false);
  });

  it('does not apply the Responses-specific fallback to non-OpenAI downstream requests', () => {
    expect(createStrategy('claude').shouldDowngrade(
      createAttemptContext('responses', 400, IMAGE_URL_OBJECT_ERROR),
    )).toBe(false);
  });

  it('does not downgrade authentication, quota, other schema errors, or non-400 statuses', () => {
    const strategy = createStrategy();

    expect(strategy.shouldDowngrade(
      createAttemptContext('responses', 401, IMAGE_URL_OBJECT_ERROR),
    )).toBe(false);
    expect(strategy.shouldDowngrade(
      createAttemptContext('responses', 402, IMAGE_URL_OBJECT_ERROR),
    )).toBe(false);
    expect(strategy.shouldDowngrade(
      createAttemptContext('responses', 400, JSON.stringify({
        error: { type: 'authentication_error', message: 'invalid_api_key' },
      })),
    )).toBe(false);
    expect(strategy.shouldDowngrade(
      createAttemptContext('responses', 400, JSON.stringify({
        error: { type: 'upstream_error', message: 'insufficient_quota' },
      })),
    )).toBe(false);
    expect(strategy.shouldDowngrade(
      createAttemptContext('responses', 400, "Invalid type for 'input[0].content[1].text': expected an image URL, but got an object instead."),
    )).toBe(false);
  });
});

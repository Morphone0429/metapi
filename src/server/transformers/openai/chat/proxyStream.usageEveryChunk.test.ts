import { describe, expect, it, vi } from 'vitest';

type StreamSessionModule = typeof import('./proxyStream.js');

// 每个用例独立加载模块，便于通过环境变量切换 proxyStreamUsageEveryChunk。
async function loadSessionModule(env: Record<string, string>): Promise<StreamSessionModule> {
  vi.resetModules();
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await import('./proxyStream.js');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function sseReader(events: string[]) {
  const encoder = new TextEncoder();
  const chunks = events.map((event) => encoder.encode(event));
  let index = 0;
  return {
    read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
      if (index < chunks.length) {
        const value = chunks[index];
        index += 1;
        return { done: false, value };
      }
      return { done: true };
    },
    cancel: async () => undefined,
    releaseLock: () => undefined,
  };
}

function chunkPayload(
  delta: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  finishReason: string | null = null,
): string {
  return JSON.stringify({
    id: 'chatcmpl-test-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  });
}

async function runStream(
  module: StreamSessionModule,
  events: string[],
): Promise<string[]> {
  const written: string[] = [];
  const session = module.createChatProxyStreamSession({
    downstreamFormat: 'openai',
    modelName: 'test-model',
    successfulUpstreamPath: '/v1/chat/completions',
    writeLines: (lines) => written.push(...lines),
    writeRaw: (chunk) => written.push(chunk),
  });
  const result = await session.run(sseReader(events), { end: () => undefined });
  expect(result.status).toBe('completed');
  return written;
}

function parseDataChunks(written: string[]): Array<Record<string, unknown>> {
  return written
    .join('')
    .split('\n\n')
    .filter((block) => block.startsWith('data: ') && block.trim() !== 'data: [DONE]')
    .map((block) => JSON.parse(block.slice(6)) as Record<string, unknown>);
}

describe('chat proxy stream usage-every-chunk', () => {
  it('为每个中间 chunk 注入零值 usage，最终 chunk 保留真实 usage', async () => {
    const module = await loadSessionModule({});
    const written = await runStream(module, [
      `data: ${chunkPayload({ role: 'assistant', content: 'he' })}\n\n`,
      `data: ${chunkPayload({ content: 'llo' })}\n\n`,
      `data: ${chunkPayload({}, { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }, 'stop')}\n\n`,
      'data: [DONE]\n\n',
    ]);

    const chunks = parseDataChunks(written);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const payload of chunks) {
      expect(payload.usage, `chunk 应包含 usage: ${JSON.stringify(payload)}`).toBeTruthy();
      const usage = payload.usage as Record<string, unknown>;
      expect(typeof usage.total_tokens).toBe('number');
    }
    expect(chunks[0].usage).toMatchObject({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    expect(chunks[1].usage).toMatchObject({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    expect(chunks[2].usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect(written.join('')).toContain('data: [DONE]');
  });

  it('上游 usage 缺 total_tokens 时自动补齐为 prompt+completion', async () => {
    const module = await loadSessionModule({});
    const written = await runStream(module, [
      `data: ${chunkPayload({ role: 'assistant', content: 'hi' })}\n\n`,
      `data: ${chunkPayload({}, { usage: { prompt_tokens: 7, completion_tokens: 3 } }, 'stop')}\n\n`,
      'data: [DONE]\n\n',
    ]);

    const chunks = parseDataChunks(written);
    const finalUsage = chunks[chunks.length - 1].usage as Record<string, unknown>;
    expect(finalUsage).toMatchObject({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
  });

  it('PROXY_STREAM_USAGE_EVERY_CHUNK=false 时恢复标准行为（中间 chunk 无 usage）', async () => {
    const module = await loadSessionModule({ PROXY_STREAM_USAGE_EVERY_CHUNK: 'false' });
    const written = await runStream(module, [
      `data: ${chunkPayload({ role: 'assistant', content: 'he' })}\n\n`,
      `data: ${chunkPayload({}, { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }, 'stop')}\n\n`,
      'data: [DONE]\n\n',
    ]);

    const chunks = parseDataChunks(written);
    expect(chunks[0].usage).toBeUndefined();
    expect(chunks[1].usage).toMatchObject({ total_tokens: 2 });
  });

  it('累积上游分段出现的 usage 到后续注入的 chunk', async () => {
    const module = await loadSessionModule({});
    const written = await runStream(module, [
      `data: ${chunkPayload({ role: 'assistant', content: 'a' })}\n\n`,
      `data: ${chunkPayload({}, { usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }, 'stop')}\n\n`,
      `data: ${chunkPayload({ content: 'b' })}\n\n`,
      'data: [DONE]\n\n',
    ]);

    const chunks = parseDataChunks(written);
    // 第三个 chunk 出现在 usage 之后，应注入已累积的真实 usage。
    expect(chunks[2].usage).toMatchObject({ prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
  });
});

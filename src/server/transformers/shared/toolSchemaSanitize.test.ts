import { describe, expect, it } from 'vitest';

import { sanitizeOutboundToolSchemas } from './toolSchemaSanitize.js';

describe('sanitizeOutboundToolSchemas', () => {
  it('injects type:object into parameters missing the root type (Codex/vercel-ai#7924 shape)', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_status',
          description: 'return status',
          parameters: { properties: { id: { type: 'string' } }, additionalProperties: false },
        },
      },
    ];
    const out = sanitizeOutboundToolSchemas(tools) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(1);
    const fn = (out[0] as { function: { parameters: Record<string, unknown> } }).function;
    expect(fn.parameters.type).toBe('object');
    expect(fn.parameters.properties).toEqual({ id: { type: 'string' } });
    expect(fn.parameters.additionalProperties).toBe(false);
  });

  it('defaults missing parameters to an empty object schema (no-arg tools)', () => {
    const tools = [{ type: 'function', function: { name: 'no_args' } }];
    const out = sanitizeOutboundToolSchemas(tools) as Array<Record<string, unknown>>;
    const fn = (out[0] as { function: { parameters: Record<string, unknown> } }).function;
    expect(fn.parameters).toEqual({ type: 'object', properties: {} });
  });

  it('treats null parameters as omitted and drops garbage (string/array) parameters', () => {
    const tools = [
      { type: 'function', function: { name: 'null_params', parameters: null } },
      { type: 'function', function: { name: 'bad_str', parameters: 'x' } },
      { type: 'function', function: { name: 'bad_arr', parameters: [] } },
      { type: 'function', function: { name: 'good', parameters: { type: 'object', properties: {} } } },
    ];
    const out = sanitizeOutboundToolSchemas(tools) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);
    const names = out.map((t) => (t as { function: { name: string } }).function.name);
    expect(names).toEqual(['null_params', 'good']);
    const nullTool = out[0] as { function: { parameters: Record<string, unknown> } };
    expect(nullTool.function.parameters).toEqual({ type: 'object', properties: {} });
  });

  it('drops tools whose root type is explicitly not object', () => {
    const tools = [
      { type: 'function', function: { name: 'arr', parameters: { type: 'array', items: {} } } },
    ];
    const out = sanitizeOutboundToolSchemas(tools);
    expect(out).toHaveLength(0);
  });

  it('leaves valid object schemas untouched (reference equality preserved)', () => {
    const schema = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] };
    const tool = { type: 'function', function: { name: 'search', parameters: schema } };
    const out = sanitizeOutboundToolSchemas([tool]) as Array<typeof tool>;
    expect(out[0].function.parameters).toBe(schema);
  });

  it('normalizes anthropic-style input_schema tools', () => {
    const tools = [{ name: 'lookup', input_schema: { properties: { q: { type: 'string' } } } }];
    const out = sanitizeOutboundToolSchemas(tools) as Array<Record<string, unknown>>;
    expect((out[0] as { input_schema: Record<string, unknown> }).input_schema.type).toBe('object');
  });

  it('leaves server tools (web_search) and unknown entries untouched', () => {
    const tools = [
      { type: 'web_search', max_results: 3 },
      { type: 'google_search' },
      { weired: true },
    ];
    const out = sanitizeOutboundToolSchemas(tools);
    expect(out).toEqual(tools);
  });

  it('returns non-array input unchanged', () => {
    expect(sanitizeOutboundToolSchemas(undefined)).toBeUndefined();
    expect(sanitizeOutboundToolSchemas({})).toEqual({});
  });
});

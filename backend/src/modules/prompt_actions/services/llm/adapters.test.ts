import { describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { GoogleAdapter } from './google-adapter.js';
import { OpenAiAdapter } from './openai-adapter.js';
import { LlmProviderError, type LlmRequest } from './provider.js';

/**
 * T019 — unit tests for the three provider adapters (research §R2).
 * Provider HTTP is an external boundary: every test injects a fake `fetch`.
 * Covers request mapping (system, messages, tool JSON Schemas, wire-name
 * sanitization — dots are not allowed in Anthropic/OpenAI tool names),
 * response parsing (tool calls, plain text, max-tokens stop), malformed
 * responses, and HTTP error mapping.
 */

const REQUEST: LlmRequest = {
  model: 'test-model',
  system: 'You are the admin assistant.',
  maxTokens: 1024,
  messages: [
    { role: 'user', text: 'Set stock of Bolts 0193 to 120' },
    {
      role: 'assistant',
      text: null,
      toolCalls: [{ id: 'call_1', name: 'catalog.search_products', arguments: { q: 'Bolts 0193' } }],
    },
    {
      role: 'tool_result',
      toolCallId: 'call_1',
      toolName: 'catalog.search_products',
      resultJson: '[{"id":"p1","label":"Bolts 0193"}]',
    },
  ],
  tools: [
    {
      name: 'catalog.search_products',
      description: 'Search products.',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    },
    {
      name: 'inventory.set_stock_level',
      description: 'Set stock.',
      inputSchema: { type: 'object', properties: { quantity: { type: 'number' } } },
    },
  ],
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

function lastCall(f: typeof fetch): { url: string; init: { headers: Record<string, string>; body: string } } {
  const mock = (f as unknown as ReturnType<typeof vi.fn>).mock;
  const [url, init] = mock.calls.at(-1) as [string, { headers: Record<string, string>; body: string }];
  return { url, init };
}

describe('AnthropicAdapter', () => {
  const completion = {
    content: [
      { type: 'text', text: 'Resolving…' },
      { type: 'tool_use', id: 'tu_1', name: 'inventory__set_stock_level', input: { quantity: 120 } },
    ],
    stop_reason: 'tool_use',
  };

  it('maps the request to /v1/messages with sanitized tool names and tool_result blocks', async () => {
    const f = fakeFetch(200, completion);
    const a = new AnthropicAdapter('sk-ant-key', f);
    await a.complete(REQUEST);
    const { url, init } = lastCall(f);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-key');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body['model']).toBe('test-model');
    expect(body['system']).toBe(REQUEST.system);
    expect(body['max_tokens']).toBe(1024);
    const tools = body['tools'] as Array<{ name: string; input_schema: unknown }>;
    expect(tools.map((t) => t.name)).toEqual([
      'catalog__search_products',
      'inventory__set_stock_level',
    ]);
    expect(tools[0]!.input_schema).toMatchObject({ type: 'object' });
    const messages = body['messages'] as Array<{ role: string; content: unknown }>;
    // assistant tool_use turn then user tool_result turn
    expect(messages[1]).toMatchObject({ role: 'assistant' });
    expect(JSON.stringify(messages[1])).toContain('catalog__search_products');
    expect(messages[2]).toMatchObject({ role: 'user' });
    expect(JSON.stringify(messages[2])).toContain('tool_result');
    expect(JSON.stringify(messages[2])).toContain('call_1');
  });

  it('parses tool calls back to dotted ids and reports stop reason', async () => {
    const a = new AnthropicAdapter('k', fakeFetch(200, completion));
    const r = await a.complete(REQUEST);
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolCalls).toEqual([
      { id: 'tu_1', name: 'inventory.set_stock_level', arguments: { quantity: 120 } },
    ]);
    expect(r.text).toBe('Resolving…');
  });

  it('maps end_turn and max_tokens stop reasons', async () => {
    const end = await new AnthropicAdapter('k', fakeFetch(200, { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' })).complete(REQUEST);
    expect(end.stopReason).toBe('end');
    const cap = await new AnthropicAdapter('k', fakeFetch(200, { content: [], stop_reason: 'max_tokens' })).complete(REQUEST);
    expect(cap.stopReason).toBe('max_tokens');
  });

  it('throws LlmProviderError on HTTP errors and malformed bodies', async () => {
    await expect(
      new AnthropicAdapter('k', fakeFetch(529, { error: 'overloaded' })).complete(REQUEST),
    ).rejects.toBeInstanceOf(LlmProviderError);
    await expect(
      new AnthropicAdapter('k', fakeFetch(200, { nonsense: true })).complete(REQUEST),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });
});

describe('OpenAiAdapter', () => {
  const completion = {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: 'call_9',
              type: 'function',
              function: { name: 'inventory__set_stock_level', arguments: '{"quantity":120}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };

  it('maps the request to /v1/chat/completions with system message and tool schema', async () => {
    const f = fakeFetch(200, completion);
    await new OpenAiAdapter('sk-oai', f).complete(REQUEST);
    const { url, init } = lastCall(f);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers['authorization']).toBe('Bearer sk-oai');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const messages = body['messages'] as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({ role: 'system', content: REQUEST.system });
    expect(messages[2]).toMatchObject({ role: 'assistant' });
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
    const tools = body['tools'] as Array<{ function: { name: string } }>;
    expect(tools.map((t) => t.function.name)).toEqual([
      'catalog__search_products',
      'inventory__set_stock_level',
    ]);
  });

  it('parses tool_calls (JSON-string arguments) back to dotted ids', async () => {
    const r = await new OpenAiAdapter('k', fakeFetch(200, completion)).complete(REQUEST);
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolCalls).toEqual([
      { id: 'call_9', name: 'inventory.set_stock_level', arguments: { quantity: 120 } },
    ]);
  });

  it('maps stop and length finish reasons; rejects malformed bodies', async () => {
    const stop = await new OpenAiAdapter('k', fakeFetch(200, { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })).complete(REQUEST);
    expect(stop.stopReason).toBe('end');
    expect(stop.text).toBe('hi');
    const len = await new OpenAiAdapter('k', fakeFetch(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }] })).complete(REQUEST);
    expect(len.stopReason).toBe('max_tokens');
    await expect(
      new OpenAiAdapter('k', fakeFetch(200, { choices: [] })).complete(REQUEST),
    ).rejects.toBeInstanceOf(LlmProviderError);
    await expect(
      new OpenAiAdapter('k', fakeFetch(429, {})).complete(REQUEST),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('GoogleAdapter', () => {
  const completion = {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ functionCall: { name: 'inventory__set_stock_level', args: { quantity: 120 } } }],
        },
        finishReason: 'STOP',
      },
    ],
  };

  it('maps the request to :generateContent with functionDeclarations and functionResponse parts', async () => {
    const f = fakeFetch(200, completion);
    await new GoogleAdapter('g-key', f).complete(REQUEST);
    const { url, init } = lastCall(f);
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent',
    );
    expect(init.headers['x-goog-api-key']).toBe('g-key');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(JSON.stringify(body['systemInstruction'])).toContain(REQUEST.system);
    const tools = body['tools'] as Array<{ functionDeclarations: Array<{ name: string; parameters: Record<string, unknown> }> }>;
    const decls = tools[0]!.functionDeclarations;
    expect(decls.map((d) => d.name)).toEqual([
      'catalog__search_products',
      'inventory__set_stock_level',
    ]);
    // $schema / additionalProperties are stripped for Gemini compatibility.
    expect(JSON.stringify(decls)).not.toContain('$schema');
    const contents = body['contents'] as Array<{ role: string; parts: unknown[] }>;
    expect(contents[0]).toMatchObject({ role: 'user' });
    expect(contents[1]!.role).toBe('model');
    expect(JSON.stringify(contents[2])).toContain('functionResponse');
  });

  it('parses functionCall parts (synthesized ids) back to dotted ids', async () => {
    const r = await new GoogleAdapter('k', fakeFetch(200, completion)).complete(REQUEST);
    // A functionCall part means the model wants tools, regardless of finishReason.
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({
      name: 'inventory.set_stock_level',
      arguments: { quantity: 120 },
    });
    expect(r.toolCalls[0]!.id).toBeTruthy();
  });

  it('parses plain text answers; rejects malformed bodies; maps HTTP errors', async () => {
    const txt = await new GoogleAdapter('k', fakeFetch(200, {
      candidates: [{ content: { role: 'model', parts: [{ text: 'Not supported.' }] }, finishReason: 'STOP' }],
    })).complete(REQUEST);
    expect(txt.stopReason).toBe('end');
    expect(txt.text).toBe('Not supported.');
    await expect(
      new GoogleAdapter('k', fakeFetch(200, { candidates: [{}] })).complete(REQUEST),
    ).rejects.toBeInstanceOf(LlmProviderError);
    await expect(
      new GoogleAdapter('k', fakeFetch(503, {})).complete(REQUEST),
    ).rejects.toMatchObject({ status: 503 });
  });
});

import { z } from 'zod';
import {
  fromWireName,
  parseOrThrow,
  postJson,
  toWireName,
  wireNameMap,
  type FetchLike,
  type LlmCompletion,
  type LlmProviderAdapter,
  type LlmRequest,
} from './provider.js';

/**
 * Anthropic (Claude) adapter — `POST /v1/messages` with tool-use blocks.
 * Native fetch, no SDK (research §R2).
 */

const ResponseSchema = z.object({
  content: z.array(
    z.union([
      z.object({ type: z.literal('text'), text: z.string() }),
      z.object({
        type: z.literal('tool_use'),
        id: z.string(),
        name: z.string(),
        input: z.unknown(),
      }),
    ]),
  ),
  stop_reason: z.string().nullable(),
});

export class AnthropicAdapter implements LlmProviderAdapter {
  readonly provider = 'anthropic' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async complete(req: LlmRequest): Promise<LlmCompletion> {
    const names = wireNameMap(req.tools);
    const body = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      tools: req.tools.map((t) => ({
        name: toWireName(t.name),
        description: t.description,
        input_schema: t.inputSchema,
      })),
      messages: req.messages.map((m) => {
        if (m.role === 'user') {
          return { role: 'user', content: [{ type: 'text', text: m.text }] };
        }
        if (m.role === 'assistant') {
          return {
            role: 'assistant',
            content: [
              ...(m.text ? [{ type: 'text', text: m.text }] : []),
              ...m.toolCalls.map((c) => ({
                type: 'tool_use',
                id: c.id,
                name: toWireName(c.name),
                input: c.arguments,
              })),
            ],
          };
        }
        return {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: m.toolCallId, content: m.resultJson },
          ],
        };
      }),
    };

    const json = await postJson(
      this.provider,
      this.fetchImpl,
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body,
    );
    const parsed = parseOrThrow(this.provider, ResponseSchema, json);

    const textParts = parsed.content.filter((c) => c.type === 'text').map((c) => c.text);
    const toolCalls = parsed.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({ id: c.id, name: fromWireName(c.name, names), arguments: c.input }));

    return {
      text: textParts.length > 0 ? textParts.join('\n') : null,
      toolCalls,
      stopReason:
        parsed.stop_reason === 'tool_use'
          ? 'tool_use'
          : parsed.stop_reason === 'end_turn'
            ? 'end'
            : parsed.stop_reason === 'max_tokens'
              ? 'max_tokens'
              : 'other',
    };
  }
}

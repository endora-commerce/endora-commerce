import { z } from 'zod';
import {
  LlmProviderError,
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
 * OpenAI (GPT) adapter — `POST /v1/chat/completions` with tools/tool_calls.
 * Native fetch, no SDK (research §R2). Tool-call arguments arrive as a JSON
 * string and are parsed here; the interpreter re-validates against the
 * tool's Zod schema regardless.
 */

const ResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

export class OpenAiAdapter implements LlmProviderAdapter {
  readonly provider = 'openai' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async complete(req: LlmRequest): Promise<LlmCompletion> {
    const names = wireNameMap(req.tools);
    const body = {
      model: req.model,
      max_completion_tokens: req.maxTokens,
      messages: [
        { role: 'system', content: req.system },
        ...req.messages.map((m) => {
          if (m.role === 'user') return { role: 'user', content: m.text };
          if (m.role === 'assistant') {
            return {
              role: 'assistant',
              content: m.text,
              ...(m.toolCalls.length > 0
                ? {
                    tool_calls: m.toolCalls.map((c) => ({
                      id: c.id,
                      type: 'function',
                      function: {
                        name: toWireName(c.name),
                        arguments: JSON.stringify(c.arguments),
                      },
                    })),
                  }
                : {}),
            };
          }
          return { role: 'tool', tool_call_id: m.toolCallId, content: m.resultJson };
        }),
      ],
      tools: req.tools.map((t) => ({
        type: 'function',
        function: { name: toWireName(t.name), description: t.description, parameters: t.inputSchema },
      })),
    };

    const json = await postJson(
      this.provider,
      this.fetchImpl,
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${this.apiKey}` },
      body,
    );
    const parsed = parseOrThrow(this.provider, ResponseSchema, json);
    const choice = parsed.choices[0]!;

    const toolCalls = (choice.message.tool_calls ?? []).map((c) => {
      let args: unknown;
      try {
        args = JSON.parse(c.function.arguments);
      } catch {
        throw new LlmProviderError(
          this.provider,
          'malformed',
          `openai tool call "${c.function.name}" carried non-JSON arguments.`,
        );
      }
      return { id: c.id, name: fromWireName(c.function.name, names), arguments: args };
    });

    return {
      text: choice.message.content ?? null,
      toolCalls,
      stopReason:
        choice.finish_reason === 'tool_calls'
          ? 'tool_use'
          : choice.finish_reason === 'stop'
            ? 'end'
            : choice.finish_reason === 'length'
              ? 'max_tokens'
              : 'other',
    };
  }
}

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
 * Google (Gemini) adapter — `POST :generateContent` with
 * functionDeclarations / functionCall parts. Native fetch, no SDK
 * (research §R2). Gemini returns no tool-call ids, so synthetic ids are
 * minted per response; functionResponse parts are matched by name, which the
 * API expects.
 */

const ResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z
            .array(
              z.union([
                z.object({ text: z.string() }),
                z.object({
                  functionCall: z.object({ name: z.string(), args: z.unknown().optional() }),
                }),
              ]),
            )
            .default([]),
        }),
        finishReason: z.string().optional(),
      }),
    )
    .min(1),
});

/** Gemini's parameter schema is an OpenAPI subset — strip JSON-Schema-only keys. */
function sanitizeForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeForGemini);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === '$schema' || k === 'additionalProperties') continue;
    out[k] = sanitizeForGemini(v);
  }
  return out;
}

export class GoogleAdapter implements LlmProviderAdapter {
  readonly provider = 'google' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async complete(req: LlmRequest): Promise<LlmCompletion> {
    const names = wireNameMap(req.tools);
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      generationConfig: { maxOutputTokens: req.maxTokens },
      tools: [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: toWireName(t.name),
            description: t.description,
            parameters: sanitizeForGemini(t.inputSchema),
          })),
        },
      ],
      contents: req.messages.map((m) => {
        if (m.role === 'user') return { role: 'user', parts: [{ text: m.text }] };
        if (m.role === 'assistant') {
          return {
            role: 'model',
            parts: [
              ...(m.text ? [{ text: m.text }] : []),
              ...m.toolCalls.map((c) => ({
                functionCall: { name: toWireName(c.name), args: c.arguments ?? {} },
              })),
            ],
          };
        }
        let response: unknown;
        try {
          response = JSON.parse(m.resultJson);
        } catch {
          response = { value: m.resultJson };
        }
        // functionResponse.response must be an object.
        const wrapped =
          typeof response === 'object' && response !== null && !Array.isArray(response)
            ? response
            : { value: response };
        return {
          role: 'user',
          parts: [
            { functionResponse: { name: toWireName(m.toolName), response: wrapped } },
          ],
        };
      }),
    };

    const json = await postJson(
      this.provider,
      this.fetchImpl,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      { 'x-goog-api-key': this.apiKey },
      body,
    );
    const parsed = parseOrThrow(this.provider, ResponseSchema, json);
    const candidate = parsed.candidates[0]!;

    const texts: string[] = [];
    const toolCalls: LlmCompletion['toolCalls'] = [];
    candidate.content.parts.forEach((part, index) => {
      if ('text' in part) {
        texts.push(part.text);
        return;
      }
      toolCalls.push({
        id: `gcall_${index}_${part.functionCall.name}`,
        name: fromWireName(part.functionCall.name, names),
        arguments: part.functionCall.args ?? {},
      });
    });

    return {
      text: texts.length > 0 ? texts.join('\n') : null,
      toolCalls,
      stopReason:
        toolCalls.length > 0
          ? 'tool_use'
          : candidate.finishReason === 'STOP'
            ? 'end'
            : candidate.finishReason === 'MAX_TOKENS'
              ? 'max_tokens'
              : 'other',
    };
  }
}

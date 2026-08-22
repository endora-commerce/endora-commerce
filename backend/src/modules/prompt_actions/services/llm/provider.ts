import type { z } from 'zod';
import type { LlmToolDefinition, PromptActionsProvider } from '@endora-commerce/contracts';

/**
 * Provider-neutral LLM adapter contract (feature 043, research §R2).
 *
 * Three thin adapters (Anthropic / Google / OpenAI) speak the providers'
 * native tool-calling REST APIs over injected `fetch` — no SDK dependency.
 * Everything the interpreter consumes is normalized to this shape; provider
 * responses are Zod-validated at the boundary (Principle V).
 */

export type { LlmToolDefinition };

export type LlmMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string | null; toolCalls: LlmToolCall[] }
  | { role: 'tool_result'; toolCallId: string; toolName: string; resultJson: string };

export interface LlmToolCall {
  id: string;
  /** Dotted registry id, e.g. 'inventory.set_stock_level'. */
  name: string;
  arguments: unknown;
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  maxTokens: number;
}

export interface LlmCompletion {
  text: string | null;
  toolCalls: LlmToolCall[];
  stopReason: 'tool_use' | 'end' | 'max_tokens' | 'other';
}

export interface LlmProviderAdapter {
  readonly provider: PromptActionsProvider;
  complete(req: LlmRequest): Promise<LlmCompletion>;
}

export class LlmProviderError extends Error {
  override readonly name = 'LlmProviderError';
  constructor(
    public readonly provider: PromptActionsProvider,
    public readonly kind: 'http' | 'network' | 'malformed',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export type FetchLike = typeof fetch;

// ---------------------------------------------------------------------------
// Wire-name sanitization
// ---------------------------------------------------------------------------
// Registry ids are dotted ('catalog.search_products') but Anthropic and
// OpenAI tool names must match ^[a-zA-Z0-9_-]{1,64}$. All adapters therefore
// send '__'-joined names and translate responses back through a per-request
// reverse map (never string surgery — ids may legitimately contain '_').

export function toWireName(id: string): string {
  return id.replace(/\./g, '__');
}

export function wireNameMap(tools: LlmToolDefinition[]): Map<string, string> {
  return new Map(tools.map((t) => [toWireName(t.name), t.name]));
}

export function fromWireName(wire: string, map: Map<string, string>): string {
  return map.get(wire) ?? wire;
}

/** Shared POST + JSON helper with uniform error mapping. */
export async function postJson(
  provider: PromptActionsProvider,
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LlmProviderError(
      provider,
      'network',
      `Could not reach the ${provider} API: ${(err as Error).message}`,
    );
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // fall through — handled below
  }
  if (!response.ok) {
    throw new LlmProviderError(
      provider,
      'http',
      `${provider} API responded with HTTP ${response.status}.`,
      response.status,
    );
  }
  if (json === null) {
    throw new LlmProviderError(provider, 'malformed', `${provider} API returned a non-JSON body.`);
  }
  return json;
}

export function malformed(provider: PromptActionsProvider, issues: unknown): LlmProviderError {
  return new LlmProviderError(
    provider,
    'malformed',
    `${provider} API response did not match the expected shape: ${JSON.stringify(issues).slice(0, 500)}`,
  );
}

/** Boundary guard reused by adapters. */
export function parseOrThrow<T>(
  provider: PromptActionsProvider,
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw malformed(provider, r.error.issues);
  return r.data;
}

import type { BackendServerHandle } from './test-server.js';

/**
 * Shared helpers for feature 043 tests: a scripted Anthropic-shaped provider
 * (the adapters' own unit tests cover the other providers' wire formats) and
 * a settings seeder that walks the real admin settings API, exercising the
 * secret write path for the API key.
 */

interface AnthropicContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export class ScriptedLlm {
  private readonly queue: Array<{ content: AnthropicContentBlock[]; stop_reason: string }> = [];
  /** Every request body the "provider" received, for assertions. */
  readonly requests: Array<Record<string, unknown>> = [];

  /** One assistant turn calling the given tools (wire names use '__'). */
  enqueueToolUse(...calls: Array<{ name: string; input: unknown; id?: string }>): this {
    this.queue.push({
      content: calls.map((c, i) => ({
        type: 'tool_use',
        id: c.id ?? `tu_${this.queue.length}_${i}`,
        name: c.name.replace(/\./g, '__'),
        input: c.input,
      })),
      stop_reason: 'tool_use',
    });
    return this;
  }

  enqueueDone(text = 'Done.'): this {
    this.queue.push({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
    return this;
  }

  enqueueHttpError(status: number): this {
    this.queue.push({ content: [], stop_reason: `__http_${status}` });
    return this;
  }

  reset(): void {
    this.queue.length = 0;
    this.requests.length = 0;
  }

  readonly fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    if (init?.body) {
      try {
        this.requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      } catch {
        /* assertion convenience only */
      }
    }
    const next = this.queue.shift();
    if (!next) {
      return new Response(JSON.stringify({ content: [], stop_reason: 'end_turn' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const httpError = /^__http_(\d+)$/.exec(next.stop_reason);
    if (httpError) {
      return new Response(JSON.stringify({ error: 'scripted' }), {
        status: Number(httpError[1]),
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

export async function seedPromptActionsSettings(
  h: BackendServerHandle,
  values: Partial<{
    enabled: boolean;
    provider: string;
    model: string;
    apiKey: string;
    bulkLimit: number;
  }> = {},
): Promise<void> {
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const entries: Array<[string, unknown]> = [
    ['prompt_actions.enabled', values.enabled ?? true],
    ['prompt_actions.provider', values.provider ?? 'anthropic'],
    ['prompt_actions.model', values.model ?? 'claude-sonnet-4-6'],
    ['prompt_actions.api_key', values.apiKey ?? 'sk-test-key'],
    ['prompt_actions.bulk_limit', values.bulkLimit ?? 500],
  ];
  for (const [code, value] of entries) {
    const r = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      cookies: adminCookie,
      payload: { scope: 'all', value },
    });
    if (r.statusCode !== 200) {
      throw new Error(`Seeding setting ${code} failed: ${r.statusCode} ${r.body}`);
    }
  }
  // Cache invalidation rides the in-process EventBus subscriber the settings
  // module attaches (`settings.value_changed` → invalidate), so the seeded
  // values are visible to the next read without manual cache work.
}

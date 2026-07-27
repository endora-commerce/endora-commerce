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

const PROMPT_ACTIONS_TEST_LLM_CODE = 'prompt-actions-test-llm';
const LLM_PROVIDERS = ['openai', 'google', 'anthropic', 'deepseek'];

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
  const enabled = values.enabled ?? true;
  const provider = values.provider ?? 'anthropic';
  const model = values.model ?? 'claude-sonnet-4-6';
  const apiKey = values.apiKey ?? 'sk-test-key';
  const bulkLimit = values.bulkLimit ?? 500;

  const setValue = async (code: string, value: unknown): Promise<void> => {
    const r = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      cookies: adminCookie,
      payload: { scope: 'all', value },
    });
    if (r.statusCode !== 200) {
      throw new Error(`Seeding setting ${code} failed: ${r.statusCode} ${r.body}`);
    }
  };

  // Feature 058 — provider/model/apiKey now live in a reusable `llm` credential
  // configuration referenced by `prompt_actions.llm_credentials` (the single
  // credential source). A blank apiKey models "not configured" (no reference);
  // an unknown provider is mapped to `deepseek` — a valid `llm` provider that
  // prompt_actions has no adapter for — so it resolves to `not_configured`.
  //
  // Clear the reference before touching the config so a still-referenced
  // configuration is not blocked from deletion (CREDENTIAL_IN_USE).
  await setValue('prompt_actions.llm_credentials', '');
  await h.app.inject({
    method: 'DELETE',
    url: `/api/v1/admin/credentials/${PROMPT_ACTIONS_TEST_LLM_CODE}`,
    cookies: adminCookie,
  });

  let credentialCode = '';
  if (apiKey !== '') {
    const providerCode = LLM_PROVIDERS.includes(provider) ? provider : 'deepseek';
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      cookies: adminCookie,
      payload: {
        code: PROMPT_ACTIONS_TEST_LLM_CODE,
        name: 'Prompt Actions Test LLM',
        typeCode: 'llm',
        providerCode,
        values: { apiKey, model },
      },
    });
    if (created.statusCode !== 201) {
      throw new Error(`Seeding credential failed: ${created.statusCode} ${created.body}`);
    }
    credentialCode = PROMPT_ACTIONS_TEST_LLM_CODE;
  }

  await setValue('prompt_actions.enabled', enabled);
  await setValue('prompt_actions.llm_credentials', credentialCode);
  await setValue('prompt_actions.bulk_limit', bulkLimit);
  // Cache invalidation rides the in-process EventBus subscriber the settings
  // module attaches (`settings.value_changed` → invalidate), so the seeded
  // values are visible to the next read without manual cache work.
}

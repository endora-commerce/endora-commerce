import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { LlmProviderFactory } from '../../../../packages/modules/prompt_actions/src/backend/services/llm/provider-factory.js';

/**
 * An absent `credentials` is not read as `not_configured` (the promise half of
 * issue #84).
 *
 * `this.deps.credentials.resolve(refCode).catch(() => null)` fell through to the
 * factory's "the reference is unset or unresolvable" branch, which reports
 * `not_configured` to the palette and throws `AssistantNotConfigured` from
 * `resolve()`. Both are correct answers for a reference nobody set and wrong
 * ones for a module the operator switched off — the operator would be sent to
 * configure a credential that is already configured.
 *
 * This module reaches `credentialsService` through a hand-written adapter
 * (`index.ts`, an object literal with one arrow), which is the same
 * `async`-boundary question the other three sites raise; the port is driven to
 * reject here for the reason stated in `search`'s twin file.
 */
describe('LlmProviderFactory and an absent credentials module', () => {
  const deps = (resolve: () => Promise<never>) => ({
    settings: {
      get: <T,>(code: string): Promise<T> =>
        Promise.resolve(
          (code.endsWith('enabled')
            ? true
            : code.endsWith('bulk_limit')
              ? 50
              : 'llm-reference') as T,
        ),
    },
    resolveChannelId: () => Promise.resolve('channel-1'),
    credentials: { resolve },
  });

  it('lets a ModuleDisabledError through instead of reporting not_configured', async () => {
    const factory = new LlmProviderFactory(
      deps(() => Promise.reject(new ModuleDisabledError('credentials'))),
    );
    await expect(factory.capability()).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('still reports not_configured when the reference cannot be resolved', async () => {
    const factory = new LlmProviderFactory(
      deps(() => Promise.reject(new Error('no such credential configuration'))),
    );
    await expect(factory.capability()).resolves.toMatchObject({ status: 'not_configured' });
  });
});

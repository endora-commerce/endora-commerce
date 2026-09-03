import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { resolveEmbedderConfig } from '../../../../packages/modules/search/src/backend/services/embedder-config-resolver.js';

/**
 * An absent `credentials` is not read as "LLM search is not configured" (the
 * promise half of issue #84).
 *
 * `credentials.resolve(refCode).catch(() => null)` returned the empty config,
 * which the caller treats as "not configured" — a defined, quiet behaviour that
 * is the *right* answer for an unset reference and the wrong one for a
 * capability the operator switched off.
 *
 * **The port is driven to reject rather than to throw synchronously, and that is
 * the shape under test.** `lazyPort`'s forwarding function is synchronous, so
 * this module's raw proxy escapes the `.catch` on its own call today; the
 * moment the same port arrives through anything `async` — a holder built around
 * it (issue #133), a decorated registration, a hand-written adapter like the one
 * `prompt_actions` uses for the identical port — the same source text swallows
 * the answer. The narrowing is correct in both, and neither a check nor a
 * reader can tell them apart at the call site.
 */
describe('resolveEmbedderConfig', () => {
  const settings = { get: () => Promise.resolve('llm-embedder') } as never;

  it('lets a ModuleDisabledError through instead of answering "not configured"', async () => {
    await expect(
      resolveEmbedderConfig(settings, 'channel-1', {
        resolve: () => Promise.reject(new ModuleDisabledError('credentials')),
      }),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('still degrades to "not configured" when the reference cannot be resolved', async () => {
    await expect(
      resolveEmbedderConfig(settings, 'channel-1', {
        resolve: () => Promise.reject(new Error('no such credential configuration')),
      }),
    ).resolves.toEqual({ url: '', apiKey: '', model: '' });
  });
});

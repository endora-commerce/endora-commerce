import { randomBytes } from 'crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ScriptedLlm, seedPromptActionsSettings } from '../../helpers/prompt-actions.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * Feature 072 wave 1 — the assistant's tool catalogue answers on the
 * **effective** module state, not on the platform axis alone.
 *
 * `promptActionsModule` was wired with `isModuleInstalled: (id) =>
 * registryCache.isEnabled(id)`, which is one of the two axes Constitution XVII
 * requires (feature 073). A module that is installed and *operator-deactivated*
 * therefore kept contributing its tools: the model was handed
 * `inventory__set_stock_level` for a capability the business had switched off,
 * proposed a plan around it, and the operator was asked to confirm work that
 * the module's own routes would then refuse. That is worse than refusing early
 * — the assistant advertises a capability the platform does not have.
 *
 * The visibility filter is the right seam for it. It already exists, it already
 * runs per request, and it is what keeps a tool out of both the provider
 * catalogue and the system prompt. Only its source of truth was wrong.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);

describe('prompt_actions — tool visibility follows effective module state [integration]', () => {
  let h: BackendServerHandle;
  const llm = new ScriptedLlm();

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    h = await setupBackendServer({ promptActionsLlmFetch: llm.fetch });
    await seedPromptActionsSettings(h);
  }, 60_000);

  afterEach(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    llm.reset();
  });

  afterAll(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  async function submit(prompt: string): Promise<string[]> {
    llm.enqueueToolUse({ name: 'report_outcome', input: { kind: 'unsupported' } });
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: ADMIN,
      payload: { prompt },
    });
    expect(r.statusCode).toBe(201);
    return (llm.requests[0]!['tools'] as Array<{ name: string }>).map((t) => t.name);
  }

  it('offers a tool from a module that is installed and activated', async () => {
    expect(await submit('set stock levels')).toContain('inventory__set_stock_level');
  });

  it('withholds it once the operator deactivates the module, platform axis untouched', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['inventory'] });

    const toolNames = await submit('set stock levels');
    expect(toolNames).not.toContain('inventory__set_stock_level');
    // Not a blanket outage: every other module's tools are still on offer, so
    // the filter is per module rather than a catalogue that collapsed.
    expect(toolNames.some((name) => name.startsWith('catalog__'))).toBe(true);
  });

  it('withholds it when the module is platform-unavailable, as it always did', async () => {
    // The axis that already worked. Asserted so the fix cannot be read as a
    // replacement of one axis by the other — presence is the conjunction.
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'inventory'));
    expect(await submit('set stock levels')).not.toContain('inventory__set_stock_level');
  });

  it('restores the tool when the operator switches the module back on', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['inventory'] });
    expect(await submit('set stock levels')).not.toContain('inventory__set_stock_level');

    llm.reset();
    registryCache.__setEnabledForTesting(ALL_IDS);
    expect(await submit('set stock levels')).toContain('inventory__set_stock_level');
  });
});

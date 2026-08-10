import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';
import { isModuleDisabled, withModuleAbsence } from '../../lib/api/module-absence';
import { getModulePresence, MODULE_PRESENCE_TAG } from '../../lib/api/module-presence';

/**
 * Feature 073 / US1 (T039–T041) — the storefront's half of "off means absent".
 *
 * Two claims, and the second is the one that was actually broken:
 *
 *  1. Presence is a projection the storefront **reads**, tagged so a flip takes
 *     effect on the next request without a rebuild (FR-036, watch item W-1).
 *  2. A `MODULE_DISABLED` refusal maps to a *typed absence*, uniformly. Before
 *     this, `getBlogIndex` rethrew every non-404 — so a gated `blog` produced a
 *     render error rather than disappearing — while `getShopInfo` and friends
 *     swallowed every error into a default, so a gated module kept rendering an
 *     empty surface. Opposite defects, one helper.
 */

const originalFetch = globalThis.fetch;

function stubFetch(body: unknown, status = 200): typeof fetch {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy as unknown as typeof fetch;
}

describe('getModulePresence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports only the modules the backend said are present', async () => {
    stubFetch({
      modules: [
        { id: 'blog', present: true },
        { id: 'comparisons', present: false },
      ],
    });
    const presence = await getModulePresence();
    expect(presence.isPresent('blog')).toBe(true);
    expect(presence.isPresent('comparisons')).toBe(false);
    expect(presence.presentIds).toEqual(['blog']);
  });

  it('treats a module the projection never mentioned as absent', async () => {
    stubFetch({ modules: [{ id: 'blog', present: true }] });
    const presence = await getModulePresence();
    expect(presence.isPresent('module_nobody_registered')).toBe(false);
  });

  it('tags the fetch so a flip is visible on the next request without a rebuild', async () => {
    const spy = stubFetch({ modules: [] });
    await getModulePresence();
    const init = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
      | { next?: { tags?: string[] } }
      | undefined;
    expect(init?.next?.tags).toContain(MODULE_PRESENCE_TAG);
    expect(MODULE_PRESENCE_TAG).toBe('modules:presence');
  });

  it('degrades to "everything present" when the backend is unreachable', async () => {
    // The opposite trade-off from the backend's gating seams, deliberately: an
    // unresolved axis there means a refusal nobody sees, here it would mean an
    // empty shop. Each module's own fetch still answers for itself.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const presence = await getModulePresence();
    expect(presence.isPresent('anything')).toBe(true);
  });
});

describe('withModuleAbsence', () => {
  it('recognises the MODULE_DISABLED envelope', () => {
    expect(
      isModuleDisabled(new StorefrontApiError(503, 'MODULE_DISABLED', 'off')),
    ).toBe(true);
    expect(isModuleDisabled(new StorefrontApiError(500, 'INTERNAL', 'boom'))).toBe(false);
    expect(isModuleDisabled(new Error('network'))).toBe(false);
  });

  it('answers the typed absence when the module is switched off', async () => {
    const result = await withModuleAbsence(async () => {
      throw new StorefrontApiError(503, 'MODULE_DISABLED', 'off');
    }, null);
    expect(result).toBeNull();
  });

  it('propagates every other failure rather than papering over it', async () => {
    // "The module is gone" is a decision the platform made and the page renders
    // around it. "The backend is broken" is not something a storefront should
    // quietly turn into an empty list.
    await expect(
      withModuleAbsence(async () => {
        throw new StorefrontApiError(500, 'INTERNAL', 'boom');
      }, null),
    ).rejects.toThrow(StorefrontApiError);
  });

  it('returns the value untouched on success', async () => {
    expect(await withModuleAbsence(async () => 'ok', null)).toBe('ok');
  });
});

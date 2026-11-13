import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';

/**
 * Issue #463 — the shell's i18n bundle fetch is answered by the suite, once.
 *
 * `App.tsx` and the shell mount their own `TranslationProvider` with no
 * `initialBundle`, so every test that renders them asks
 * `/api/v1/admin/i18n/bundles` through the kit's internal client — a call a
 * test's `vi.mock('@endora-commerce/admin-kit/lib')` does not reach. It used to
 * meet `admin/test/setup.ts`'s network guard, and every such file logged
 * `[i18n] bundle fetch failed … unstubbed network call` while depending on the
 * refusal being harmless. The setup file now answers that one endpoint with an
 * empty bundle; everything else still meets the guard.
 */
describe('the suite-wide i18n bundle answer (admin/test/setup.ts)', () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each(['en', 'pl'] as const)('answers the %s bundle request with an empty bundle', async (language) => {
    const response = await fetch(`http://localhost:3000/api/v1/admin/i18n/bundles?language=${language}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { language, version: 0, bundles: {} } });
  });

  it('still refuses every other request by name', async () => {
    await expect(fetch('http://localhost:3000/api/v1/admin/products')).rejects.toThrow(
      'unstubbed network call to http://localhost:3000/api/v1/admin/products',
    );
  });

  it('lets a provider with no initial bundle boot without a fetch failure', async () => {
    render(
      <TranslationProvider language="en">
        <span>mounted</span>
      </TranslationProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const failures = warn.mock.calls.filter((call) => call.some((arg) => String(arg).includes('bundle fetch failed')));
    expect(failures).toEqual([]);
  });
});

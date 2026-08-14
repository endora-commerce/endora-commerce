import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Descriptors are contributed by the module that owns them (feature 072, T143a).
 *
 * A composition root that pushes a module's descriptor into another module's
 * registry produces a contribution **nothing can switch off**: only a module's
 * own registration passes through the lifecycle seams, so the root's call keeps
 * the descriptor live with its module disabled. That is a Constitution XVII
 * hole, not untidiness, and it is invisible at the call site — the root's line
 * reads exactly like the module's would.
 *
 * Two clusters are pinned here, both of the "push at boot" shape: a module
 * contributing a descriptor to a registry another module enumerates.
 *
 *  - the four `configurationTypeRegistry` registrations (`credentials`' own two,
 *    plus `pim_ergonode`'s and `product_feeds`');
 *  - the four asset / CMS reference cross-registrations (`catalog`, `cms` and
 *    `megamenu` into `assets_library`' registry, `megamenu` into `cms`').
 *
 * Source-level assertions, for the reason `harness-parity.test.ts` gives: the
 * property is a property of the *wiring*, and booting both roots to compare
 * them would cost two compositions per run. The behaviour each contribution
 * buys is covered where it belongs — `test/contract/credentials/*`,
 * `test/integration/assets_library/*`.
 */

const backendRoot = fileURLToPath(new URL('../../../', import.meta.url));

function read(relative: string): string {
  return readFileSync(`${backendRoot}${relative}`, 'utf8');
}

/**
 * Whitespace-insensitive, because the formatter decides whether a call fits on
 * one line and a test that pins the wrapping would fail on a reformat rather
 * than on a wiring change.
 */
function flat(source: string): string {
  // The trailing comma goes with the wrapping: the formatter adds one exactly
  // when it breaks the argument list across lines.
  return source.replace(/\s+/g, '').replace(/,\)/g, ')');
}

const ROOTS: Readonly<Record<string, string>> = {
  production: read('src/composition.ts'),
  harness: read('test/helpers/test-server.ts'),
};

/** Contribution → the module whose `backend.ts` must make it. */
const CONTRIBUTIONS: ReadonlyArray<{
  readonly call: string;
  readonly owner: string;
}> = [
  { call: 'register(llmConfigurationType)', owner: 'credentials' },
  { call: 'register(emailAdapterConfigurationType)', owner: 'credentials' },
  { call: 'register(ergonodeConfigurationType)', owner: 'pim_ergonode' },
  { call: 'register(feedDeliveryConfigurationType)', owner: 'product_feeds' },
  { call: 'registerCatalogAssetReferences(', owner: 'catalog' },
  { call: 'registerCmsAssetReferences(', owner: 'cms' },
  { call: 'registerMegamenuAssetReferences(', owner: 'megamenu' },
  { call: 'registerMegamenuCmsReferences(', owner: 'megamenu' },
];

describe('T143a — module-owned descriptors are contributed by their module', () => {
  it.each(CONTRIBUTIONS)('$owner makes the $call contribution itself', ({ call, owner }) => {
    expect(flat(read(`src/modules/${owner}/backend.ts`))).toContain(flat(call));
  });

  it.each(CONTRIBUTIONS)('no composition root makes the $call contribution', ({ call }) => {
    for (const [label, source] of Object.entries(ROOTS)) {
      expect(flat(source).includes(flat(call)), `${label} still contributes ${call}`).toBe(false);
    }
  });

  it('every contribution is pushed from a boot hook, not a registration', () => {
    // Registration declares; it never resolves. These four registries are
    // *read* by their host — the credentials type catalogue on every admin
    // request, the reference registries on every delete — so a contributor
    // pushes from `ctx.onBoot`, which runs after every module has registered
    // and before any request is served.
    for (const owner of new Set(CONTRIBUTIONS.map((entry) => entry.owner))) {
      expect(read(`src/modules/${owner}/backend.ts`)).toContain('ctx.onBoot(');
    }
  });
});

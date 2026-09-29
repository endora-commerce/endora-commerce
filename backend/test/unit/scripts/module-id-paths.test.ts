/**
 * `129 FR-011(d)`'s predicate — *"a path carrying a module's id"*, read as
 * tokens since owner ruling D-272 clause 2 — in its one home,
 * `backend/scripts/lib/module-id-paths.ts` (owner rulings D-263 clause 1 and
 * D-262 clause 1).
 *
 * These cases lived in the extraction deriver's suite until that deriver
 * retired with the last extraction (`specs/136-open-source-publication/`
 * W3.3). The predicate did not retire with it: the publication filter's
 * completeness walk and host-tree rule read it
 * (`specs/134-paid-module-extraction/` T091 case 6 and T094a), so its cases
 * stay here, beside it, rather than leaving with the instrument that happened
 * to hold them.
 */
import { describe, expect, it } from 'vitest';

import {
  distinctiveTokens,
  filenameStem,
  moduleIdSpellings,
  pathCarriesModuleId,
  segmentTokens,
} from '../../../scripts/lib/module-id-paths.js';

/**
 * A population in which neither of `demo_mod`'s tokens is distinctive: `demo`
 * is shared with `demo_other` and `mod` with `other_mod`. The population is
 * always a parameter (D-272 clause 2; D-100), never a constant of the file.
 */
const DEMO_POPULATION = ['demo_mod', 'demo_other', 'other_mod'];

describe('the FR-011(d) predicate', () => {
  it('reads a whole path segment and a filename stem, in either spelling', () => {
    const carries = (path: string): boolean =>
      pathCarriesModuleId(path, 'demo_mod', DEMO_POPULATION);
    expect(carries('backend/test/unit/demo_mod/x.test.ts')).toBe(true);
    expect(carries('admin/src/modules/demo-mod/index.ts')).toBe(true);
    expect(carries('docs/docs/modules/demo_mod.md')).toBe(true);
    expect(carries('docs/docs/module-reference/demo-mod.md')).toBe(true);
    expect(carries('admin/test/modules/demo-mod.surface.test.tsx')).toBe(true);
  });

  it('is not a substring match: a token that only begins with the id is not the id', () => {
    // D-272 clause 2 widened the predicate from "a whole segment or a stem" to
    // "a token run in any segment". `demo-mod-webhook.ts` now carries the id —
    // it is exactly the `scripted-<vendor>-client.ts` shape the old predicate
    // was blind to — while a path whose tokens merely *start* with the id's,
    // and a helper that names only a shared token, still do not.
    const carries = (path: string): boolean =>
      pathCarriesModuleId(path, 'demo_mod', DEMO_POPULATION);
    expect(carries('backend/test/helpers/demo-mod-webhook.ts')).toBe(true);
    expect(carries('backend/test/helpers/scripted-demo-client.ts')).toBe(false);
    expect(carries('packages/modules/demo_module/src/x.ts')).toBe(false);
  });

  it('spells an id both ways, once each, and an id without an underscore once', () => {
    expect(moduleIdSpellings('demo_mod')).toEqual(['demo_mod', 'demo-mod']);
    expect(moduleIdSpellings('blog')).toEqual(['blog']);
  });

  it('takes the stem as everything before the first dot of the basename', () => {
    expect(filenameStem('admin/test/modules/demo-mod.surface.test.tsx')).toBe('demo-mod');
    expect(filenameStem('docs/docs/modules/demo_mod.md')).toBe('demo_mod');
    expect(filenameStem('scripts/Makefile')).toBe('Makefile');
  });
});

// --- D-272 clause 2: the predicate reads tokens ------------------------------

describe('the token predicate (D-272 clause 2, 134 T094a)', () => {
  const population = [
    'payu',
    'pim_akeneo',
    'pim_connector',
    'pim_ergonode',
    'comarch_xl',
    'comarch_xl_example_overlay',
    'blog',
    'cms',
  ];
  const carries = (path: string, id: string): boolean => pathCarriesModuleId(path, id, population);

  it('splits a segment on non-alphanumerics and on lower-to-upper camel-case boundaries', () => {
    expect(segmentTokens('PayuPayForm.tsx')).toEqual(['payu', 'pay', 'form', 'tsx']);
    expect(segmentTokens('generated:module-reference--pim-akeneo.json')).toEqual([
      'generated',
      'module',
      'reference',
      'pim',
      'akeneo',
      'json',
    ]);
  });

  it('reads the id as a contiguous token run inside a segment', () => {
    expect(carries('storefront/app/x/PayuPayForm.tsx', 'payu')).toBe(true);
    expect(
      carries('docs/translation-cache/pl/generated:module-reference--pim-akeneo.json', 'pim_akeneo'),
    ).toBe(true);
    expect(carries('backend/src/apps/e/modules/comarch_xl_example_overlay/x.ts', 'comarch_xl')).toBe(
      true,
    );
  });

  it('reads a token distinctive to the id, derived from the population passed in', () => {
    expect(carries('docs/docs/integrations/akeneo-pim.md', 'pim_akeneo')).toBe(true);
    expect(carries('admin/test/components/AppShell.ergonode-nav.test.tsx', 'pim_ergonode')).toBe(
      true,
    );
  });

  it('refuses the substring reading, and a token every sibling id shares', () => {
    expect(carries('src/blogger.ts', 'blog')).toBe(false);
    expect(carries('src/cmsk/x.ts', 'cms')).toBe(false);
    // `pim` is carried by every `pim_*` id and by `pim_connector`: not distinctive.
    expect(carries('src/pim-connector.ts', 'pim_akeneo')).toBe(false);
  });

  it('derives the distinctive tokens from the population, and none for a single-token id', () => {
    expect(distinctiveTokens('pim_akeneo', population)).toEqual(['akeneo']);
    expect(distinctiveTokens('payu', population)).toEqual([]);
    // Both of `comarch_xl`'s tokens are shared with the overlay's id.
    expect(distinctiveTokens('comarch_xl', population)).toEqual([]);
    // A different population is a different answer: the population is a parameter.
    expect(distinctiveTokens('comarch_xl', ['comarch_xl', 'blog'])).toEqual(['comarch', 'xl']);
  });
});

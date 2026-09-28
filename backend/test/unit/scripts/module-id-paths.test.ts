/**
 * `129 FR-011(d)`'s predicate — *"a path carrying a module's id as a whole
 * path segment or a filename stem, in either spelling"* — in its one home,
 * `backend/scripts/lib/module-id-paths.ts` (owner rulings D-263 clause 1 and
 * D-262 clause 1).
 *
 * These cases lived in the extraction deriver's suite until that deriver
 * retired with the last extraction (`specs/136-open-source-publication/`
 * W3.3). The predicate did not retire with it: it is the shared home the
 * publication filter's completeness refusal is to read
 * (`specs/134-paid-module-extraction/` T091 case 6), so its cases stay here,
 * beside it, rather than leaving with the instrument that happened to hold them.
 */
import { describe, expect, it } from 'vitest';

import {
  filenameStem,
  moduleIdSpellings,
  pathCarriesModuleId,
} from '../../../scripts/lib/module-id-paths.js';

describe('the FR-011(d) predicate', () => {
  it('reads a whole path segment and a filename stem, in either spelling', () => {
    expect(pathCarriesModuleId('backend/test/unit/demo_mod/x.test.ts', 'demo_mod')).toBe(true);
    expect(pathCarriesModuleId('admin/src/modules/demo-mod/index.ts', 'demo_mod')).toBe(true);
    expect(pathCarriesModuleId('docs/docs/modules/demo_mod.md', 'demo_mod')).toBe(true);
    expect(pathCarriesModuleId('docs/docs/module-reference/demo-mod.md', 'demo_mod')).toBe(true);
    expect(pathCarriesModuleId('admin/test/modules/demo-mod.surface.test.tsx', 'demo_mod')).toBe(
      true,
    );
  });

  it('does not read the id out of the middle of a filename', () => {
    // A `scripted-<vendor>-client.ts` helper says whose it is nowhere in its
    // path. Widening the predicate to a substring would make every `scripted-*`
    // helper in the tree everybody's, so it deliberately is not one.
    expect(pathCarriesModuleId('backend/test/helpers/scripted-demo-client.ts', 'demo_mod')).toBe(
      false,
    );
    expect(pathCarriesModuleId('backend/test/helpers/demo-mod-webhook.ts', 'demo_mod')).toBe(false);
    expect(pathCarriesModuleId('packages/modules/demo_module/src/x.ts', 'demo_mod')).toBe(false);
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

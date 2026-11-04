import { describe, expect, it } from 'vitest';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';

/**
 * Feature 170, owner decision 2026-11-04 (spec Clarifications round 9): one name per place, in
 * English and Polish, on every 170 surface. The scope overview is the "Scope map", the publication
 * window is "Publication window" / "Okres publikacji", and the inherit action is "Use value from
 * {scope}". The bulk status option "Use inherited (remove the override)" belongs to 163's bulk
 * dialog, which 170 does not change, and is the one value left out here.
 */

const LEFT_OUT = new Set(['productsList.bulkEdit.scopedStatus.inherit']);

/** The core bundle's 170 surface is the ScopedField; the rest of it belongs to other screens. */
function scopedField(bundle: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(bundle).filter(([key]) => key.startsWith('scopedField.')));
}

const bundles: Array<[string, Record<string, string>, RegExp]> = [
  ['catalog en', catalogEn, /Scope overview|scope overview|Scopes tab|Use inherited|use inherited/],
  ['catalog pl', catalogPl, /Przegl\u0105d zakres\u00f3w|przegl\u0105d zakres\u00f3w|[Oo]kn[oa] publikacji|karcie Zakresy|zak\u0142adk\u0119 Zakresy|U\u017cyj dziedziczonego|U\u017cy\u0107 dziedziczonego/],
  ['core en', scopedField(coreEn), /Use inherited/],
  ['core pl', scopedField(corePl), /U\u017cyj dziedziczonego/],
];

describe('one vocabulary on the 170 surfaces (owner, 2026-11-04)', () => {
  it.each(bundles)('%s carries no retired name', (_name, bundle, retired) => {
    const offenders = Object.entries(bundle).filter(([key, value]) => !LEFT_OUT.has(key) && retired.test(value));
    expect(offenders).toEqual([]);
  });

  it('the place is the Scope map in both languages', () => {
    expect(catalogEn['productEditor.tab.scopes']).toBe('Scope map');
    expect(catalogEn['productEditor.scopeOverview.title']).toBe('Scope map');
    expect(catalogPl['productEditor.tab.scopes']).toBe(catalogPl['productEditor.scope.scopeMap']);
    expect(catalogPl['productEditor.scopeOverview.title']).toBe(catalogPl['productEditor.scope.scopeMap']);
  });

  it('the inherit action has one Polish form', () => {
    const form = 'U\u017cyj warto\u015bci z zakresu: {scope}';
    expect(corePl['scopedField.useParent']).toBe(form);
    expect(catalogPl['productEditor.save.error.requiredEmptyScoped']).toContain(`\u201e${form}\u201d`);
  });
});

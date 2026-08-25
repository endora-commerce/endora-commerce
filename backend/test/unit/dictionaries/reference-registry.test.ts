import { describe, expect, it } from 'vitest';
import type { DictionaryReferenceDescriptor } from '@endora-commerce/contracts';
import { CONTRIBUTION_POLICY_STATED } from '../../../scripts/check-port-dependencies.js';
import { CountryReferenceRegistry } from '../../../../packages/modules/dictionaries/src/backend/services/country-reference-registry.js';
import { LanguageReferenceRegistry } from '../../../../packages/modules/languages/src/backend/services/language-reference-registry.js';
import { CurrencyReferenceRegistry } from '../../../../packages/modules/currencies/src/backend/services/currency-reference-registry.js';

/**
 * The three dictionary reference registries (feature 077, D-87 drain).
 *
 * They replace twenty-eight raw statements in which `dictionaries`, `languages`
 * and `currencies` counted rows in eleven tables across nine modules they do not
 * own. What the drain has to preserve is the *answer* — a delete is refused
 * while anything points at the entry — and what it introduces is a decision:
 * whether a switched-off module's rows still count.
 *
 * They do, and that is asserted here structurally rather than promised in a
 * comment: the classes take no presence probe, so a skip filter has nothing to
 * consult and cannot be written without changing the stated policy.
 */

const REGISTRIES = [
  { label: 'countries', owner: 'dictionaries', name: 'countryReferenceRegistry', build: () => new CountryReferenceRegistry() },
  { label: 'languages', owner: 'languages', name: 'languageReferenceRegistry', build: () => new LanguageReferenceRegistry() },
  { label: 'currencies', owner: 'currencies', name: 'currencyReferenceRegistry', build: () => new CurrencyReferenceRegistry() },
] as const;

function descriptor(
  overrides: Partial<DictionaryReferenceDescriptor> & { counts: Record<string, number> },
): DictionaryReferenceDescriptor {
  const { counts, ...rest } = overrides;
  return {
    ownerModuleId: 'blog',
    consumer: 'blog',
    tableName: 'blog_post_languages',
    columnName: 'language',
    blocking: true,
    countReferences: async (code) => counts[code] ?? 0,
    usedCodes: async () => Object.entries(counts).map(([code, count]) => ({ code, count })),
    ...rest,
  };
}

describe.each(REGISTRIES)('$label reference registry', (registryUnderTest) => {
  it('adds up every contributor and drops the ones that count nothing', async () => {
    const registry = registryUnderTest.build();
    registry.register(descriptor({ counts: { 'pl-PL': 2 } }));
    registry.register(
      descriptor({
        ownerModuleId: 'cms',
        consumer: 'cms',
        tableName: 'cms_pages',
        columnName: 'languages[]',
        counts: { 'pl-PL': 3, 'de-DE': 1 },
      }),
    );

    const references = await registry.countReferences('pl-PL');
    expect(references.map((reference) => [reference.consumer, reference.count])).toEqual([
      ['blog', 2],
      ['cms', 3],
    ]);
    // A contributor with nothing to say is absent from the answer rather than
    // present with a zero: the caller sums what it is given, and an operator
    // reading the 409 detail should see only the modules that are in its way.
    expect(await registry.countReferences('fr-FR')).toEqual([]);
  });

  it('carries the contributor’s own `blocking` decision through', async () => {
    const registry = registryUnderTest.build();
    registry.register(descriptor({ counts: { PLN: 1 } }));
    registry.register(
      descriptor({
        ownerModuleId: 'dictionaries',
        consumer: 'countries',
        tableName: 'countries',
        columnName: 'default_currency_code',
        // `on delete set null` — reported so an operator knows the column is
        // about to be blanked, but not a reason to refuse.
        blocking: false,
        counts: { PLN: 7 },
      }),
    );

    const references = await registry.countReferences('PLN');
    expect(references.map((reference) => reference.blocking)).toEqual([true, false]);
    expect(
      references.filter((reference) => reference.blocking).reduce((n, r) => n + r.count, 0),
    ).toBe(1);
  });

  it('reports every code a contributor stores, for the orphan report', async () => {
    const registry = registryUnderTest.build();
    registry.register(descriptor({ counts: { 'pl-PL': 2, 'xx-XX': 5 } }));

    expect(await registry.usedCodes()).toEqual([
      expect.objectContaining({ code: 'pl-PL', count: 2, consumer: 'blog' }),
      expect.objectContaining({ code: 'xx-XX', count: 5, consumer: 'blog' }),
    ]);
  });

  it('records the contributing module on every entry, and registers it once', () => {
    const registry = registryUnderTest.build();
    const one = descriptor({ counts: {} });
    registry.register(one);
    registry.register(one);
    registry.register(descriptor({ ownerModuleId: 'megamenu', counts: {} }));

    expect(registry.owners()).toEqual(['blog', 'megamenu']);
  });

  it('takes no presence probe, so an absent contributor’s rows still count', () => {
    // The stated enumeration policy made structural rather than promised
    // (D-39). This registry is referential integrity, not a surface: a
    // switched-off module still owns the rows carrying the code, and deleting
    // the entry under it would break them the moment an operator switches it
    // back on — data loss caused by an action Constitution XVII promises is
    // non-destructive and reversible. A constructor with nothing to consult
    // cannot be given a skip filter without changing the policy here first.
    expect(registryUnderTest.build().constructor.length).toBe(0);
    expect(
      CONTRIBUTION_POLICY_STATED[`${registryUnderTest.owner}:${registryUnderTest.name}`],
    ).toBe('honour');
  });
});

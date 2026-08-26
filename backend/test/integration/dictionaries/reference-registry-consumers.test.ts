import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DictionaryReferenceRegistryPort } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { CountryReferenceRegistry } from '../../../../packages/modules/dictionaries/src/backend/services/country-reference-registry.js';
import { LanguageReferenceRegistry } from '../../../../packages/modules/languages/src/backend/services/language-reference-registry.js';
import { CurrencyReferenceRegistry } from '../../../../packages/modules/currencies/src/backend/services/currency-reference-registry.js';
import { registerCountryCurrencyReference } from '../../../../packages/modules/dictionaries/src/backend/services/country-currency-reference.js';
import { registerAddressCountryReferences } from '../../../../packages/modules/addresses/src/backend/services/address-country-reference.js';
import { registerTaxCountryReferences } from '../../../../packages/modules/taxes/src/backend/services/tax-country-reference.js';
import { registerOrganizationCountryReferences } from '../../../../packages/modules/organizations/src/backend/services/organization-country-reference.js';
import { registerWarehouseCountryReferences } from '../../../src/modules/inventory/services/warehouse-country-reference.js';
import { registerBlogLanguageReferences } from '../../../../packages/modules/blog/src/backend/services/blog-language-reference.js';
import { registerCmsLanguageReferences } from '../../../../packages/modules/cms/src/backend/services/cms-language-reference.js';
import { registerMegamenuLanguageReferences } from '../../../../packages/modules/megamenu/src/backend/services/megamenu-language-reference.js';
import { registerPromotionCurrencyReferences } from '../../../../packages/modules/promotions/src/backend/services/promotion-currency-reference.js';
import { registerPriceListCurrencyReferences } from '../../../../packages/modules/price_lists/src/backend/services/price-list-currency-reference.js';
import { CurrencyService } from '../../../../packages/modules/currencies/src/backend/services/currency-service.js';
import { LanguageService } from '../../../../packages/modules/languages/src/backend/services/language-service.js';

/**
 * The ten contributed dictionary-reference descriptors, against the real schema
 * (feature 077, D-87 drain).
 *
 * The statements they carry used to live in `dictionaries`, `languages` and
 * `currencies` — twenty-eight reaches into eleven tables across nine modules,
 * every one of them a string no import-level boundary check can see. Moving a
 * statement does not make it right, and nothing else in the tree compiles these
 * against the columns they name: a typo in `address->>'countryCode'` would have
 * shown up as a 500 on a delete, in production, months later.
 *
 * So both halves of every descriptor are executed here. The counts are asserted
 * where a row is cheap to make; where it is not, the assertion is that the
 * statement runs and answers `0` — which is what actually catches a column that
 * is not there.
 */

const CONTRIBUTORS = [
  { dictionary: 'country', module: 'addresses', register: registerAddressCountryReferences },
  { dictionary: 'country', module: 'taxes', register: registerTaxCountryReferences },
  { dictionary: 'country', module: 'organizations', register: registerOrganizationCountryReferences },
  { dictionary: 'country', module: 'inventory', register: registerWarehouseCountryReferences },
  { dictionary: 'language', module: 'blog', register: registerBlogLanguageReferences },
  { dictionary: 'language', module: 'cms', register: registerCmsLanguageReferences },
  { dictionary: 'language', module: 'megamenu', register: registerMegamenuLanguageReferences },
  { dictionary: 'currency', module: 'promotions', register: registerPromotionCurrencyReferences },
  { dictionary: 'currency', module: 'price_lists', register: registerPriceListCurrencyReferences },
  { dictionary: 'currency', module: 'dictionaries', register: registerCountryCurrencyReference },
] as const;

describe('the contributed dictionary-reference descriptors', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it.each(CONTRIBUTORS)(
    '$module answers both questions about its own $dictionary column',
    async ({ register }) => {
      const registry = new CountryReferenceRegistry();
      register(registry as DictionaryReferenceRegistryPort, () => em);

      // `zz-ZZ` is a code no fixture uses, so both answers are structural: the
      // statement either runs against the columns it names or it throws.
      expect(await registry.countReferences('zz-ZZ')).toEqual([]);
      const used = await registry.usedCodes();
      expect(used.every((reference) => typeof reference.count === 'number')).toBe(true);
      expect(used.some((reference) => reference.code === 'zz-ZZ')).toBe(false);
    },
  );

  it('counts a tax rule as a country reference and names the module that holds it', async () => {
    const registry = new CountryReferenceRegistry();
    registerTaxCountryReferences(registry, () => em);
    await em.execute(
      `insert into "taxes"
         ("id","code","name","rate","country","applies_to_vat_statuses",
          "is_default","priority","created_at","updated_at")
       values (gen_random_uuid(), 'tx-pl-23', 'PL VAT 23%', 0.23, 'PL',
               '[]'::jsonb, false, 0, now(), now())`,
    );

    expect(await registry.countReferences('PL')).toEqual([
      {
        ownerModuleId: 'taxes',
        consumer: 'taxes',
        tableName: 'taxes',
        columnName: 'country',
        code: 'PL',
        count: 1,
        blocking: true,
      },
    ]);
  });

  it('reports a country’s default currency without blocking the delete', async () => {
    const registry = new CurrencyReferenceRegistry();
    registerCountryCurrencyReference(registry, () => em);
    // The reference this asserts on is made here, like the tax rule above.
    // `countries` is filled by the `dictionaries` seed reconciler at boot, and
    // `setupTestDb` boots no server — so the version that updated `PL` matched
    // zero rows and counted zero references unless some other file's
    // `setupBackendServer` had run first in the same invocation (issue #272,
    // the issue #159 family).
    //
    // The codes are outside ISO 3166-1 and ISO 4217, so the two inserts stand
    // whether or not a booting file has already seeded the real catalogue: the
    // fixture never collides with a seeded row, in either direction. The
    // currency is inserted too, because `countries_default_currency_fk` refuses
    // a reference to a currency that is not there.
    await em.execute(
      `insert into "currencies"
         ("code","label","symbol","symbol_position","decimal_places",
          "is_default","is_active","sort_order","created_at","updated_at")
       values ('ZZD', 'Fixture dollar', 'Z$', 'suffix', 2, false, true, 0, now(), now())`,
    );
    await em.execute(
      `insert into "countries"
         ("code","alpha3_code","numeric_code","label","region","is_eu_member",
          "default_currency_code","is_active","is_default","sort_order",
          "created_at","updated_at")
       values ('ZZ', 'ZZZ', '999', 'Fixtureland', 'Europe', false, 'ZZD',
               true, false, 0, now(), now())`,
    );

    const references = await registry.countReferences('ZZD');
    // `countries.default_currency_code` is `on delete set null`, so the
    // reference is worth showing an operator and is not a reason to refuse —
    // the distinction the hand-written version made by leaving one number out
    // of a sum, and which now travels on the descriptor.
    expect(references).not.toEqual([]);
    expect(references.every((reference) => reference.blocking)).toBe(false);
  });
});

/**
 * The kernel's `sales_channels` is the one consumer with no descriptor: it is
 * not a module, so nobody can contribute for it. `languages` and `currencies`
 * read it through the ORM instead — allowed, because a module may relate into
 * the kernel (D-32) — where they used to name the table in SQL.
 */
describe('the channel half of the same guard', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses to delete a language the default channel still names', async () => {
    const languages = new LanguageService(() => em, undefined, undefined, () =>
      new LanguageReferenceRegistry(),
    );
    // `findOneOrFail`, not a `??` over a raw-SQL read (issue #275): a
    // system-default channel always exists (D-47…D-51), so an absent row is a
    // broken platform and has to say so here rather than turn into `'en-US'`
    // and fail twenty lines down as "the language is not the default".
    const channel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    const code = channel.defaultLanguage;
    // Demote it first, so the refusal under test is the dependent one rather
    // than "you cannot delete the default language".
    await em.execute(`update "languages" set "is_default" = false where "code" = ?`, [code]);

    const references = await languages.countDependents(code);
    expect(references.map((reference) => reference.columnName)).toContain('default_language');
    await expect(languages.remove(code)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_HAS_DEPENDENTS',
    });
  });

  it('refuses to delete a currency the default channel still names', async () => {
    const currencies = new CurrencyService(() => em, undefined, undefined, () =>
      new CurrencyReferenceRegistry(),
    );
    const channel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    const code = channel.defaultCurrency;
    await em.execute(`update "currencies" set "is_default" = false where "code" = ?`, [code]);

    const references = await currencies.countDependents(code);
    expect(references.map((reference) => reference.columnName)).toContain('default_currency');
    await expect(currencies.remove(code)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_HAS_DEPENDENTS',
    });
  });
});

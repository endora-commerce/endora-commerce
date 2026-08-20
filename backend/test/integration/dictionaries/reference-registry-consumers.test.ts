import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DictionaryReferenceRegistryPort } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { CountryReferenceRegistry } from '../../../src/modules/dictionaries/services/country-reference-registry.js';
import { LanguageReferenceRegistry } from '../../../src/modules/languages/services/language-reference-registry.js';
import { CurrencyReferenceRegistry } from '../../../src/modules/currencies/services/currency-reference-registry.js';
import { registerCountryCurrencyReference } from '../../../src/modules/dictionaries/services/country-currency-reference.js';
import { registerAddressCountryReferences } from '../../../src/modules/addresses/services/address-country-reference.js';
import { registerTaxCountryReferences } from '../../../src/modules/taxes/services/tax-country-reference.js';
import { registerOrganizationCountryReferences } from '../../../src/modules/organizations/services/organization-country-reference.js';
import { registerWarehouseCountryReferences } from '../../../src/modules/inventory/services/warehouse-country-reference.js';
import { registerBlogLanguageReferences } from '../../../src/modules/blog/services/blog-language-reference.js';
import { registerCmsLanguageReferences } from '../../../src/modules/cms/services/cms-language-reference.js';
import { registerMegamenuLanguageReferences } from '../../../src/modules/megamenu/services/megamenu-language-reference.js';
import { registerPromotionCurrencyReferences } from '../../../src/modules/promotions/services/promotion-currency-reference.js';
import { registerPriceListCurrencyReferences } from '../../../src/modules/price_lists/services/price-list-currency-reference.js';
import { CurrencyService } from '../../../src/modules/currencies/services/currency-service.js';
import { LanguageService } from '../../../src/modules/languages/services/language-service.js';

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
    await em.execute(
      `update "countries" set "default_currency_code" = 'PLN' where "code" = 'PL'`,
    );

    const references = await registry.countReferences('PLN');
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
    const [channel] = await em.execute(
      `select "default_language" as code from "sales_channels" where "system_default" = true`,
    ) as Array<{ code: string }>;
    const code = channel?.code ?? 'en-US';
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
    const [channel] = await em.execute(
      `select "default_currency" as code from "sales_channels" where "system_default" = true`,
    ) as Array<{ code: string }>;
    const code = channel?.code ?? 'PLN';
    await em.execute(`update "currencies" set "is_default" = false where "code" = ?`, [code]);

    const references = await currencies.countDependents(code);
    expect(references.map((reference) => reference.columnName)).toContain('default_currency');
    await expect(currencies.remove(code)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_HAS_DEPENDENTS',
    });
  });
});

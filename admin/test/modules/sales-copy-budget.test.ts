import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UX audit 2026-11-17, the SALES part of the DS-02 text pass (issue #1436,
 * `ux-audit-sales.md` §4 *Page descriptions*): the order, quote-request, cart,
 * customer, organization, returns, payment/delivery-method, credit-limit,
 * promotion and quick-order screens lost the page descriptions that restated
 * their title or spoke to developers ("the kind picks the backend driver",
 * "follow-up specs"), and the few kept say something the screen does not show,
 * on one clamped line (`specs/conventions/module-i18n.md`).
 *
 * Pinned per bundle and per language: a cut key stays cut, in the bundle and in
 * the module sources that read it; a kept or shortened line fits the budget.
 */
const ONE_LINE = 80;

const LANGUAGES = ['en', 'pl'] as const;

interface Cut {
  /** The package under `packages/modules/` whose `i18n/` holds the key. `_i18n` is the shared `core` bundle. */
  bundle: string;
  key: string;
  /** The module whose admin sources must no longer read it. */
  reader: string;
}

const CUT: readonly Cut[] = [
  { bundle: '_i18n', key: 'orders.page.description', reader: 'orders' },
  { bundle: '_i18n', key: 'orderCreate.description', reader: 'orders' },
  { bundle: '_i18n', key: 'orderStatusConfig.description', reader: 'orders' },
  { bundle: '_i18n', key: 'rfq.list.description', reader: 'quote_requests' },
  { bundle: '_i18n', key: 'rfqCreate.description', reader: 'quote_requests' },
  // Dead: defined, never read (the audit's grep, re-checked for this change).
  { bundle: '_i18n', key: 'rfq.detail.convert.description', reader: 'quote_requests' },
  { bundle: '_i18n', key: 'rfq.detail.approveDescription', reader: 'quote_requests' },
  { bundle: '_i18n', key: 'organizations.page.description', reader: 'organizations' },
  { bundle: '_i18n', key: 'returns.description', reader: 'returns' },
  { bundle: '_i18n', key: 'returns.statuses.description', reader: 'returns' },
  // #1472 (SALES-07): "0 = free" moved to the cost field's hint (`methods.field.costHint`).
  { bundle: '_i18n', key: 'returns.methods.description', reader: 'returns' },
  { bundle: '_i18n', key: 'legacyMethods.payment.description', reader: 'payment_methods' },
  { bundle: '_i18n', key: 'legacyMethods.integrations.description', reader: 'payment_methods' },
  { bundle: '_i18n', key: 'legacyMethods.integrations.shippingDescription', reader: 'delivery_methods' },
  { bundle: '_i18n', key: 'creditLimits.page.description', reader: 'credit_limits' },
  // #1436 (DS-02 remainder, S1): "Cart-level discounts. Percentage values are 0..100;
  // amount-off requires a currency." The title says the first half, and the editor's
  // fields already enforce the second.
  { bundle: '_i18n', key: 'promotions.page.description', reader: 'promotions' },
  { bundle: '_i18n', key: 'promotions.edit.description', reader: 'promotions' },
  { bundle: '_i18n', key: 'promotionStats.description', reader: 'promotions' },
  { bundle: 'customers', key: 'list.description', reader: 'customers' },
  { bundle: 'carts', key: 'carts.page.description', reader: 'carts' },
  { bundle: 'quick_order', key: 'onBehalf.page.description', reader: 'quick_order' },
  { bundle: 'organizations', key: 'create.description', reader: 'organizations' },
  { bundle: 'organizations', key: 'changeTaxId.page.description', reader: 'organizations' },
  { bundle: 'organizations', key: 'convertToCompany.page.description', reader: 'organizations' },
];

/** Kept on screen, so each must fit the one clamped line. */
const ONE_LINERS: readonly { bundle: string; key: string }[] = [
  { bundle: '_i18n', key: 'returns.reasons.description' },
  { bundle: 'returns', key: 'methods.field.costHint' },
  { bundle: '_i18n', key: 'legacyMethods.delivery.description' },
  { bundle: '_i18n', key: 'promotionRules.page.description' },
  { bundle: 'customers', key: 'online.description' },
  { bundle: 'customer_accounts', key: 'groups.page.description' },
  { bundle: 'organizations', key: 'taxIdScope.description' },
  { bundle: 'organizations', key: 'create.hint.inviteMembers' },
];

const modulesRoot = resolve(process.cwd(), '../packages/modules');

function bundle(name: string, language: (typeof LANGUAGES)[number]): Record<string, string> {
  return JSON.parse(readFileSync(join(modulesRoot, name, 'i18n', `${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
}

function adminSources(module: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(join(modulesRoot, module, 'src', 'admin'));
  return out;
}

describe('SALES page copy (UX audit DS-02, #1436)', () => {
  it.each(LANGUAGES)('keeps every cut description out of the %s bundles', (language) => {
    const left = CUT.filter(({ bundle: name, key }) => key in bundle(name, language)).map(
      ({ bundle: name, key }) => `${name}:${key}`,
    );
    expect(left).toEqual([]);
  });

  it('leaves no admin source reading a cut key', () => {
    const readers = CUT.flatMap(({ key, reader }) =>
      adminSources(reader)
        .filter((file) => readFileSync(file, 'utf8').includes(`'${key}'`))
        .map((file) => `${key} ← ${file.slice(modulesRoot.length + 1)}`),
    );
    expect(readers).toEqual([]);
  });

  it.each(LANGUAGES)('fits every kept %s line in the one-line budget', (language) => {
    const over = ONE_LINERS.map(({ bundle: name, key }) => ({
      key: `${name}:${key}`,
      length: bundle(name, language)[key]?.length ?? Number.NaN,
    })).filter(({ length }) => !(length <= ONE_LINE));
    expect(over).toEqual([]);
  });
});

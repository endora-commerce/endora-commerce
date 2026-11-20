import { describe, expect, it } from 'vitest';

import {
  baselineKey,
  budgetOf,
  checkTextBudget,
  TEXT_BUDGET_BASELINE,
  TEXT_BUDGETS,
  type TextBudgetBundle,
  type TextBudgetFindingKind,
  type TextBudgetResult,
} from '../../../scripts/check-text-budget.js';

/**
 * Companion test for `check-text-budget` (issue #1451, UX audit 2026-11-17
 * DS-23). Every proof enters as **bundle source text** — the bytes a real run
 * reads off `<module>/i18n/en.json` — so the parse, the key grammar, the
 * measurement and the ratchet all run, and each asserts the finding's kind.
 */

const long = (length: number): string => 'x'.repeat(length);

function bundle(moduleId: string, entries: Record<string, string>): TextBudgetBundle {
  return { moduleId, path: `${moduleId}/i18n/en.json`, text: JSON.stringify(entries) };
}

function run(
  bundles: readonly TextBudgetBundle[],
  baseline: Readonly<Record<string, number>> = {},
): TextBudgetResult {
  return checkTextBudget({ bundles, baseline });
}

function kinds(result: TextBudgetResult, kind: TextBudgetFindingKind): readonly string[] {
  return result.findings.filter((finding) => finding.kind === kind).map((finding) => finding.entry);
}

describe('check-text-budget — the key grammar', () => {
  it('budgets the five key families at the ruled lengths', () => {
    expect(budgetOf('orders.page.description')?.budget).toBe(80);
    expect(budgetOf('home.recentActivity.subtitle')?.budget).toBe(80);
    expect(budgetOf('adminUsers.resetPassword.hint')?.budget).toBe(80);
    expect(budgetOf('warehouses.page.help')?.budget).toBe(280);
    expect(budgetOf('settingLabels.analytics.reporting_time_zone.description')?.budget).toBe(120);
  });

  it('leaves every other key unbudgeted', () => {
    // A bare `description` is an action's palette description or a dialog body;
    // a camelCase `…Hint` is not the `hint` key family the ruling names.
    expect(budgetOf('actions.newProduct.description')).toBeNull();
    expect(budgetOf('pageBuilder.linkField.anchorHint')).toBeNull();
    expect(budgetOf('errors.NOT_FOUND')).toBeNull();
    expect(budgetOf('settingLabels.analytics.reporting_time_zone.label')).toBeNull();
  });

  it('declares each family once', () => {
    expect(new Set(TEXT_BUDGETS.map((rule) => rule.id)).size).toBe(TEXT_BUDGETS.length);
  });
});

describe('check-text-budget — what it refuses', () => {
  it('reports an unledgered key over its budget', () => {
    const result = run([bundle('orders', { 'orders.page.description': long(81) })]);
    expect(kinds(result, 'over-budget')).toEqual(['orders:orders.page.description']);
  });

  it('counts characters, not UTF-16 code units', () => {
    // Eighty Polish letters with diacritics and one astral symbol are 81
    // characters — and 82 code units, which is the reading that over-counts.
    const atBudget = 'ż'.repeat(79) + '😀';
    expect(run([bundle('orders', { 'orders.hint': atBudget })]).findings).toEqual([]);
    expect(
      kinds(run([bundle('orders', { 'orders.hint': `${atBudget}a` })]), 'over-budget'),
    ).toEqual(['orders:orders.hint']);
  });

  it('holds a setting description to 120, not 80', () => {
    const key = 'settingLabels.orders.auto_cancel.description';
    expect(run([bundle('orders', { [key]: long(120) })]).findings).toEqual([]);
    expect(kinds(run([bundle('orders', { [key]: long(121) })]), 'over-budget')).toEqual([
      `orders:${key}`,
    ]);
  });

  it('holds a help popover to 280, not to the 80 of a hint', () => {
    // The `HelpTip` popover is where a hint's overflow goes, so copy between
    // 81 and 280 characters is exactly what it is for.
    expect(run([bundle('orders', { 'orders.field.code.help': long(200) })]).findings).toEqual([]);
    expect(run([bundle('orders', { 'orders.field.code.help': long(280) })]).findings).toEqual([]);
    expect(
      kinds(run([bundle('orders', { 'orders.field.code.help': long(281) })]), 'over-budget'),
    ).toEqual(['orders:orders.field.code.help']);
  });

  it('reports a ledgered key that grew past its recorded length', () => {
    const result = run([bundle('orders', { 'orders.hint': long(95) })], {
      [baselineKey('orders', 'orders.hint')]: 90,
    });
    expect(kinds(result, 'ledger-grew')).toEqual(['orders:orders.hint']);
  });

  it('reports a ledgered key that came back within budget as stale', () => {
    const result = run([bundle('orders', { 'orders.hint': long(40) })], {
      [baselineKey('orders', 'orders.hint')]: 90,
    });
    expect(kinds(result, 'ledger-stale')).toEqual(['orders:orders.hint']);
  });

  it('reports a ledgered key that shrank but is still over budget as stale', () => {
    // Two-way, in `HARDCODED_STRINGS_BASELINE`'s idiom: a number that describes
    // a debt already partly paid has to come down with it.
    const result = run([bundle('orders', { 'orders.hint': long(85) })], {
      [baselineKey('orders', 'orders.hint')]: 90,
    });
    expect(kinds(result, 'ledger-stale')).toEqual(['orders:orders.hint']);
  });

  it('reports a ledgered key that no longer exists as stale', () => {
    const result = run([bundle('orders', { 'orders.title': 'Orders' })], {
      [baselineKey('orders', 'orders.hint')]: 90,
    });
    expect(kinds(result, 'ledger-stale')).toEqual(['orders:orders.hint']);
  });

  it('reports a bundle it cannot parse instead of skipping it', () => {
    const result = run([{ moduleId: 'orders', path: 'orders/i18n/en.json', text: '{ "a": ' }]);
    expect(kinds(result, 'unparseable-bundle')).toEqual(['orders']);
  });

  it('accepts a ledgered key at exactly its recorded length', () => {
    const result = run([bundle('orders', { 'orders.hint': long(90) })], {
      [baselineKey('orders', 'orders.hint')]: 90,
    });
    expect(result.findings).toEqual([]);
    expect(result.overBudget).toEqual([{ entry: 'orders:orders.hint', length: 90, budget: 80 }]);
  });

  it('keys the ledger by module, so one key in two modules is two entries', () => {
    const result = run(
      [bundle('orders', { 'page.hint': long(90) }), bundle('cms', { 'page.hint': long(90) })],
      { [baselineKey('orders', 'page.hint')]: 90 },
    );
    expect(kinds(result, 'over-budget')).toEqual(['cms:page.hint']);
  });

  it('counts the bundles it opened and the budgeted keys it judged', () => {
    const result = run([
      bundle('orders', { 'orders.hint': 'Short.', 'orders.title': 'Orders' }),
      bundle('cms', { 'cms.page.description': 'One line.' }),
    ]);
    expect(result.filesRead).toBe(2);
    expect(result.sites).toBe(2);
  });
});

describe('check-text-budget — the recorded baseline', () => {
  it('records every entry above the budget its key family carries', () => {
    for (const [entry, length] of Object.entries(TEXT_BUDGET_BASELINE)) {
      const key = entry.slice(entry.indexOf(':') + 1);
      const rule = budgetOf(key);
      expect(rule, entry).not.toBeNull();
      expect(length, entry).toBeGreaterThan(rule?.budget ?? Number.POSITIVE_INFINITY);
    }
  });
});

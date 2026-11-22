/**
 * Issues #1458 (UX audit CAT-13) and #1459 (CAT-14), and the catalog area's part
 * of the DS-02 text pass (#1436) — the copy of the catalog screens is short, and
 * what the screen already shows is not said again in a sentence.
 *
 * The audit's *Text to cut* list (area CAT, §4) marked each key **D** (delete:
 * it explains what a badge, a column or the control already shows) or **S**
 * (shorten). This file holds the outcome:
 *
 * - a deleted key is gone from **both** bundles and no admin source reads it;
 * - a shortened key fits its budget in **both** languages — 80 characters for a
 *   page description, a hint or a field note (`specs/conventions/module-i18n.md`),
 *   100 for a confirmation body or a longer notice, 120 / 150 for a setting
 *   description. What a short note can no longer carry moved behind a ⓘ
 *   (`help`), whose key must exist in both bundles.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

type Bundle = Record<string, string>;

function bundle(module: string, language: 'en' | 'pl'): Bundle {
  return JSON.parse(
    readFileSync(path.join(repoRoot, 'packages/modules', module, 'i18n', `${language}.json`), 'utf8'),
  ) as Bundle;
}

/** Keys the audit marked **D**: the UI already says it (a badge, a column, the control). */
const DELETED: ReadonlyArray<readonly [module: string, key: string]> = [
  ['catalog', 'productEditor.gallery.help.global'],
  ['catalog', 'productEditor.gallery.help.scoped'],
  ['catalog', 'productEditor.attachments.help.global'],
  ['catalog', 'productEditor.attachments.help.scoped'],
  ['catalog', 'productEditor.attributes.scopedHelp'],
  ['catalog', 'productEditor.attributes.help'],
  ['catalog', 'productEditor.section.categories.help'],
  ['catalog', 'orderRules.minimum.help'],
  ['catalog', 'packagingUnits.minOrderUnitsHelp'],
  ['seo', 'productSeo.help'],
  ['product_feeds', 'delivery.field.passiveMode.help'],
  // The rest of the list, removed with their screens' redesign (CAT-01, CAT-02, CAT-08, CAT-13).
  ['catalog', 'productEditor.scope.editing'],
  ['catalog', 'inventoryTab.stockMgmt.disableManageStockHelp'],
  ['catalog', 'productsList.bulk.editPrice'],
  ['catalog', 'productsList.bulk.editPriceUnavailable'],
  ['catalog', 'categories.page.description'],
  ['catalog', 'bulkOperations.subtitle'],
  ['price_lists', 'priceBooks.create.description'],
];

const NOTE = 80;
const BODY = 100;

/** Keys the audit marked **S**, with the budget each now fits in both languages. */
const SHORTENED: ReadonlyArray<readonly [module: string, key: string, max: number]> = [
  // Product editor (CAT-14)
  ['catalog', 'productEditor.scopeOverview.help', 60],
  ['catalog', 'productEditor.field.status.help', NOTE],
  ['catalog', 'productEditor.field.publishWindow.help', 60],
  ['catalog', 'productEditor.field.urlKey.help', 60],
  ['catalog', 'productEditor.field.sku', 10],
  ['catalog', 'productEditor.globalOnlyTab.body', 60],
  ['catalog', 'productEditor.guard.body.one', NOTE],
  ['catalog', 'productEditor.guard.body.few', NOTE],
  ['catalog', 'productEditor.guard.body.many', NOTE],
  ['catalog', 'productEditor.guard.body.other', NOTE],
  ['catalog', 'productEditor.duplicateConfirm', BODY],
  ['catalog', 'productEditor.archive.confirmBody', BODY],
  ['catalog', 'productEditor.restore.confirmBody', BODY],
  ['catalog', 'inventoryTab.lowStock.perWarehouseHelp', 60],
  ['catalog', 'inventoryTab.lowStock.help', 60],
  ['catalog', 'inventoryTab.stockMgmt.backorderHelp', 60],
  ['catalog', 'orderRules.returnable.help', 60],
  ['catalog', 'packagingUnits.help', 60],
  ['price_lists', 'basePrices.description', NOTE],
  // Products list and bulk edit
  ['catalog', 'productsList.bulkEdit.returnable.hint', NOTE],
  ['catalog', 'productsList.bulkEdit.restore.confirmBody', BODY],
  ['catalog', 'productsList.bulkEdit.archive.confirmBody', BODY],
  ['catalog', 'productsList.bulkEdit.scopedStatus.gateHelp', NOTE],
  // Catalog list pages and their forms
  ['catalog', 'attributes.scope.help', NOTE],
  ['catalog', 'attributes.pageBuilder.languageNote', NOTE],
  ['catalog', 'settingLabels.catalog.scope_completeness_gate.description', 150],
  // Price lists
  ['price_lists', 'grid.note', 60],
  ['price_lists', 'settings.listPrice.help', BODY],
  // Inventory
  ['_i18n', 'warehouses.editor.field.defaultLowStockThresholdHelp', NOTE],
  // Custom fields
  ['custom_fields', 'customFields.audience.help', BODY],
  ['custom_fields', 'customFields.carry.help', BODY],
  // Product feeds
  ['product_feeds', 'feeds.settings.priceBook.hint', NOTE],
  ['product_feeds', 'delivery.ftp.plaintextWarning', BODY],
  ['product_feeds', 'delivery.field.headers.secretNote', BODY],
  // SEO and search. The four `settingLabels.seo.*.description` keys are not here: their
  // content is pinned by the SEO spec (FR-008, FR-027, FR-033 — `seo/src/backend/manifest.test.ts`)
  // and they shorten once a Settings row has its own ⓘ (UX audit SHELL-23).
  ['search', 'settingLabels.search.llm.enabled.description', 120],
  ['seo', 'crawlerPreview.notice.storefrontOutdated', 120],
  ['seo', 'crawlerPreview.notice.siteWideDisallow', 120],
  // Import/Export and Assets
  ['import_export', 'importProfiles.description', NOTE],
  ['import_export', 'importProfiles.mapping.hint', NOTE],
  ['import_export', 'empty', NOTE],
  ['assets_library', 'detail.permalink.help', 60],
  // Dictionaries (CAT §4): the hard-coded description moved to i18n at ≤ 60.
  ['dictionaries', 'page.description', 60],
];

/** Every `PageHeader` description and subtitle on the area's screens: one line, ≤ 80 (CAT-13). */
const PAGE_DESCRIPTIONS: ReadonlyArray<readonly [module: string, key: string]> = [
  ['catalog', 'attributes.page.description'],
  ['catalog', 'attributeSets.page.description'],
  ['catalog', 'attachmentTypes.page.description'],
  ['catalog', 'productContent.page.description'],
  ['catalog', 'categoryContent.page.description'],
  ['price_lists', 'priceBooks.list.description'],
  ['price_lists', 'priceBooks.explainer.description'],
  ['_i18n', 'inventory.availability.description'],
  ['_i18n', 'inventory.lowStock.description'],
  ['custom_fields', 'customFields.description'],
  ['dictionaries', 'page.description'],
  ['dictionaries', 'audit.page.description'],
  ['product_feeds', 'page.subtitle'],
  ['product_feeds', 'feeds.create.subtitle'],
  ['product_feeds', 'mapping.subtitle'],
  ['product_feeds', 'revisions.subtitle'],
  ['product_feeds', 'templates.subtitle'],
  ['product_feeds', 'templates.startFrom.subtitle'],
  ['product_feeds', 'import.subtitle'],
  ['import_export', 'page.description'],
];

/** What a shortened note could not keep, behind a ⓘ beside the field. */
const MOVED_TO_HELP: ReadonlyArray<readonly [module: string, key: string]> = [
  ['catalog', 'productEditor.field.status.helpTip'],
  ['catalog', 'productEditor.field.publishWindow.helpTip'],
  ['catalog', 'orderRules.returnable.helpTip'],
];

/** Implementation words an operator does not use (Mental Model). */
const JARGON = /Meilisearch|fan-out|backend|hybrid lexical|deterministic|migration/i;

function adminSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  const modules = path.join(repoRoot, 'packages/modules');
  for (const module of readdirSync(modules)) {
    const admin = path.join(modules, module, 'src/admin');
    if (existsSync(admin)) walk(admin);
  }
  return out;
}

describe('catalog copy pass (CAT-13, CAT-14, DS-02)', () => {
  const languages = ['en', 'pl'] as const;

  describe('deleted keys', () => {
    const sources = adminSources().map((file) => readFileSync(file, 'utf8'));
    it.each(DELETED)('%s › %s is gone from both bundles and every admin source', (module, key) => {
      for (const language of languages) expect(bundle(module, language)[key], language).toBeUndefined();
      expect(sources.filter((source) => source.includes(`'${key}'`))).toEqual([]);
    });
  });

  describe('shortened keys', () => {
    it.each(SHORTENED)('%s › %s fits in %i characters in EN and PL', (module, key, max) => {
      for (const language of languages) {
        const text = bundle(module, language)[key];
        expect(text, `${language} ${key}`).toBeTruthy();
        expect(text!.length, `${language} ${key}: ${text}`).toBeLessThanOrEqual(max);
        expect(text, `${language} ${key}`).not.toMatch(JARGON);
      }
    });
  });

  describe('page descriptions', () => {
    it.each(PAGE_DESCRIPTIONS)('%s › %s is one short line in EN and PL', (module, key) => {
      for (const language of languages) {
        const text = bundle(module, language)[key];
        expect(text, `${language} ${key}`).toBeTruthy();
        expect(text!.length, `${language} ${key}: ${text}`).toBeLessThanOrEqual(80);
        expect(text, `${language} ${key}`).not.toMatch(JARGON);
      }
    });
  });

  describe('explanations moved behind a ⓘ', () => {
    it.each(MOVED_TO_HELP)('%s › %s exists in EN and PL', (module, key) => {
      for (const language of languages) expect(bundle(module, language)[key], language).toBeTruthy();
    });
  });
});

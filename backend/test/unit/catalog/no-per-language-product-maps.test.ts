import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Feature 170 / T048 — the regression guard of FR-034 (`contracts/readers.md` §3, SC-003).
 *
 * After the scope-model migration a product's name, description, alt text, attachment and
 * packaging-unit texts are one Global string plus scoped override rows; the per-language maps
 * are gone. A reader that still indexes a product's `name` by a language, picks a language out
 * of it, or names one of the retired structures reads something that no longer exists — and a
 * type-check does not always see it (a local `Record<string, string>` type compiles happily
 * over a string at runtime, which is how the admin product browser split a name into
 * characters). This test walks the population of readers.md §1's header and fails on any of
 * the identifiers and patterns of §3.
 *
 * ## The allow-list is by file, two-way, with a reason per entry
 *
 * An entry is either a file that reads a **non-product** map the patterns cannot tell from a
 * product one (category, attribute label, option label, …), or a file whose de-shim belongs to
 * a later task or another stream — that kind names the task that removes it. An entry the tree
 * has stopped backing fails too (the `no-new-enum-values` precedent): a permission nobody needs
 * is the half of an allow-list that rots.
 *
 * Migrations are excluded structurally, not listed: a migration converting the retired tables
 * names them by design and is never a reader.
 */

const POPULATION = [
  'packages/modules',
  'packages/admin-kit/src',
  'packages/page-builder-admin/src',
  'packages/cms-components/src',
  'packages/contracts/src',
  'packages/platform/src',
  'admin/src',
  'storefront/app',
  'storefront/lib',
  'storefront/components',
];

/** A path is out of the population when it is a test, a migration, generated, or outside `src`. */
function inPopulation(file: string): boolean {
  if (!/\.(ts|tsx)$/.test(file)) return false;
  if (/\.(test|spec)\.tsx?$/.test(file) || /\.cases\.ts$/.test(file)) return false;
  if (/(^|\/)(test|tests|__tests__|dist|node_modules)\//.test(file)) return false;
  if (/\/src\/migrations\//.test(file)) return false;
  if (file.startsWith('packages/modules/') && !/^packages\/modules\/[^/]+\/src\//.test(file)) return false;
  return true;
}

/** §3 — identifiers of the retired structures. Word-bounded, case-sensitive. */
const IDENTIFIERS = [
  'nameTranslations',
  'descriptionTranslations',
  'localizedNames',
  'effectiveNames',
  'translationMapPatchSchema',
  'channelScoped',
  'languageScoped',
  'gallery_item_channel_labels',
  'gallery_item_channel_hidden',
  'product_attachment_channel_hidden',
  'name_translations',
  'description_translations',
];
/** §3 — literal markers that are not identifiers. */
const LITERALS = ['global+language', '170-shim'];

/** §3 — patterns on product shapes. */
const PRODUCT_INDEX = /\b(product|p|item|hit|record|row)\??\.(name|description)\??\[/;
const PICK_ON_NAME = /pick\w*\(\s*(\w+\??\.)*(name|description)\b/;
const SQL_MAP_READ = /(products|p)\."?(name|description)"?\s*->>/;
const ALT_TEXT_MAP = /alt_text\s*->/;

/** A file "imports a catalog product type" (§3): it names one of the product read shapes. */
const CATALOG_PRODUCT_TYPE =
  /\b(CatalogProductRecord|CatalogQuickSearchHit|CatalogPackagingUnitRecord|ComparisonProductSummary|ProductImportRow|ProductBrowserItem)\b/;

interface Site {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function scan(file: string, source: string): Site[] {
  const sites: Site[] = [];
  const importsProductType = CATALOG_PRODUCT_TYPE.test(source);
  const lines = source.split('\n');
  lines.forEach((text, index) => {
    const hit = (rule: string): void => {
      sites.push({ file, line: index + 1, rule, text: text.trim() });
    };
    for (const id of IDENTIFIERS) if (new RegExp(`\\b${id}\\b`).test(text)) hit(id);
    for (const literal of LITERALS) if (text.includes(literal)) hit(literal);
    if (PRODUCT_INDEX.test(text)) hit('product-index');
    if (importsProductType && PICK_ON_NAME.test(text)) hit('pick-on-name');
    if (SQL_MAP_READ.test(text)) hit('sql-map-read');
    if (ALT_TEXT_MAP.test(text)) hit('alt-text-map');
  });
  return sites;
}

/**
 * By file; every entry carries its reason. `pending` entries name the task (and the stream)
 * that removes them — at checkpoint C3 they are the only ones left besides non-product maps.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'packages/modules/catalog/src/admin/components/AttachmentScopesDialog.tsx',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/components/PackagingUnitsEditor.tsx',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/components/ProductAttachmentsSection.tsx',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/components/ProductAttributesTab.tsx',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/components/ProductGallerySection.tsx',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/components/ProductScopeEditor.tsx',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/components/ProductScopeOverview.tsx',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/components/ProductUrlKeysPanel.tsx',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/lib/attribute-scope.ts',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/lib/media-scopes.ts',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/lib/product-url-keys-api.ts',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/lib/scope-overview.ts',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/pages/AttributesManager.tsx',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/pages/ProductEditor.tsx',
    reason: 'S3 — catalog admin editor, removed in US5 after the prototype gate (T143)',
  },
  {
    file: 'packages/modules/catalog/src/admin/pages/AttachmentTypesPage.tsx',
    reason: "non-product map: an attachment type's own name per language (readers.md 'Not readers'), matched by `row.name[` — S3's file",
  },
  {
    file: 'packages/modules/catalog/src/backend/services/catalog-admin.service.ts',
    reason: "S1 — the duplicate's scoped names are not copied: a product question (S1 block 2 report), not a task yet",
  },
  {
    file: 'packages/modules/catalog/src/backend/services/catalog-bulk-import.service.ts',
    reason: "S1 — channel codes in a products file's cells and the deprecated exportScopedStatuses, removed once import_export's adapter resolves codes and reads exportScopedValues (T087, S2)",
  },
  {
    file: 'packages/modules/seo/src/admin/index.ts',
    reason: 'S3 — seo admin, rewritten in US10 (T122+)',
  },
  {
    file: 'packages/modules/seo/src/admin/pages/SeoMetaScopeEditor.tsx',
    reason: 'S3 — seo admin, rewritten in US10 (T122+)',
  },
  {
    file: 'packages/modules/seo/src/admin/zones/ProductSeoLink.tsx',
    reason: 'S3 — seo admin, rewritten in US10 (T122+)',
  },
  {
    file: 'packages/modules/seo/src/backend/services/meta-tag-resolver.service.ts',
    reason: 'S2 — the derived meta fallback at (C, L), deferred to US10 (T117-T121)',
  },
  {
    file: 'packages/modules/quote_requests/src/admin/pages/RfqCreatePage.tsx',
    reason: "non-product map: a sales channel's name per language, through the kit's pickCategoryDisplayName",
  },
];

function walk(repoRoot: string): string[] {
  const out = execFileSync('git', ['ls-files', '--', ...POPULATION], { cwd: repoRoot, encoding: 'utf8' });
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .filter(inPopulation);
}

describe('no per-language product maps (feature 170, FR-034)', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const files = walk(repoRoot);
  const sites = files.flatMap((file) => scan(file, readFileSync(path.join(repoRoot, file), 'utf8')));
  const filesWithSites = [...new Set(sites.map((s) => s.file))];
  process.stdout.write(`[no-per-language-product-maps] read: files=${files.length} sites=${sites.length}\n`);

  it('read something — an empty walk is a moved tree, not a clean one', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('finds no read of a removed per-language product structure outside the allow-list', () => {
    const allowed = new Set(ALLOWLIST.map((entry) => entry.file));
    const offenders = sites.filter((site) => !allowed.has(site.file));
    if (offenders.length > 0) {
      throw new Error(
        `Feature 170 / FR-034 — per-language product structures read outside the allow-list:\n` +
          offenders.map((s) => `  - ${s.file}:${s.line} [${s.rule}] ${s.text}`).join('\n') +
          `\n\nRead the effective (channel, language) text through catalogProductAvailabilityPort ` +
          `.effectiveTexts / .effectivePackagingUnitNames, or the Global string where there is no ` +
          `channel (contracts/readers.md §1). A non-product map goes on the allow-list with a reason.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('holds no allow-list entry the tree has stopped backing', () => {
    const stale = ALLOWLIST.filter((entry) => !filesWithSites.includes(entry.file));
    if (stale.length > 0) {
      throw new Error(
        `Feature 170 / FR-034 — allow-list entries that describe nothing:\n` +
          stale.map((entry) => `  - ${entry.file} (${entry.reason})`).join('\n') +
          `\n\nThe file no longer reads a map — delete the entry — or it moved: re-point it.`,
      );
    }
    expect(stale).toEqual([]);
  });
});

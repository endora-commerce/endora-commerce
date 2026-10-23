import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * SC-010 of `specs/160-pricing-model-v2/` (FR-048, task T138): after the price-book
 * release no documentation page, in either locale, describes a mechanism the release
 * removed as if it were still there.
 *
 * Three mechanisms went with the old pricing model, and each is searched for in
 * English and in the words the Polish pages used for it:
 *
 * - the **Application rule** — the rule tree that decided which buyers a price list
 *   served (`applicationRule`);
 * - the product's **default price** — the `defaultPrice` attribute and the product
 *   editor's *Default unit price* field;
 * - the **variant price override** — `product_variants.price_override`.
 *
 * A page may still name one of them **in a section marked as history or as a
 * migration note**: one under a heading that says so ("Migration note", "History",
 * "After upgrading to …", and their Polish equivalents). That is where a reader
 * upgrading an instance needs to be told what was removed and what replaced it. Any
 * other mention is a finding, with its file and line.
 *
 * The site's copies of module pages (`docs/docs/modules/<module>…`, written by
 * `docs:collect` and never committed) are skipped: their sources under
 * `packages/modules/<id>/docs/` are read instead, so a finding names the file to edit.
 */

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');

const ROOTS = [
  'docs/docs',
  'docs/i18n/pl/docusaurus-plugin-content-docs/current',
] as const;

/** Each removed mechanism, by the words a page would describe it with. */
const REMOVED: ReadonlyArray<{ readonly mechanism: string; readonly patterns: readonly RegExp[] }> = [
  {
    mechanism: 'the Application rule',
    patterns: [/\bapplication[\s-]+rules?\b/i, /applicationRule/, /\bregu\p{L}* stosowania\b/iu],
  },
  {
    mechanism: "the product's default price",
    patterns: [
      /defaultPrice/i,
      // Not the `pricing.default_display_mode` setting, *Default price display mode*.
      /\bdefault[\s-]+(unit[\s-]+)?prices?\b(?![\s-]+display)/i,
      /\bdomyśln\p{L}* (jednostkow\p{L}* )?cen\p{L}*/iu,
      /\bcen\p{L}* domyśln\p{L}*/iu,
    ],
  },
  {
    mechanism: 'the variant price override',
    patterns: [/price[\s_-]?override/i, /\bnadpisani\p{L}* cen\p{L}*/iu],
  },
];

/** A heading that marks its section as history or a migration note. */
const HISTORY_HEADING =
  /(?<!\p{L})(histor|migrat|migracj|migracyj|upgrad|aktualizacj|uaktualni|removed|usunięt)\p{L}*/iu;

function markdownFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (/\.mdx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** The module packages' own pages, and the paths `docs:collect` copies them to. */
function modulePages(): { sources: string[]; copies: Set<string> } {
  const modulesRoot = join(REPO_ROOT, 'packages', 'modules');
  const sources: string[] = [];
  const copies = new Set<string>();
  for (const moduleId of readdirSync(modulesRoot)) {
    const docsDir = join(modulesRoot, moduleId, 'docs');
    for (const page of markdownFiles(docsDir)) {
      sources.push(page);
      copies.add(join(REPO_ROOT, 'docs', 'docs', 'modules', relative(docsDir, page)));
    }
  }
  return { sources, copies };
}

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly mechanism: string;
  readonly text: string;
}

/** Every mention outside a history or migration section. */
function findingsIn(file: string): Finding[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const headings: Array<{ level: number; history: boolean }> = [];
  const out: Finding[] = [];
  let inFence = false;
  lines.forEach((text, index) => {
    if (/^\s*(```|~~~)/.test(text)) inFence = !inFence;
    const heading = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(text);
    if (heading) {
      const level = heading[1]!.length;
      while (headings.length > 0 && headings[headings.length - 1]!.level >= level) headings.pop();
      headings.push({ level, history: HISTORY_HEADING.test(heading[2]!) });
    }
    if (headings.some((h) => h.history)) return;
    for (const { mechanism, patterns } of REMOVED) {
      if (patterns.some((pattern) => pattern.test(text))) {
        out.push({ file: relative(REPO_ROOT, file), line: index + 1, mechanism, text: text.trim() });
      }
    }
  });
  return out;
}

describe('SC-010 — no page describes a removed pricing mechanism as current behaviour', () => {
  const { sources, copies } = modulePages();
  const sitePages = ROOTS.flatMap((root) => markdownFiles(join(REPO_ROOT, root))).filter(
    (file) => !copies.has(file),
  );
  const pages = [...sitePages, ...sources];

  it('reads the pages of both locales and of the module packages', () => {
    expect(pages.some((file) => file.includes('/i18n/pl/'))).toBe(true);
    expect(pages.some((file) => file.endsWith('packages/modules/price_lists/docs/price_lists.md'))).toBe(true);
  });

  it('finds the Application rule, the default price and the variant price override only in history or migration notes', () => {
    expect(pages.flatMap(findingsIn)).toEqual([]);
  });

  it('recognises a mention in an ordinary section, and leaves one in a migration note alone', () => {
    // The detector itself, so a pattern that silently stopped matching cannot pass the
    // assertion above by finding nothing.
    const probe = (body: string): string[] =>
      REMOVED.filter(({ patterns }) => body.split('\n').some((line) => patterns.some((p) => p.test(line)))).map(
        (r) => r.mechanism,
      );
    expect(probe('The Application rule decides who a list serves.')).toEqual(['the Application rule']);
    expect(probe('Set the Default unit price on the product.')).toEqual(["the product's default price"]);
    expect(probe('Ustaw cenę domyślną produktu.')).toEqual(["the product's default price"]);
    expect(probe('`product_variants.price_override` is charged.')).toEqual(['the variant price override']);
    expect(probe('Default price display mode')).toEqual([]);
    expect(HISTORY_HEADING.test('Upgrading from the old model (migration note)')).toBe(true);
    expect(HISTORY_HEADING.test('Uwaga migracyjna')).toBe(true);
    expect(HISTORY_HEADING.test('How the winning price is chosen')).toBe(false);
  });
});

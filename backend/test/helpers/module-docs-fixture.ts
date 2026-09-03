import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectDocPages } from '../../scripts/lib/module-docs.js';
import type { ModuleUnderCheck } from '../../scripts/check-module-docs.js';

/**
 * A documentation tree on disk for `check:module-docs`, plus the records the
 * generated manifest index would produce over it.
 *
 * **The fixture is a tree and a page's own front matter, not a set of
 * attributions**, and that is the whole reason it exists rather than a literal
 * array in each proof (issue #130). The check's analysis is a directory walk, a
 * front-matter parse, a slug fold and an alias lookup; a fixture that handed in
 * "page `x` belongs to module `y`" would prove the reporter and leave every one
 * of those unproven — including the fold, which is what decides whether a page
 * is attributed at all and therefore whether `unlocated-page` can fire.
 *
 * The two committed artefacts are handed in as **text the walk did not produce**,
 * for the same reason the real check reads them off disk rather than re-rendering
 * them: `orphan-page` and `unpaired-index-row` are questions about what the
 * *artefact* says, and a proof deriving them from the same walk would make both
 * findings unreachable by construction.
 *
 * Shared by the companion test and `check-inventory.test.ts`' red proofs, in the
 * idiom `bundle-pairing-fixture.ts` established: two builders over one population
 * are two answers waiting to disagree.
 */

/** One page the fixture writes out. */
export interface FixturePage {
  /** Path under the modules category — `catalog.md`, `catalog/attributes.md`. */
  readonly path: string;
  /** Docusaurus front matter, written as a leading `---` block. */
  readonly frontMatter?: Readonly<Record<string, string>>;
  /** Body after the front matter. A heading by default, as a real page has. */
  readonly body?: string;
}

/** One module the fixture's index registers. */
export interface FixtureModuleDocs {
  readonly id: string;
  /** `true` writes `docs: false` into the record — the deliberate-none state. */
  readonly declaresNoDocs?: boolean;
}

export interface ModuleDocsFixture {
  /** The temporary content root — the site's `docs/` equivalent. */
  readonly contentRoot: string;
  /** `<contentRoot>/modules`, which is what the walk is pointed at. */
  readonly modulesRoot: string;
  /** What the generated index would hand the check over this tree. */
  readonly modules: readonly ModuleUnderCheck[];
  /** The pages the real walk produces over the tree just written. */
  readonly pages: ReturnType<typeof collectDocPages>;
  cleanup: () => void;
}

function frontMatterBlock(fields: Readonly<Record<string, string>>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return '';
  return `---\n${entries.map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n\n`;
}

export function createModuleDocsFixture(
  modules: readonly FixtureModuleDocs[],
  pages: readonly FixturePage[],
): ModuleDocsFixture {
  const root = mkdtempSync(join(tmpdir(), 'module-docs-'));
  const contentRoot = join(root, 'docs');
  const modulesRoot = join(contentRoot, 'modules');
  mkdirSync(modulesRoot, { recursive: true });

  for (const page of pages) {
    const target = join(modulesRoot, page.path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(
      target,
      `${frontMatterBlock(page.frontMatter ?? {})}# ${page.path}\n\n${page.body ?? 'Prose.'}\n`,
      'utf8',
    );
  }

  const records: ModuleUnderCheck[] = modules.map((module) => {
    // A module directory with a manifest, because the record below claims one
    // is there and every consumer takes `dirname` of it.
    const directory = join(root, 'modules', module.id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'manifest.ts'), 'export const manifest = {};\n', 'utf8');
    return {
      moduleId: module.id,
      directory,
      declaresNoDocs: module.declaresNoDocs === true,
    };
  });

  return {
    contentRoot,
    modulesRoot,
    modules: records,
    pages: collectDocPages(modulesRoot),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * The sidebar artefact's own text, as the generator would write it.
 *
 * Text rather than a list, because the check reads the committed file with a
 * literal-node scan and a proof that handed in the parsed list would leave that
 * reader unproven — which is the reader that decides whether every page is an
 * orphan.
 */
export function sidebarArtefactNaming(docIds: readonly string[]): string {
  return `const modules = [\n${docIds
    .map((id) => `  { type: 'doc', id: '${id}', label: '${id}' },`)
    .join('\n')}\n];\n\nmodule.exports = modules;\n`;
}

/** The module map artefact's own text, with a linked row per module id. */
export function mapArtefactNaming(
  rows: readonly { moduleId: string; slug?: string | undefined }[],
): string {
  return (
    '| Module | Capability | Ships from |\n| --- | --- | --- |\n' +
    rows
      .map((row) =>
        row.slug === undefined
          ? `| \`${row.moduleId}\` | _no page yet_ | core |`
          : `| [${row.moduleId}](./${row.slug}.md) | A capability. | core |`,
      )
      .join('\n') +
    '\n'
  );
}

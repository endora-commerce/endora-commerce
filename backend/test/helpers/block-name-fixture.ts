/**
 * The shared fixture builder for `check:block-names` — feature 096, T701.
 *
 * **One builder over one population**, called by the companion test and by the
 * inventory's red proofs, in the idiom `emitted-freshness-fixture.ts`
 * established: two builders over one population are two answers waiting to
 * disagree, and the one that disagrees quietly is the one inside a red proof,
 * where nothing is watching it.
 *
 * **Every fixture enters at the top of the analysis** (issue #130). What a
 * caller supplies is *source text* and a *manifest set* — the two things a real
 * run reads — and this builder runs the whole chain: `collectSites` parses the
 * text into sites, `analyseBlockNames` classifies them. A fixture handing in a
 * pre-classified record would prove the reporter and leave every predicate
 * unproven, which is the defect issue #130 is about.
 */
import {
  analyseBlockNames,
  blockNameRefusal,
  collectSites,
  emptySites,
  type BlockNameFinding,
  type BlockNameFindingKind,
  type BlockNameRefusal,
  type BlocksWithoutARendererEntry,
  type DeclaredModule,
} from '../../scripts/check-block-names.js';

export interface FixtureBlock {
  readonly name: string;
  readonly category?: string;
  readonly contexts?: readonly string[];
}

export interface FixtureCategory {
  readonly key: string;
  readonly contexts?: readonly string[];
  readonly weight?: number;
  readonly visible?: boolean;
}

export interface FixtureModule {
  readonly id: string;
  readonly blocks?: readonly FixtureBlock[];
  readonly categories?: readonly FixtureCategory[];
}

export interface FixtureSource {
  /** The key a message names the file by. */
  readonly key: string;
  /** Real TypeScript. Parsed, never pattern-matched. */
  readonly text: string;
}

export interface BlockNameFixture {
  readonly sources?: readonly FixtureSource[];
  readonly modules: readonly FixtureModule[];
  readonly ledger?: Readonly<Record<string, BlocksWithoutARendererEntry>>;
}

function toDeclaredModule(module: FixtureModule): DeclaredModule {
  return {
    id: module.id,
    blocks: (module.blocks ?? []).map((block) => ({
      name: block.name,
      category: block.category ?? 'content',
      contexts: block.contexts ?? ['cms'],
    })),
    categories: (module.categories ?? []).map((category) => ({
      key: category.key,
      contexts: category.contexts ?? ['cms'],
      ...(category.weight === undefined ? {} : { weight: category.weight }),
      ...(category.visible === undefined ? {} : { visible: category.visible }),
    })),
  };
}

/** The whole chain: parse the sources, classify, return every finding. */
export function blockNameFindings(fixture: BlockNameFixture): BlockNameFinding[] {
  const sites = emptySites();
  for (const source of fixture.sources ?? []) {
    collectSites({ key: source.key, text: source.text }, sites);
  }
  return [
    ...analyseBlockNames({
      sites,
      modules: fixture.modules.map(toDeclaredModule),
      ledger: fixture.ledger ?? {},
    }).findings,
  ];
}

/** The findings of one kind — what a red proof asserts on. */
export function blockNameFindingsOfKind(
  fixture: BlockNameFixture,
  kind: BlockNameFindingKind,
): BlockNameFinding[] {
  return blockNameFindings(fixture).filter((finding) => finding.kind === kind);
}

/**
 * Whether one source file could be parsed at all.
 *
 * The vacuous-pass proof for §6.6 needs this, and it is the reader's own answer
 * rather than a second one: a member whose renderer map does not parse must be
 * *named*, never treated as rendering nothing.
 */
export function blockNameParseFailure(source: FixtureSource): string | null {
  return collectSites(source, emptySites());
}

/** The five refusals decidable from the values, at the top of their analysis. */
export function blockNameRefusalOf(input: {
  readonly declaredBlocks?: number;
  readonly declaredCategories?: number;
  readonly treeSites?: number;
  readonly rendererSites?: number;
  readonly familyMembers?: number;
}): BlockNameRefusal | null {
  return blockNameRefusal({
    declaredBlocks: input.declaredBlocks ?? 1,
    declaredCategories: input.declaredCategories ?? 1,
    treeSites: input.treeSites ?? 1,
    rendererSites: input.rendererSites ?? 1,
    familyMembers: input.familyMembers ?? 1,
  });
}

/**
 * A module source holding one node literal — the tree-site shape.
 *
 * Real TypeScript, so the fixture exercises the parser rather than a regular
 * expression this file and the check would each have to get right.
 */
export function nodeLiteralSource(name: string): string {
  return `export const tree = { content: [{ type: '${name}', props: { id: 'x' } }] };\n`;
}

/** A Puck `Config` whose `components` map keys the given names. */
export function rendererMapSource(names: readonly string[]): string {
  const entries = names.map((name) => `  '${name}': stub,`).join('\n');
  return (
    "import type { Config } from '@measured/puck';\n" +
    'declare const stub: never;\n' +
    `export const config: Config = {\n  components: {\n${entries}\n  },\n};\n`
  );
}

/** A renderer `switch (node.type)` with one `case` per name. */
export function rendererSwitchSource(names: readonly string[]): string {
  const cases = names.map((name) => `    case '${name}':\n      return '${name}';`).join('\n');
  return (
    'export function render(node: { type: string }): string {\n' +
    '  switch (node.type) {\n' +
    `${cases}\n` +
    "    default:\n      return '';\n" +
    '  }\n}\n'
  );
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BlockDefinition } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Feature 151, T021 (`contracts/block-translatable-declaration.md` §1) — every
 * first-party block offered in the CMS palette says which of its props are
 * prose. An undeclared block is never sent to a model, so a block that forgot
 * its declaration would silently stay untranslated; this is what makes that a
 * build failure for the blocks this repository ships.
 *
 * Iterates the composed manifests rather than a hand list, so a new
 * CMS-context block in any module is held to it on the day it lands.
 */

const FORBIDDEN_LEAF = /^(editorName|href|url|src|code|script|html|id|.*Href|.*Slug|.*AssetId|.*Url|.*Color)$/;

const cmsBlocks = REGISTERED_MANIFESTS.flatMap((entry) =>
  ((entry.manifest.blocks ?? []) as BlockDefinition[])
    .filter((block) => block.contexts.includes('cms'))
    .map((block) => ({ module: entry.manifest.id, block })),
);

describe('CMS-context block translatable declarations', () => {
  it('reads a population', () => {
    expect(cmsBlocks.length).toBeGreaterThan(30);
  });

  it.each(cmsBlocks.map(({ module, block }) => [block.name, module, block] as const))(
    '%s (%s) declares translatable',
    (_name, _module, block) => {
      expect(block.translatable, `${block.name} has no translatable declaration`).toBeDefined();
    },
  );

  it('never declares a link, a code, a reference, a colour or an editor-only name', () => {
    const offending = cmsBlocks.flatMap(({ block }) =>
      (block.translatable ?? [])
        .filter((entry) => FORBIDDEN_LEAF.test(entry.path.split('.').at(-1)!.replace('[]', '')))
        .map((entry) => `${block.name}:${entry.path}`),
    );
    expect(offending).toEqual([]);
  });
});

/**
 * Feature 169, T056 — a block the shared renderer package registers is declared
 * by a module's manifest. An undeclared bundled block is in no descriptor, so
 * the editor never offers it and nothing translates it; this makes that a test
 * failure on the day a renderer lands without its declaration.
 *
 * The registrations are read off the package's source (`'<module>.<Name>':
 * definePageBuilderComponent(`), not imported: the renderers are React and
 * Puck, which this suite does not load.
 */
describe('every block the shared renderers register is declared', () => {
  const source = readFileSync(
    new URL('../../../../packages/cms-components/src/index.ts', `file://${import.meta.dirname}/`),
    'utf8',
  );
  const bundled = [...source.matchAll(/^\s+'([a-z_]+\.[A-Za-z]+)': definePageBuilderComponent\(/gm)].map((match) => match[1]!);
  const declared = new Set(
    REGISTERED_MANIFESTS.flatMap((entry) => ((entry.manifest.blocks ?? []) as BlockDefinition[]).map((block) => block.name)),
  );

  it('reads a population', () => {
    expect(bundled.length).toBeGreaterThan(30);
  });

  it('declares each one', () => {
    expect(bundled.filter((name) => !declared.has(name))).toEqual([]);
  });
});

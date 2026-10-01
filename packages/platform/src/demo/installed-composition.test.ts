import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NO_DEMO_COMPOSITION_NOTICE } from './host-command.js';
import {
  DEMO_COMPOSITION_PACKAGE_TYPE,
  installedDemoCompositionLoader,
} from './installed-composition.js';

/**
 * How an instance that never received a composition file still gets the demo
 * shop's wiring: the platform finds an **installed package** that declares
 * itself one.
 *
 * The defect this answers was observed on a CLI-scaffolded instance on
 * 2026-10-01: `demo seed` ran every module's own rows and printed
 * {@link NO_DEMO_COMPOSITION_NOTICE}, because the only composition that existed
 * was a file in this repository's host. 203 products were in the database and
 * no channel sold them; `admin@demo.local` had no role, so the admin sidebar
 * was empty.
 *
 * Every case enters at the top: a real directory tree with real package
 * manifests and a real module to import, scanned and loaded by the function
 * the dispatcher calls. Nothing is mocked, because the half that matters is
 * whether Node finds and loads what the scan found.
 */

let root: string;

/** A package under `<root>/<instance>/node_modules/<name>`, with an optional entry file. */
function install(
  instance: string,
  name: string,
  manifest: Record<string, unknown>,
  entry?: string,
): string {
  const dir = join(root, instance, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version: '1.0.0',
        type: 'module',
        ...(entry === undefined ? {} : { exports: { '.': './index.js' } }),
        ...manifest,
      },
      null,
      2,
    )}\n`,
  );
  if (entry !== undefined) writeFileSync(join(dir, 'index.js'), entry);
  return dir;
}

function nodeModules(instance: string): string {
  const dir = join(root, instance, 'node_modules');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A composition package whose composition echoes what it was built from. */
const ECHOING_COMPOSITION = `
export function createDemoComposition(input) {
  return {
    apply: async () => ({ applied: [String(input.isPresent('catalog'))], skipped: [] }),
    withdraw: async () => ({ applied: [], skipped: [] }),
  };
}
`;

const input = {
  em: {} as EntityManager,
  isPresent: (id: string) => id === 'catalog',
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'endora-installed-composition-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the platform finds a demo composition by what a package declares, not by its name', () => {
  it('loads the one installed package declaring `endora.type: "demo-composition"`', async () => {
    install('one', '@vendor/shop-demo', { endora: { type: DEMO_COMPOSITION_PACKAGE_TYPE } }, ECHOING_COMPOSITION);
    install('one', '@vendor/mod-catalog', { endora: { type: 'module', id: 'catalog' } });
    install('one', 'left-pad', {});

    const found = await installedDemoCompositionLoader([nodeModules('one')])(input);

    expect(found.found).toBe(true);
    if (!found.found) return;
    // The composition was built from the input the dispatcher handed over —
    // the presence oracle in particular, which every step's guard asks.
    expect(await found.composition.apply()).toEqual({ applied: ['true'], skipped: [] });
  });

  it('answers "none" with the notice when nothing declares itself one', async () => {
    install('none', '@vendor/mod-catalog', { endora: { type: 'module', id: 'catalog' } });

    const found = await installedDemoCompositionLoader([nodeModules('none')])(input);

    expect(found).toEqual({ found: false, notice: NO_DEMO_COMPOSITION_NOTICE });
  });

  it('refuses two, naming both, rather than choosing one', async () => {
    install('two', '@vendor/shop-a', { endora: { type: DEMO_COMPOSITION_PACKAGE_TYPE } }, ECHOING_COMPOSITION);
    install('two', '@vendor/shop-b', { endora: { type: DEMO_COMPOSITION_PACKAGE_TYPE } }, ECHOING_COMPOSITION);

    await expect(installedDemoCompositionLoader([nodeModules('two')])(input)).rejects.toThrow(
      /@vendor\/shop-a.*@vendor\/shop-b/s,
    );
  });

  it('fails loudly when the declared package exports no `createDemoComposition`', async () => {
    // Present and broken is not absent: reading it as "this instance has none"
    // would turn a packaging defect into a demo that silently loses its wiring.
    install('broken', '@vendor/shop-broken', { endora: { type: DEMO_COMPOSITION_PACKAGE_TYPE } }, 'export const nothing = 1;\n');

    await expect(installedDemoCompositionLoader([nodeModules('broken')])(input)).rejects.toThrow(
      /@vendor\/shop-broken.*createDemoComposition/s,
    );
  });

  it('does not take a workspace link for an installed package', async () => {
    // The same refusal module discovery makes: a link out of `node_modules` is
    // a checkout's member, and this repository's host wires its own.
    const elsewhere = install('elsewhere', '@vendor/shop-linked', { endora: { type: DEMO_COMPOSITION_PACKAGE_TYPE } }, ECHOING_COMPOSITION);
    const scope = join(nodeModules('linked'), '@vendor');
    mkdirSync(scope, { recursive: true });
    symlinkSync(elsewhere, join(scope, 'shop-linked'), 'dir');

    const found = await installedDemoCompositionLoader([nodeModules('linked')])(input);

    expect(found.found).toBe(false);
  });
});

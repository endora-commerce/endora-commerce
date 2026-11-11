import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageSchemaContributionsUnder } from './package-runtime.js';
import { defineColumnExtension } from '../kernel/schema-extensions/define.js';
import { SchemaExtensionInvalidError } from '../kernel/schema-extensions/errors.js';

/**
 * `specs/178-extensible-columns/` FR-007, FR-008 — an installed package declares
 * extensions as a `schemaExtensions` export of its `./backend` subpath, read
 * beside `entities`. The package-context rules V9 – V11 are applied here, where
 * the package's own `endora.id` and manifest are known.
 *
 * The fixture's `./backend` hands back declarations this test made, through a
 * global, so the declarations are this run's own objects: a fixture under the
 * OS temp directory cannot resolve `@endora-commerce/platform` itself.
 */

const SLOT = '__schemaExtensionFixtures';
const fixtures = globalThis as unknown as Record<string, Record<string, unknown>>;

let root: string;
let counter = 0;

function writePackage(options: {
  readonly id: string;
  readonly dependencies?: readonly string[];
  /** A JS expression for the export, or `undefined` to export nothing. */
  readonly schemaExtensions?: string;
}): string {
  const instance = join(root, `instance-${counter++}`);
  const dir = join(instance, 'node_modules', '@acme', `mod-${options.id}`);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `@acme/mod-${options.id}`,
      version: '1.2.3',
      type: 'module',
      endora: { type: 'module', id: options.id, platform: '0.x' },
      exports: { '.': './dist/manifest.js', './backend': './dist/backend.js', './package.json': './package.json' },
    }),
  );
  writeFileSync(
    join(dir, 'dist', 'manifest.js'),
    `export const manifest = ${JSON.stringify({
      id: options.id,
      name: options.id,
      version: '1.2.3',
      dependencies: options.dependencies ?? [],
    })};\n`,
  );
  writeFileSync(
    join(dir, 'dist', 'backend.js'),
    `export function registerModule() {}\nexport const entities = [];\n` +
      (options.schemaExtensions === undefined
        ? ''
        : `export const schemaExtensions = ${options.schemaExtensions};\n`),
  );
  return join(instance, 'node_modules');
}

async function refusal(promise: Promise<unknown>): Promise<SchemaExtensionInvalidError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SchemaExtensionInvalidError);
    return error as SchemaExtensionInvalidError;
  }
  throw new Error('expected a SchemaExtensionInvalidError');
}

const acme = defineColumnExtension({
  host: 'organizations',
  module: 'acme_erp',
  columns: { erpCode: { type: 'varchar', length: 64, nullable: true } },
});
const acmeTwin = defineColumnExtension({
  host: 'organizations',
  module: 'acme_erp',
  columns: { other: { type: 'text', nullable: true } },
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'schema-extensions-'));
  fixtures[SLOT] = { acme, acmeTwin, spread: { ...acme } };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  delete fixtures[SLOT];
});

describe('packageSchemaContributionsUnder — schemaExtensions', () => {
  it('reads the declarations from ./backend', async () => {
    const roots = [
      writePackage({
        id: 'acme_erp',
        dependencies: ['organizations'],
        schemaExtensions: `[globalThis.${SLOT}.acme]`,
      }),
    ];
    const [contribution] = await packageSchemaContributionsUnder(roots);
    expect(contribution?.schemaExtensions).toEqual([acme]);
    expect(contribution?.schemaExtensions[0]).toBe(acme);
  });

  it('is empty when the package exports none', async () => {
    const [contribution] = await packageSchemaContributionsUnder([writePackage({ id: 'plain' })]);
    expect(contribution?.schemaExtensions).toEqual([]);
  });

  it('refuses a non-array export, naming the package', async () => {
    const error = await refusal(
      packageSchemaContributionsUnder([
        writePackage({ id: 'acme_erp', dependencies: ['organizations'], schemaExtensions: `globalThis.${SLOT}.acme` }),
      ]),
    );
    expect(error.rule).toBe('not-a-declaration');
    expect(error.message).toContain('@acme/mod-acme_erp');
  });

  it('refuses a member that is not a branded declaration', async () => {
    const error = await refusal(
      packageSchemaContributionsUnder([
        writePackage({ id: 'acme_erp', dependencies: ['organizations'], schemaExtensions: `[globalThis.${SLOT}.spread]` }),
      ]),
    );
    expect(error.rule).toBe('not-a-declaration');
  });

  it('V9 refuses a declaration for another module id', async () => {
    const error = await refusal(
      packageSchemaContributionsUnder([
        writePackage({ id: 'someone_else', dependencies: ['organizations'], schemaExtensions: `[globalThis.${SLOT}.acme]` }),
      ]),
    );
    expect(error.rule).toBe('module-mismatch');
  });

  it('V10 refuses a host whose owner is not a dependency', async () => {
    const error = await refusal(
      packageSchemaContributionsUnder([
        writePackage({ id: 'acme_erp', dependencies: [], schemaExtensions: `[globalThis.${SLOT}.acme]` }),
      ]),
    );
    expect(error.rule).toBe('host-not-a-dependency');
  });

  it('V11 refuses two declarations of one (module, host)', async () => {
    const error = await refusal(
      packageSchemaContributionsUnder([
        writePackage({
          id: 'acme_erp',
          dependencies: ['organizations'],
          schemaExtensions: `[globalThis.${SLOT}.acme, globalThis.${SLOT}.acmeTwin]`,
        }),
      ]),
    );
    expect(error.rule).toBe('duplicate-declaration');
  });
});

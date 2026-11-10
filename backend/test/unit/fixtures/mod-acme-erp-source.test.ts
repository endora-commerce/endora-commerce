import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { configuredMigrationsFrom } from '@endora-commerce/platform/db';
import { packageSchemaContributionsUnder } from '@endora-commerce/platform/packages';

/**
 * `specs/178-extensible-columns/` SC-001 (tasks.md T031) — the worked example's
 * TypeScript sources compile against the published platform types.
 *
 * `test/fixtures/installed-packages/mod-acme-erp/src/` is what the developer page
 * reproduces, so a declaration API change that breaks the example breaks this
 * test rather than the documentation silently. Its compiled twin under `lib/` is
 * what the integration tests install.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, '..', '..', 'fixtures', 'installed-packages', 'mod-acme-erp');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

describe('the mod-acme-erp worked example', () => {
  it('type-checks with tsc --noEmit', () => {
    const run = spawnSync(process.execPath, [tsc, '--noEmit', '-p', join(fixture, 'tsconfig.json')], {
      encoding: 'utf8',
    });
    expect(`${run.stdout}${run.stderr}`).toBe('');
    expect(run.status).toBe(0);
  }, 120_000);
});

/**
 * The compiled fixture, installed: discovery reads its declaration, and since
 * Phase B rolled out `organizations` (FR-011) the migration merge accepts it and
 * places the generated step at the head of `acme_erp`'s block — after the host,
 * before the module's own back-fill (FR-020, OD-178-1).
 */
describe('the installed mod-acme-erp', () => {
  const scratch = join(here, '..', '..', '.installed-package-instances');
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('is read by discovery and merged with its generated step at the head of its block', async () => {
    mkdirSync(scratch, { recursive: true });
    root = mkdtempSync(join(scratch, 'instance-'));
    const destination = join(root, 'node_modules', '@acme', 'mod-acme-erp');
    mkdirSync(destination, { recursive: true });
    cpSync(fixture, destination, { recursive: true });
    const roots = [join(root, 'node_modules')];

    const [contribution] = await packageSchemaContributionsUnder(roots);
    expect(contribution?.id).toBe('acme_erp');
    expect(contribution?.schemaExtensions.map((declaration) => declaration.id)).toEqual(['acme_erp:organizations']);

    const merged = configuredMigrationsFrom({
      coreEntries: [],
      coreModuleDependencies: new Map([['core', []], ['organizations', []]]),
      packages: [contribution!],
    });
    expect(merged.names).toHaveLength(2);
    expect(merged.names[0]).toMatch(/^Migration10000101T000000AcmeErpSchemaExtensions[0-9a-f]{12}$/);
    expect(merged.names[1]).toBe('Migration20261201T090000AcmeErpBackfillCreditTier');
  });
});

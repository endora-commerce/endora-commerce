import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * W1's second gate: a composition root naming the leaving module's camelCase id
 * (`specs/134-paid-module-extraction/` research D16 §5, contract W1.1, T125).
 *
 * The specifier gate beside it asks whether a free package *imports* the
 * module. It cannot see a root that registers, contributes or reads a value
 * named after the module — `composeApp` carried six such values for a year,
 * and `backend/src/composition.ts` contributed `ksef`'s verification resolver
 * to `invoices`, with every import clean.
 *
 * The library is spawned rather than reimplemented, in `schedule-kind.test.ts`'
 * idiom: it is shell because its caller is shell. It runs against a fixture
 * repository rather than this one, because the tree it was measured on
 * (`ce96b1e94`, where it refuses `pim_akeneo`, `pim_ergonode`, `pim_pimcore`,
 * `pim_unopim`, `comarch_xl` and `ksef` and nothing else) is not guaranteed to
 * exist in a shallow CI clone, and the tree at the tip carries none of them.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LIB = join(REPO_ROOT, 'scripts/lib/w1-root-names.sh');

let fixture = '';

function write(relative: string, content: string): void {
  const full = join(fixture, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function git(...args: string[]): void {
  const result = spawnSync('git', args, { cwd: fixture, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

interface Run {
  readonly status: number | null;
  readonly stdout: string;
}

/** Sources the real library in the fixture repository, as the extraction script does. */
function run(snippet: string): Run {
  const result = spawnSync('bash', ['-c', `set -euo pipefail\n. "${LIB}"\n${snippet}`], {
    cwd: fixture,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '' },
  });
  return { status: result.status, stdout: result.stdout ?? '' };
}

function hits(moduleId: string): string[] {
  const result = run(`w1_root_name_hits '${moduleId}'`);
  expect(result.status).toBe(0);
  return result.stdout.split('\n').filter((line) => line.length > 0);
}

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 't124-w1-root-names-'));
  git('init', '-q');
  write(
    'packages/platform/src/composition/compose-app.ts',
    [
      'registerValues(container, {',
      '  processRunsWorkers: runWorkers,',
      '  acmePimRunWorkers: runWorkers,',
      '  // fabrikamErpRunWorkers used to be registered here, as prose it stays.',
      '  /** @deprecated northwindRunWorkers, prose too. */',
      '});',
      '',
    ].join('\n'),
  );
  write(
    'backend/src/composition.ts',
    [
      'composedModules.contribute({',
      '  invoicePdfResolver: () => reads().taxlink.handle.buildVerification,',
      '});',
      '',
    ].join('\n'),
  );
  // A root's own test file is not a root.
  write(
    'packages/platform/src/composition/compose-app.test.ts',
    'expect(values.contosoRunWorkers).toBe(false);\n',
  );
  // Outside the two roots, a module's prefix on a free package's field is not
  // coupling (FR-024: `ksef`'s `ksefReferenceNumber` is the measured case).
  write(
    'packages/modules/invoices/src/backend/entities/invoice.ts',
    'export class Invoice { taxlinkReferenceNumber?: string; ledgerlyId: string = ""; }\n',
  );
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fixture');
});

afterAll(() => {
  if (fixture !== '') rmSync(fixture, { recursive: true, force: true });
});

describe('camel_id_of', () => {
  it('derives the camelCase id a root would spell a value with', () => {
    const result = run(
      'for id in acme_pim fabrikam_erp taxlink north_wind_parcel; do camel_id_of "$id"; echo; done',
    );
    expect(result.stdout.split('\n').filter(Boolean)).toEqual([
      'acmePim',
      'fabrikamErp',
      'taxlink',
      'northWindParcel',
    ]);
  });
});

describe('w1_root_name_hits', () => {
  it('reports a root registering a value named after the module', () => {
    expect(hits('acme_pim')).toEqual([
      'packages/platform/src/composition/compose-app.ts:3:  acmePimRunWorkers: runWorkers,',
    ]);
  });

  it('reports a root reading a member named after the module', () => {
    expect(hits('taxlink')).toEqual([
      'backend/src/composition.ts:2:  invoicePdfResolver: () => reads().taxlink.handle.buildVerification,',
    ]);
  });

  it('leaves a comment naming the module alone, as prose', () => {
    expect(hits('fabrikam_erp')).toEqual([]);
    expect(hits('northwind')).toEqual([]);
  });

  it('does not read a root’s own tests', () => {
    expect(hits('contoso')).toEqual([]);
  });

  it('is scoped to the two roots, so a free package’s FR-024 field is not coupling', () => {
    expect(hits('ledgerly')).toEqual([]);
  });

  it('answers nothing for a module no root names', () => {
    expect(hits('tailspin')).toEqual([]);
  });

  it('reads a named revision when given one, not the working tree', () => {
    write(
      'packages/platform/src/composition/compose-app.ts',
      'registerValues(container, { processRunsWorkers: runWorkers });\n',
    );
    try {
      expect(hits('acme_pim')).toEqual([]);
      const atHead = run(`w1_root_name_hits acme_pim HEAD`);
      expect(atHead.stdout.trim()).toBe(
        'HEAD:packages/platform/src/composition/compose-app.ts:3:  acmePimRunWorkers: runWorkers,',
      );
    } finally {
      git('checkout', '-q', '--', '.');
    }
  });
});

/**
 * The overlay boundary analysis (`specs/190-overlay-full-modules/` FR-070, FR-071;
 * `contracts/overlay-ports.md` §2, §6).
 *
 * One sanctioned shape between two overlay modules — a type-only import of the
 * sibling's `ports.ts`, in the same deployment, from a module that declares the
 * sibling in its manifest `dependencies` — and each failed clause its own red case.
 * Every proof enters with source text and a path, the way both readers hand the
 * analysis a tree (issue #130): a proof handed a resolved pair would stay green
 * over a resolver that stopped resolving.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzeOverlayBoundary,
  describeOverlayBoundaryFinding,
  overlayBoundaryInputUnder,
  readManifestDependencies,
  type OverlayBoundaryClause,
} from './overlay-boundary.js';

const OWNER = 'apps/acme/modules/acme_loyalty';
const CONSUMER = 'apps/acme/modules/acme_reports';
const CONSUMER_FILE = `${CONSUMER}/backend.ts`;

/** The analysis over one consumer source, with the consumer declaring `declared`. */
function analyse(
  source: string,
  options: {
    readonly file?: string;
    readonly declared?: readonly string[] | null;
    readonly extra?: ReadonlyArray<readonly [string, string]>;
    readonly dependencies?: ReadonlyArray<readonly [string, readonly string[] | null]>;
  } = {},
) {
  const file = options.file ?? CONSUMER_FILE;
  return analyzeOverlayBoundary({
    sources: new Map<string, string>([
      [file, source],
      [`${OWNER}/ports.ts`, 'export interface LoyaltyReadPort { points(id: string): number }\n'],
      ...(options.extra ?? []),
    ]),
    dependencies: new Map<string, readonly string[] | null>([
      [OWNER, ['settings']],
      [CONSUMER, options.declared === undefined ? ['acme_loyalty'] : options.declared],
      ...(options.dependencies ?? []),
    ]),
  });
}

function failedClauses(source: string, options?: Parameters<typeof analyse>[1]): OverlayBoundaryClause[] {
  const { findings } = analyse(source, options);
  expect(findings).toHaveLength(1);
  return [...findings[0]!.failed];
}

describe('the sanctioned import (FR-070)', () => {
  it('`import type` of the sibling’s ports.ts passes, and is counted as sanctioned', () => {
    const result = analyse(
      "import type { LoyaltyReadPort } from '../acme_loyalty/ports.js';\n",
    );
    expect(result.findings).toEqual([]);
    expect(result.sanctioned).toHaveLength(1);
    expect(result.sanctioned[0]).toMatchObject({
      file: CONSUMER_FILE,
      line: 1,
      importer: 'acme_reports',
      target: 'acme_loyalty',
      importerDeployment: 'acme',
      targetDeployment: 'acme',
    });
  });

  it('every specifier `type`-qualified is type-only too', () => {
    const result = analyse(
      "import { type LoyaltyReadPort, type Other } from '../acme_loyalty/ports.js';\n",
    );
    expect(result.findings).toEqual([]);
    expect(result.sanctioned).toHaveLength(1);
  });

  it('`ports.ts` and an extensionless specifier name the same file', () => {
    for (const specifier of ['../acme_loyalty/ports.ts', '../acme_loyalty/ports']) {
      const result = analyse(`import type { LoyaltyReadPort } from '${specifier}';\n`);
      expect(result.findings, specifier).toEqual([]);
    }
  });

  it('resolves from any depth of the importer', () => {
    const result = analyse(
      "import type { LoyaltyReadPort } from '../../acme_loyalty/ports.js';\n",
      { file: `${CONSUMER}/services/report.ts` },
    );
    expect(result.findings).toEqual([]);
    expect(result.sanctioned).toHaveLength(1);
  });

  it('a transitive dependency satisfies clause 4', () => {
    const result = analyse(
      "import type { LoyaltyReadPort } from '../acme_loyalty/ports.js';\n",
      {
        declared: ['acme_middle'],
        dependencies: [['apps/acme/modules/acme_middle', ['acme_loyalty']]],
      },
    );
    expect(result.findings).toEqual([]);
  });

  it('an import inside the module itself, or out to core or a package, is not this analysis’ edge', () => {
    const result = analyse(
      [
        "import type { X } from './ports.js';",
        "import { y } from './services/y.js';",
        "import type { ModuleContext } from '@endora-commerce/platform/kernel';",
        "import { z } from '../../../../modules/catalog/backend.js';",
        '',
      ].join('\n'),
    );
    expect(result.findings).toEqual([]);
    expect(result.sanctioned).toEqual([]);
    expect(result.examined).toBe(4);
  });
});

describe('every other import between overlay modules is a finding naming the failed clause (FR-071)', () => {
  it('a value import fails `type-only`', () => {
    expect(failedClauses("import { LoyaltyReadPort } from '../acme_loyalty/ports.js';\n")).toEqual([
      'type-only',
    ]);
  });

  it('a mixed import (one binding typed, one not) fails `type-only`', () => {
    expect(
      failedClauses("import { type LoyaltyReadPort, DEFAULT } from '../acme_loyalty/ports.js';\n"),
    ).toEqual(['type-only']);
  });

  it('a re-export, a side-effect import and a dynamic import fail `type-only`', () => {
    for (const source of [
      "export type { LoyaltyReadPort } from '../acme_loyalty/ports.js';\n",
      "import '../acme_loyalty/ports.js';\n",
      "export async function f() { return import('../acme_loyalty/ports.js'); }\n",
    ]) {
      expect(failedClauses(source), source).toEqual(['type-only']);
    }
  });

  it('another file of the sibling fails `ports-file`', () => {
    expect(
      failedClauses("import type { Points } from '../acme_loyalty/services/points.js';\n"),
    ).toEqual(['ports-file']);
  });

  it('a `ports/` directory is not the `ports.ts` file', () => {
    expect(
      failedClauses("import type { Points } from '../acme_loyalty/ports/index.js';\n"),
    ).toEqual(['ports-file']);
  });

  it('another deployment’s module fails `same-deployment`', () => {
    const file = 'apps/other/modules/other_reports/backend.ts';
    const { findings } = analyse(
      "import type { LoyaltyReadPort } from '../../../acme/modules/acme_loyalty/ports.js';\n",
      {
        file,
        dependencies: [['apps/other/modules/other_reports', ['acme_loyalty']]],
      },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.failed).toEqual(['same-deployment']);
    expect(findings[0]).toMatchObject({
      importer: 'other_reports',
      importerDeployment: 'other',
      target: 'acme_loyalty',
      targetDeployment: 'acme',
    });
  });

  it('a sibling the manifest does not declare fails `declared-dependency`', () => {
    expect(
      failedClauses("import type { LoyaltyReadPort } from '../acme_loyalty/ports.js';\n", {
        declared: ['settings'],
      }),
    ).toEqual(['declared-dependency']);
  });

  it('a manifest whose `dependencies` could not be read declares nothing — fail closed', () => {
    expect(
      failedClauses("import type { LoyaltyReadPort } from '../acme_loyalty/ports.js';\n", {
        declared: null,
      }),
    ).toEqual(['declared-dependency']);
  });

  it('an importer with no manifest entry at all declares nothing either', () => {
    const { findings } = analyzeOverlayBoundary({
      sources: new Map([
        [CONSUMER_FILE, "import type { LoyaltyReadPort } from '../acme_loyalty/ports.js';\n"],
      ]),
      dependencies: new Map(),
    });
    expect(findings.map((finding) => [...finding.failed])).toEqual([['declared-dependency']]);
  });

  it('several clauses failing are all named', () => {
    expect(
      failedClauses("import { points } from '../acme_loyalty/services/points.js';\n", {
        declared: [],
      }),
    ).toEqual(['type-only', 'ports-file', 'declared-dependency']);
  });

  it('the description names importer, target, file and each failed clause', () => {
    const { findings } = analyse("import { points } from '../acme_loyalty/services/points.js';\n", {
      declared: [],
    });
    const text = describeOverlayBoundaryFinding(findings[0]!);
    expect(text).toContain(`${CONSUMER_FILE}:1`);
    expect(text).toContain('acme_reports');
    expect(text).toContain('acme_loyalty');
    expect(text).toContain('[type-only]');
    expect(text).toContain('[ports-file]');
    expect(text).toContain('[declared-dependency]');
    expect(text).not.toContain('[same-deployment]');
  });
});

describe('readManifestDependencies — the literal a manifest declares', () => {
  it('reads the `dependencies` array of `defineModuleManifest({ … })`', () => {
    expect(
      readManifestDependencies(
        "export const manifest = defineModuleManifest({ id: 'a', dependencies: ['b', \"c\"] });\n",
        'manifest.ts',
      ),
    ).toEqual(['b', 'c']);
  });

  it('reads a plain object manifest too', () => {
    expect(
      readManifestDependencies("export const manifest = { id: 'a', dependencies: [] };\n", 'm.js'),
    ).toEqual([]);
  });

  it('answers null for a list it cannot read as literals', () => {
    for (const source of [
      'export const manifest = defineModuleManifest({ dependencies: [...BASE] });\n',
      'export const manifest = defineModuleManifest({ dependencies: DEPENDENCIES });\n',
      "export const manifest = defineModuleManifest({ id: 'a' });\n",
      'export const other = 1;\n',
    ]) {
      expect(readManifestDependencies(source, 'manifest.ts'), source).toBeNull();
    }
  });
});

describe('overlayBoundaryInputUnder — the tree, read off disk', () => {
  let root: string | null = null;
  afterEach(() => {
    if (root !== null) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  function write(path: string, content: string): void {
    mkdirSync(dirname(join(root!, path)), { recursive: true });
    writeFileSync(join(root!, path), content);
  }

  it('reads every deployment’s overlay sources and each module’s declared dependencies', () => {
    root = mkdtempSync(join(tmpdir(), 'endora-overlay-boundary-'));
    write(
      `${OWNER}/manifest.ts`,
      "export const manifest = defineModuleManifest({ id: 'acme_loyalty', dependencies: [] });\n",
    );
    write(`${OWNER}/ports.ts`, 'export interface LoyaltyReadPort { points(): number }\n');
    write(
      `${CONSUMER}/manifest.ts`,
      "export const manifest = defineModuleManifest({ id: 'acme_reports', dependencies: ['acme_loyalty'] });\n",
    );
    write(CONSUMER_FILE, "import type { LoyaltyReadPort } from '../acme_loyalty/ports.js';\n");
    write(`${CONSUMER}/i18n/en.json`, '{}\n');
    write('apps/other/modules/x/backend.ts', "import { y } from '../../../acme/modules/acme_loyalty/ports.js';\n");

    const input = overlayBoundaryInputUnder(root);

    expect([...input.sources.keys()].sort()).toEqual([
      `${OWNER}/manifest.ts`,
      `${OWNER}/ports.ts`,
      CONSUMER_FILE,
      `${CONSUMER}/manifest.ts`,
      'apps/other/modules/x/backend.ts',
    ]);
    expect(input.dependencies.get(CONSUMER)).toEqual(['acme_loyalty']);
    expect(input.dependencies.get('apps/other/modules/x')).toBeNull();

    const result = analyzeOverlayBoundary(input);
    expect(result.sanctioned.map((edge) => edge.file)).toEqual([CONSUMER_FILE]);
    expect(result.findings.map((finding) => [finding.file, [...finding.failed]])).toEqual([
      ['apps/other/modules/x/backend.ts', ['type-only', 'same-deployment', 'declared-dependency']],
    ]);
  });

  it('a tree with no `apps/` is the empty input', () => {
    root = mkdtempSync(join(tmpdir(), 'endora-overlay-boundary-'));
    const input = overlayBoundaryInputUnder(root);
    expect(input.sources.size).toBe(0);
    expect(analyzeOverlayBoundary(input).findings).toEqual([]);
  });
});

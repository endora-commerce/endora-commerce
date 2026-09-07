/**
 * `check-test-ownership`'s inputs, built from source text — the top of its
 * analysis.
 *
 * One builder, called by the companion test and by
 * `test/unit/scripts/check-inventory.test.ts`'s red proofs, because a proof and
 * a companion that each build their own would be one population derived twice —
 * the shape !1182 found going stale invisibly.
 *
 * Everything a real run computes enters here as a value: the file's text, which
 * root it was walked from, the npm-name map the layout derives, and the
 * capability set `specs/109-backend-test-kit/` R5.1 widens. Nothing is
 * pre-classified: the fixture never hands in an owner list or a verdict, so the
 * specifier walk, the call-node predicate and the ownership table all run in
 * every proof (issue #130).
 */
import {
  checkTestOwnership,
  type PackageUnderCheck,
  type TestFileUnderCheck,
  type TestOwnershipFinding,
  type TestOwnershipFindingKind,
  type TestOwnershipInput,
  type TestOwnershipLedgerShard,
} from '../../scripts/check-test-ownership.js';

/** A module package, as this repository's layout names it. */
export const MODULE_PACKAGE_NAMES: ReadonlyMap<string, string> = new Map([
  ['@endora-commerce/mod-blog', 'blog'],
  ['@endora-commerce/mod-orders', 'orders'],
  ['@endora-commerce/mod-catalog', 'catalog'],
]);

export interface OwnershipFixture {
  /** Source text by repository-relative path, under `backend/test/`. */
  readonly application?: Readonly<Record<string, string>>;
  /** Source text by repository-relative path, under a module package. */
  readonly packages?: Readonly<Record<string, string>>;
  /** Package manifests and configuration, by module id. */
  readonly manifests?: Readonly<
    Record<string, { readonly testScript?: string | null; readonly vitestConfig?: string | null }>
  >;
  readonly ledger?: readonly TestOwnershipLedgerShard[];
  /**
   * Module packages this fixture's workspace holds, beyond those a manifest or
   * a package test file already implies.
   *
   * A ledger shard's own id is deliberately **not** a source: in a real run the
   * package set is the layout's and the shards are read separately, which is
   * what makes an orphan shard detectable at all. A fixture that derived the
   * packages from the shards could not stage one.
   */
  readonly modules?: readonly string[];
  /** 109 R5.1's capability. Empty unless a proof is driving the flipped cell. */
  readonly serverBoundHosts?: readonly string[];
}

/** The module a package path names — `packages/modules/<id>/…`. */
function moduleOf(path: string): string | null {
  return /(?:^|\/)packages\/modules\/([^/]+)\//.exec(path)?.[1] ?? null;
}

/** The fixture as the check receives it. */
export function ownershipInput(fixture: OwnershipFixture): TestOwnershipInput {
  const files: TestFileUnderCheck[] = [
    ...Object.entries(fixture.application ?? {}).map(
      ([key, text]): TestFileUnderCheck => ({
        key,
        text,
        root: 'application',
        moduleId: null,
      }),
    ),
    ...Object.entries(fixture.packages ?? {}).map(
      ([key, text]): TestFileUnderCheck => ({
        key,
        text,
        root: 'module-package',
        moduleId: moduleOf(key),
      }),
    ),
  ];
  const ids = new Set<string>([
    ...Object.keys(fixture.manifests ?? {}),
    ...files.flatMap((file) => (file.moduleId === null ? [] : [file.moduleId])),
    ...(fixture.modules ?? []),
  ]);
  const packages: PackageUnderCheck[] = [...ids].sort().map((moduleId) => {
    const declared = fixture.manifests?.[moduleId];
    return {
      moduleId,
      key: `packages/modules/${moduleId}`,
      testFiles: files.filter((file) => file.moduleId === moduleId).length,
      testScript: declared?.testScript === undefined ? 'vitest run' : declared.testScript,
      vitestConfig:
        declared?.vitestConfig === undefined
          ? "import baseConfig from '../../../vitest.config.base.js';\nexport default baseConfig;\n"
          : declared.vitestConfig,
    };
  });
  return {
    files,
    packages,
    modulePackageNames: MODULE_PACKAGE_NAMES,
    serverBoundHosts: new Set(fixture.serverBoundHosts ?? []),
    ledger: fixture.ledger ?? [],
  };
}

/** Every finding the fixture produces. */
export function ownershipFindings(fixture: OwnershipFixture): readonly TestOwnershipFinding[] {
  return checkTestOwnership(ownershipInput(fixture)).findings;
}

/**
 * Findings of exactly one kind, so no signal goes blind behind another's red.
 *
 * The whole reason the inventory asks for one proof per shape: a count over all
 * five would let four of them stop working behind the fifth.
 */
export function findingsOfKind(
  fixture: OwnershipFixture,
  kind: TestOwnershipFindingKind,
): number {
  return ownershipFindings(fixture).filter((finding) => finding.kind === kind).length;
}

/** Ledger defects the fixture produces. */
export function ledgerIssues(fixture: OwnershipFixture): readonly string[] {
  return checkTestOwnership(ownershipInput(fixture)).ledgerIssues;
}

/** A `blog` test that names its module and boots nothing — the misplaced shape. */
export const HARNESS_FREE_BLOG_TEST =
  "import { describe, it } from 'vitest';\n" +
  "import { BlogCache } from '@endora-commerce/mod-blog/backend';\n" +
  "describe('blog cache', () => { it('caches', () => { void BlogCache; }); });\n";

/** The same file with the server composer called — the harness-bound shape. */
export const SERVER_BOUND_BLOG_TEST =
  "import { describe, it } from 'vitest';\n" +
  "import { BlogCache } from '@endora-commerce/mod-blog/backend';\n" +
  "import { setupBackendServer } from '../../helpers/test-server.js';\n" +
  "describe('blog', () => { it('boots', async () => { await setupBackendServer(); void BlogCache; }); });\n";

/** A shard the check will accept, so a proof can isolate one ledger defect. */
export function shard(
  moduleId: string,
  entries: Readonly<Record<string, string | { scheduled: true; reason: string; retiredBy: string }>>,
  source = 'export const entries: Readonly<Record<string, TestOwnershipLedgerEntry>> = {};\n',
): TestOwnershipLedgerShard {
  return { moduleId, entries, source };
}

/** A scheduled entry, spelled once. */
export const SCHEDULED = {
  scheduled: true,
  reason: 'fixture',
  retiredBy: 'the fixture',
} as const;

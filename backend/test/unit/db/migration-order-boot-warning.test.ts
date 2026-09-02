import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MANIFEST_INDEX = '../../../src/manifest-index.generated.js';
const ORM_CONFIG = '../../../src/db/mikro-orm.config.js';

type ManifestIndex = typeof import('../../../src/manifest-index.generated.js');

/**
 * The boot-time reader of the `module-cycle` diagnostic — feature 081, the
 * second row of `contracts/ordering-algorithm.md` §6.
 *
 * `orderMigrations` does not throw on a dependency cycle, because the manifest
 * graph is the whole cross-module migration order now and a manifest can arrive
 * from an installed package: throwing would let one stranger's declaration stop
 * a shop's own schema from migrating. So the running platform *says so* and
 * keeps serving, and this file is the proof that it does — and, just as
 * importantly, that it stays quiet when there is nothing to say. Without the
 * second half, a `warn` on every boot would look exactly as green.
 *
 * The fixture enters at the top of the analysis (issue #130): it is the
 * manifest graph the config assembles, not a pre-computed diagnostic. The
 * config really orders the real registry under it.
 */

let warned: string[];

beforeEach(() => {
  warned = [];
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warned.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.doUnmock(MANIFEST_INDEX);
  vi.restoreAllMocks();
  vi.resetModules();
});

function cycleWarnings(): string[] {
  return warned.filter((line) => line.includes('[migration-order]'));
}

describe('the ORM config reports a dependency cycle at boot', () => {
  it('says nothing about the migration order for the committed manifests', async () => {
    await (await import(ORM_CONFIG)).default();

    expect(cycleWarnings()).toEqual([]);
  });

  it('warns, naming both members, when a manifest closes a cycle', async () => {
    // `catalog` already reaches `sales_channels`; the reverse edge closes a
    // cycle through whatever path the real graph uses. One edge added to the
    // real manifest index — everything downstream of it is the production path.
    vi.doMock(MANIFEST_INDEX, async () => {
      const actual = await vi.importActual<ManifestIndex>(MANIFEST_INDEX);
      return {
        ...actual,
        DISCOVERED_MANIFESTS: actual.DISCOVERED_MANIFESTS.map((entry) =>
          entry.id === 'sales_channels'
            ? {
                ...entry,
                manifest: {
                  ...entry.manifest,
                  dependencies: [...entry.manifest.dependencies, 'catalog'],
                },
              }
            : entry,
        ),
      };
    });

    await (await import(ORM_CONFIG)).default();

    const warnings = cycleWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('sales_channels');
    expect(warnings[0]).toContain('catalog');
    expect(warnings[0]).toContain('dependency cycle');
  });

  it('still builds a full migration list while the cycle stands', async () => {
    // The property that makes a warning the right answer rather than a throw:
    // the platform boots, and every migration it knows about is still there to
    // apply.
    vi.doMock(MANIFEST_INDEX, async () => {
      const actual = await vi.importActual<ManifestIndex>(MANIFEST_INDEX);
      return {
        ...actual,
        DISCOVERED_MANIFESTS: actual.DISCOVERED_MANIFESTS.map((entry) =>
          entry.id === 'sales_channels'
            ? {
                ...entry,
                manifest: {
                  ...entry.manifest,
                  dependencies: [...entry.manifest.dependencies, 'catalog'],
                },
              }
            : entry,
        ),
      };
    });

    const cycled = await (await import(ORM_CONFIG)).default();
    vi.doUnmock(MANIFEST_INDEX);
    vi.resetModules();
    const clean = await (await import(ORM_CONFIG)).default();

    const names = (config: { migrations?: { migrationsList?: unknown } }): string[] =>
      ((config.migrations?.migrationsList ?? []) as Array<{ name: string }>).map(
        (migration) => migration.name,
      );

    expect(names(cycled)).toHaveLength(names(clean).length);
    expect(new Set(names(cycled))).toEqual(new Set(names(clean)));
  });
});

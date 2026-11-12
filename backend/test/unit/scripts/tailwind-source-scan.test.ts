import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PROBE_STEM,
  sweepStaleTailwindSourceProbes,
  type TailwindProbeTarget,
} from '../../../../scripts/tailwind-source-scan.js';
import { layerInventoryOf, nodeManifestFs } from '../../../scripts/lib/module-package-manifest.js';

/**
 * Issue #105 — the probes the two frontend Tailwind guards plant inside
 * packages, seen from the side of everything else that reads those packages.
 *
 * Two properties, each with its own reader:
 *
 *  1. a probe a run is still using must not make the backend's module-layout
 *     reader refuse the package, or a backend check running at the same moment
 *     as either frontend suite fails for a reason unrelated to its change;
 *  2. a probe a **killed** run left behind is removed by the next run, and a
 *     probe a run in flight is using is not — `pnpm --filter '!backend' run
 *     test` runs the admin and storefront guards side by side, and both plant
 *     into the same package directories.
 */

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'tailwind-probe-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function touch(path: string, text = "export const tailwindSourceProbe = 'mt-[1px]';\n"): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

describe('a probe beside a module package layer', () => {
  it('does not make the module-layout reader refuse the package', () => {
    const pkg = join(scratch(), 'packages/modules/widgets');
    touch(join(pkg, 'src/manifest.ts'), "export default { id: 'widgets' };\n");
    touch(join(pkg, 'src/admin/index.ts'), 'export {};\n');
    touch(join(pkg, `src/admin/${PROBE_STEM}4242.ts`));
    touch(join(pkg, `src/admin/${PROBE_STEM}4242.tsx`));
    touch(join(pkg, `dist/admin/${PROBE_STEM}4242.js`));

    const inventory = layerInventoryOf(pkg, nodeManifestFs());

    expect(inventory.layers.map((layer) => layer.directory)).toEqual(['admin']);
    expect(inventory.assets).toEqual([]);
    expect(inventory.testFiles).toEqual([]);
  });
});

describe('sweepStaleTailwindSourceProbes', () => {
  const LIVE = 1111;
  const DEAD = 2222;
  const isLive = (pid: number): boolean => pid === LIVE;

  function fixture(): { root: string; targets: readonly TailwindProbeTarget[]; src: string; dist: string } {
    const root = scratch();
    const src = join(root, 'packages/modules/widgets/src/admin');
    const dist = join(root, 'packages/modules/widgets/dist/admin');
    mkdirSync(src, { recursive: true });
    mkdirSync(dist, { recursive: true });
    return {
      root,
      src,
      dist,
      targets: [
        {
          subject: '@fixture/widgets',
          directories: [
            { path: dist, extensions: ['js'], create: false },
            { path: src, extensions: ['ts', 'tsx'], create: true },
          ],
        },
      ],
    };
  }

  it('removes the probes a run that is no longer alive left behind, the control included', () => {
    const { root, targets, src, dist } = fixture();
    touch(join(src, `${PROBE_STEM}${DEAD}.ts`));
    touch(join(src, `${PROBE_STEM}${DEAD}.tsx`));
    touch(join(dist, `${PROBE_STEM}${DEAD}.js`));
    touch(join(root, `${PROBE_STEM}${DEAD}.tsx`));

    const removed = sweepStaleTailwindSourceProbes(root, targets, isLive);

    expect([...removed].sort()).toEqual(
      [
        join(src, `${PROBE_STEM}${DEAD}.ts`),
        join(src, `${PROBE_STEM}${DEAD}.tsx`),
        join(dist, `${PROBE_STEM}${DEAD}.js`),
        join(root, `${PROBE_STEM}${DEAD}.tsx`),
      ].sort(),
    );
    expect(readdirSync(src)).toEqual([]);
    expect(readdirSync(dist)).toEqual([]);
    expect(existsSync(join(root, `${PROBE_STEM}${DEAD}.tsx`))).toBe(false);
  });

  it("leaves a probe a live run is still using — the other frontend's guard", () => {
    const { root, targets, src } = fixture();
    touch(join(src, `${PROBE_STEM}${LIVE}.tsx`));
    touch(join(root, `${PROBE_STEM}${LIVE}.tsx`));

    expect(sweepStaleTailwindSourceProbes(root, targets, isLive)).toEqual([]);
    expect(existsSync(join(src, `${PROBE_STEM}${LIVE}.tsx`))).toBe(true);
    expect(existsSync(join(root, `${PROBE_STEM}${LIVE}.tsx`))).toBe(true);
  });

  it('touches nothing that is not a probe, and creates no directory', () => {
    const { root, targets, src } = fixture();
    touch(join(src, 'index.ts'));
    touch(join(src, `${PROBE_STEM}.tsx`));
    touch(join(src, `not-${PROBE_STEM}${DEAD}.tsx`));
    rmSync(join(root, 'packages/modules/widgets/dist'), { recursive: true });

    expect(sweepStaleTailwindSourceProbes(root, targets, isLive)).toEqual([]);
    expect(readdirSync(src).sort()).toEqual(
      ['index.ts', `${PROBE_STEM}.tsx`, `not-${PROBE_STEM}${DEAD}.tsx`].sort(),
    );
    expect(existsSync(join(root, 'packages/modules/widgets/dist'))).toBe(false);
  });

  it('treats a process that answers the liveness probe as alive by default', () => {
    // The default predicate, measured on the one pid that is certainly alive.
    const { root, targets, src } = fixture();
    touch(join(src, `${PROBE_STEM}${process.pid}.tsx`));

    expect(sweepStaleTailwindSourceProbes(root, targets)).toEqual([]);
    expect(existsSync(join(src, `${PROBE_STEM}${process.pid}.tsx`))).toBe(true);
  });
});

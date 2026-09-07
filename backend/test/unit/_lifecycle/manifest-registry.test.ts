import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import {
  ManifestPathMissingError,
  ModuleIdCollisionError,
  coreManifestEntries,
  resolveManifestEntries,
  type DiscoveredManifestEntry,
  type ManifestSources,
  type OverlayModuleFound,
  type PackageModuleFound,
} from '@endora-commerce/platform/lifecycle';

/**
 * The manifest registry's derivation, at the address the platform publishes it
 * (`specs/115-lifecycle-container-move/` Phase 3, D115-2;
 * `contracts/operator-half.md` §3).
 *
 * ## What this file asks that `registered-manifests.test.ts` cannot
 *
 * That file is the **binding's** proof and stays exactly as it was — which is the
 * evidence for the shape: the derivation moved and its 121 importers, that test
 * among them, changed nothing. But every question it asks it asks through
 * `backend/src/lifecycle/registered-manifests.ts`, so it answers over *this*
 * repository's generated index, this deployment's overlay tree and this
 * checkout's `node_modules`. It cannot tell a derivation that takes its input
 * from a parameter apart from one that reaches for the application's artefact
 * and happens to agree with it.
 *
 * So this file drives `resolveManifestEntries` over three suppliers it builds,
 * from the package specifier an instance would write. A run of it names no
 * generated file, no deployment and no `node_modules` — which is FR-014 stated
 * as something that can fail rather than as a sentence: reintroduce a reach and
 * `packages/platform`'s own `rootDir` refuses the import, and weaken the seam to
 * an ambient read and these cases stop being expressible at all.
 *
 * The synthetic entries are deliberate for the second reason `registered-manifests.test.ts`
 * gives for its own: the real tree has few hooks and one overlay module, so a
 * test reading it could not tell a working three-way merge from one that dropped
 * a source entirely.
 */

const manifestOf = (id: string): ModuleManifest => ({
  id,
  name: id,
  version: '1.0.0',
  dependencies: [],
});

const noop = async (): Promise<void> => {};

const discovered = (id: string, manifestPath: string): DiscoveredManifestEntry => ({
  id,
  manifest: manifestOf(id),
  manifestPath,
});

const overlayFound = (id: string): OverlayModuleFound => ({
  id,
  manifest: manifestOf(id),
  filePath: `/deploy/backend/src/apps/example/modules/${id}/manifest.ts`,
});

const packageFound = (id: string, packageName: string): PackageModuleFound => ({
  id,
  manifest: manifestOf(id),
  filePath: `/instance/node_modules/${packageName}/package.json`,
  packageName,
});

/** Every source empty unless the case fills it — a bare-core instance. */
const sourcesOf = (over: Partial<ManifestSources> = {}): ManifestSources => ({
  core: [],
  overlay: async () => [],
  packages: async () => [],
  ...over,
});

describe('coreManifestEntries — the core registry, over a supplied index', () => {
  it('carries one entry per discovered module, in the order it was given', () => {
    const entries = coreManifestEntries([
      discovered('blog', '/repo/packages/modules/blog/package.json'),
      discovered('cms', '/repo/packages/modules/cms/package.json'),
    ]);

    expect(entries.map((entry) => entry.manifest.id)).toEqual(['blog', 'cms']);
  });

  it("marks every one of them 'core' at the site that constructs it (R3.5)", () => {
    // The field is set where the entry is built and is never read off
    // `filePath`. D-157.6(b)'s path test called a module package `'package'`,
    // which cost it its `module_registrations` row and its activation Setting —
    // so the case gives the entry a path *inside a package directory* and still
    // expects `'core'`, which is the discrimination no containment test can make.
    const [entry] = coreManifestEntries([
      discovered('blog', '/instance/node_modules/@endora-commerce/mod-blog/package.json'),
    ]);

    expect(entry?.origin).toBe('core');
  });

  it('refuses an index entry that carries no location, naming the module', () => {
    // Enters where a real run enters — the discovered array the host passes in.
    // The cast is the point of the case rather than a way round the type: the
    // field is required, so this covers the artefact the type cannot reach, a
    // committed index generated before the field existed or edited by hand.
    const withoutPath = { id: 'blog', manifest: manifestOf('blog') } as DiscoveredManifestEntry;

    expect(() => coreManifestEntries([withoutPath])).toThrow(ManifestPathMissingError);
    expect(() => coreManifestEntries([withoutPath])).toThrow(/blog/);
  });

  it("refuses an empty location, which is the shape `dirname` turns into '.'", () => {
    expect(() => coreManifestEntries([discovered('blog', '')])).toThrow(ManifestPathMissingError);
  });
});

describe('resolveManifestEntries — three suppliers, merged by the platform', () => {
  it('returns the core set unchanged when both discoveries come back empty (FR-008)', async () => {
    // Every developer checkout and every test run is this case, and it is the
    // one that proves the derivation reads nothing of its own: the sources say
    // "no overlay, no packages" and the answer is the array that was handed in,
    // not this repository's 69 modules.
    const core = coreManifestEntries([discovered('blog', '/repo/blog/manifest.ts')]);

    expect(await resolveManifestEntries(sourcesOf({ core }))).toEqual(core);
  });

  it('appends the deployment’s overlay modules, marked at their construction site', async () => {
    const core = coreManifestEntries([discovered('blog', '/repo/blog/manifest.ts')]);
    const resolved = await resolveManifestEntries(
      sourcesOf({ core, overlay: async () => [overlayFound('example_overlay')] }),
    );

    expect(resolved.map((entry) => entry.manifest.id)).toEqual(['blog', 'example_overlay']);
    expect(resolved.map((entry) => entry.origin)).toEqual(['core', 'overlay']);
  });

  it('appends the instance’s installed packages, marked at their construction site', async () => {
    const core = coreManifestEntries([discovered('blog', '/repo/blog/manifest.ts')]);
    const resolved = await resolveManifestEntries(
      sourcesOf({ core, packages: async () => [packageFound('crm', '@acme/mod-crm')] }),
    );

    expect(resolved.map((entry) => entry.manifest.id)).toEqual(['blog', 'crm']);
    expect(resolved.at(-1)?.origin).toBe('package');
    expect(resolved.at(-1)?.filePath).toBe('/instance/node_modules/@acme/mod-crm/package.json');
  });

  it('carries the lifecycle exports a discovery found, and omits the keys it did not', async () => {
    // `exactOptionalPropertyTypes`: `{ installHook: undefined }` is not an absent
    // key, and the lifecycle asks `entry.installHook !== undefined`. Asserted on
    // an overlay module rather than a core one because the overlay branch is a
    // second construction site and would pass a core-only case while dropping
    // every hook a deployment ships.
    const resolved = await resolveManifestEntries(
      sourcesOf({
        overlay: async () => [
          { ...overlayFound('example_overlay'), installHook: noop },
          overlayFound('second_overlay'),
        ],
      }),
    );

    expect(resolved[0]?.installHook).toBe(noop);
    expect(resolved[0] && 'uninstallHook' in resolved[0]).toBe(false);
    expect(resolved[1] && 'installHook' in resolved[1]).toBe(false);
  });

  it('refuses a module id two sources claim, naming every claimant at once (FR-004)', async () => {
    // The collision assembly moved with the merge, and this is why it had to:
    // the claim set no single scan can build is core ∪ overlay ∪ packages, and
    // the message is the operator's whole remedy, so it names all three files
    // rather than the first pair found.
    const core = coreManifestEntries([discovered('blog', '/repo/blog/manifest.ts')]);
    const resolve = resolveManifestEntries(
      sourcesOf({
        core,
        overlay: async () => [overlayFound('blog')],
        packages: async () => [packageFound('blog', '@acme/mod-blog')],
      }),
    );

    await expect(resolve).rejects.toThrow(ModuleIdCollisionError);
    await expect(resolve).rejects.toThrow(/@acme\/mod-blog/);
    await expect(resolve).rejects.toThrow(/apps\/example\/modules\/blog\/manifest\.ts/);
    await expect(resolve).rejects.toThrow(/repo\/blog\/manifest\.ts/);
  });

  it('assembles the claims from the three sources, never from the merged map', async () => {
    // The map is keyed by id, so reading the claim set off it would be asking
    // something that has already resolved the collision whether there was one.
    // Two packages claiming one id is the shape that survives the merge with no
    // trace: `byId.set` twice leaves one entry and one vendor.
    const resolve = resolveManifestEntries(
      sourcesOf({
        packages: async () => [
          packageFound('blog', '@acme/mod-blog'),
          packageFound('blog', '@other/mod-blog'),
        ],
      }),
    );

    await expect(resolve).rejects.toThrow(ModuleIdCollisionError);
    await expect(resolve).rejects.toThrow(/@other\/mod-blog/);
  });

  it('asks each supplier exactly once, and asks both before it refuses anything', async () => {
    // `entries` is resolved once per command (R2.2) and the discoveries read
    // `node_modules` and a deployment tree, so a derivation that called a
    // supplier per entry would turn a registry read into a filesystem walk per
    // module. The second half is what makes the refusal name every claimant: an
    // implementation that refused after the overlay merge would never see the
    // packages' claims.
    let overlayCalls = 0;
    let packageCalls = 0;
    const resolve = resolveManifestEntries({
      core: coreManifestEntries([discovered('blog', '/repo/blog/manifest.ts')]),
      overlay: async () => {
        overlayCalls += 1;
        return [overlayFound('blog')];
      },
      packages: async () => {
        packageCalls += 1;
        return [];
      },
    });

    await expect(resolve).rejects.toThrow(ModuleIdCollisionError);
    expect([overlayCalls, packageCalls]).toEqual([1, 1]);
  });
});

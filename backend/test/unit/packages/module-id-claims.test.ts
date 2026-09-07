import { describe, expect, it } from 'vitest';
import {
  ModuleIdCollisionError,
  assertNoModuleIdCollisions,
  moduleIdCollisions,
  type ModuleIdClaim,
} from '../../../src/packages/module-id-claims.js';

/**
 * T030c / D-155.7 — two installed packages claiming one module id.
 *
 * Nothing refused it before this: `composeModules` had no id-uniqueness
 * assertion and surfaced a `DuplicateRegistrationError` naming the registration
 * key twice and neither vendor; `resolvedManifestEntries` is a `Map` and let
 * the last writer win in silence; `buildStaticRegistry` throws the right
 * refusal on a path a package cannot reach. So two vendors' `blog` packages
 * merged two strangers' migration chains under one module id, and a hard
 * uninstall reverted both.
 *
 * Discovery is the **only** layer that still holds both vendors — by
 * `composeModules` an entry is an id and a function — so the message here is
 * the one that has to name both resolved paths.
 */

const core = (id: string): ModuleIdClaim => ({
  id,
  origin: 'core',
  claimedBy: `/repo/backend/src/modules/${id}/manifest.ts`,
});

const overlay = (id: string): ModuleIdClaim => ({
  id,
  origin: 'overlay',
  claimedBy: `/repo/backend/src/apps/acme/modules/${id}/manifest.ts`,
});

const pkg = (id: string, name: string): ModuleIdClaim => ({
  id,
  origin: 'package',
  name,
  claimedBy: `/instance/node_modules/${name}/package.json`,
});

describe('two packages claiming one module id', () => {
  it('is a collision, and names both resolved package.json paths and the id', () => {
    const collisions = moduleIdCollisions([
      pkg('blog', '@a/mod-blog'),
      pkg('blog', '@b/mod-blog'),
    ]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.id).toBe('blog');
    expect(collisions[0]?.claims.map((c) => c.claimedBy)).toEqual([
      '/instance/node_modules/@a/mod-blog/package.json',
      '/instance/node_modules/@b/mod-blog/package.json',
    ]);

    const error = (() => {
      try {
        assertNoModuleIdCollisions([pkg('blog', '@a/mod-blog'), pkg('blog', '@b/mod-blog')]);
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();

    expect(error).toBeInstanceOf(ModuleIdCollisionError);
    const message = (error as Error).message;
    expect(message).toContain('blog');
    expect(message).toContain('/instance/node_modules/@a/mod-blog/package.json');
    expect(message).toContain('/instance/node_modules/@b/mod-blog/package.json');
  });

  it('is refused rather than resolved by last-writer-wins', () => {
    // The behaviour this replaces: the `Map` in `resolvedManifestEntries` kept
    // whichever package the directory listing happened to yield last, and the
    // container had already composed both.
    expect(() =>
      assertNoModuleIdCollisions([pkg('blog', '@a/mod-blog'), pkg('blog', '@b/mod-blog')]),
    ).toThrow(ModuleIdCollisionError);
  });
});

describe('a package claiming a core module id', () => {
  it('is the same refusal, and not a silent skip', () => {
    // `resolvedManifestEntries`' `continue` is correct for an overlay — a
    // deployment shadowing files it authored — and wrong for a stranger, who
    // has to be told rather than dropped (D-155.7).
    expect(() => assertNoModuleIdCollisions([core('blog'), pkg('blog', '@a/mod-blog')])).toThrow(
      ModuleIdCollisionError,
    );
    expect(() => assertNoModuleIdCollisions([core('blog'), pkg('blog', '@a/mod-blog')])).toThrow(
      /backend[/\\]src[/\\]modules[/\\]blog[/\\]manifest\.ts/,
    );
  });

  it('names the core manifest as the other claimant', () => {
    const collisions = moduleIdCollisions([core('blog'), pkg('blog', '@a/mod-blog')]);
    expect(collisions[0]?.claims.map((c) => c.origin)).toEqual(['core', 'package']);
  });
});

describe('an overlay module claiming a core module id', () => {
  it('is the same refusal (feature 103, FR-004)', () => {
    // It used to be excluded, on the reading that a deployment shadowing a
    // module it authored is what the overlay mechanism is for. D-201 retires
    // file shadowing, so nothing is being shadowed — and the exclusion was
    // never the whole answer anyway: `resolvedManifestEntries` dropped the
    // manifest while `overlayModuleEntriesUnder` composed the module, so the
    // deployment ran a module with no registry row, no permission-catalogue
    // entry and its routes gated on another module's effective state.
    expect(() => assertNoModuleIdCollisions([core('blog'), overlay('blog')])).toThrow(
      ModuleIdCollisionError,
    );
    expect(moduleIdCollisions([core('blog'), overlay('blog')])[0]?.claims.map((c) => c.origin)).toEqual(
      ['core', 'overlay'],
    );
  });

  it('names both files and tells the deployment author to rename, not to uninstall', () => {
    const error = (() => {
      try {
        assertNoModuleIdCollisions([core('blog'), overlay('blog')]);
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();
    const message = (error as Error).message;
    expect(message).toContain('/repo/backend/src/modules/blog/manifest.ts');
    expect(message).toContain('/repo/backend/src/apps/acme/modules/blog/manifest.ts');
    expect(message).toMatch(/id of this deployment's own/);
    // Nobody installed this one, so the package remedy has no business here.
    expect(message).not.toContain('pnpm remove');
  });
});

describe('what it deliberately does not refuse', () => {
  it('accepts distinct ids from any number of packages', () => {
    expect(
      moduleIdCollisions([
        core('blog'),
        overlay('acme_bi'),
        pkg('crm', '@a/mod-crm'),
        pkg('wms', '@b/mod-wms'),
      ]),
    ).toEqual([]);
  });

  it('reports every colliding id, not only the first', () => {
    const collisions = moduleIdCollisions([
      pkg('blog', '@a/mod-blog'),
      pkg('blog', '@b/mod-blog'),
      pkg('crm', '@a/mod-crm'),
      pkg('crm', '@b/mod-crm'),
    ]);
    expect(collisions.map((c) => c.id)).toEqual(['blog', 'crm']);
  });
});

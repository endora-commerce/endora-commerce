import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertDependenciesPresent,
  detectHookExport,
  emitComposer,
  MissingModuleDependencyError,
  orderModules,
  renderComposer,
  renderManifestIndex,
  type ComposerNode,
} from '../../../scripts/generate-composer.js';
import { MODULES } from '../../../src/composition.generated.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The generated composer (feature 072, T046–T049).
 *
 * Two properties are checked here and nothing else is:
 *
 *  1. **The committed artefacts are what the generator produces.** Both files
 *     are committed so a build needs no filesystem walk, which makes "stale
 *     committed file" a real failure mode — and a silent one, because a stale
 *     composer simply composes yesterday's module set. Rendering in-process and
 *     byte-comparing to disk is the same shape `check-overlay-determinism.ts`
 *     already uses, and it works in the CI slim image, which has no git.
 *  2. **The ordering rule is the one the composer documents.** Dependencies
 *     first, the pinned exception ahead of everything, overlay modules last, and
 *     a cycle reported rather than silently linearised.
 */

describe('T046 — the committed artefacts match the generator', () => {
  it('composition.generated.ts is up to date', async () => {
    const { outputPath, content } = await renderComposer();
    expect(
      readFileSync(outputPath, 'utf8'),
      'stale — run `pnpm --filter backend run composer:generate`',
    ).toBe(content);
  });

  it('manifest-index.generated.ts is up to date', () => {
    const { outputPath, content } = renderManifestIndex();
    expect(
      readFileSync(outputPath, 'utf8'),
      'stale — run `pnpm --filter backend run composer:generate`',
    ).toBe(content);
  });

  it('renders byte-identically on a second call', async () => {
    const first = await renderComposer();
    const second = await renderComposer();
    expect(second.content).toBe(first.content);
    expect(renderManifestIndex().content).toBe(renderManifestIndex().content);
  });
});

/**
 * F2 (feature 071) — one manifest registry, not two.
 *
 * `manifest-index.generated.ts` and `registered-manifests.ts` each imported the
 * same manifest of every module, and two generated files refreshed by two
 * different commands drift: deleting a module directory regenerated one and
 * left the other importing a path that no longer existed. The index is now the
 * only file that names a manifest; the registry is a derivation of it.
 */
describe('F2 — a single generated manifest registry', () => {
  it('has no second generator to fall out of step with', () => {
    expect(existsSync(new URL('../../../scripts/generate-manifest-index.ts', import.meta.url)))
      .toBe(false);
  });

  it('is the only file that imports a module manifest statically', () => {
    const registry = readFileSync(
      new URL('../../../src/modules/_lifecycle/registered-manifests.ts', import.meta.url),
      'utf8',
    );
    expect(registry).not.toMatch(/from '\.\.\/[a-z_]+\/manifest\.js'/);
    expect(renderManifestIndex().content).toMatch(/from '\.\.\/blog\/manifest\.js'/);
  });

  it('carries the install hooks the registry used to import a second time', () => {
    const hooked = REGISTERED_MANIFESTS.filter(
      (entry) => entry.installHook !== undefined || entry.uninstallHook !== undefined,
    );
    // The hooks the tree actually ships, whichever modules they are: the point
    // is that the derivation carries them, not which module has one today.
    expect(hooked.length).toBeGreaterThan(0);
    for (const entry of hooked) {
      const source = readFileSync(entry.filePath, 'utf8');
      if (entry.installHook) expect(source).toMatch(/\binstallHook\b/);
      if (entry.uninstallHook) expect(source).toMatch(/\buninstallHook\b/);
    }
  });

  it('registers exactly the core modules the index discovered', () => {
    expect(REGISTERED_MANIFESTS.map((entry) => entry.manifest.id)).toEqual(
      DISCOVERED_MANIFESTS.filter((entry) => entry.overlay !== true).map((entry) => entry.id),
    );
  });

  it('gives every entry a filePath that exists on disk', () => {
    for (const entry of REGISTERED_MANIFESTS) {
      expect(entry.filePath.startsWith(BACKEND_ROOT), entry.filePath).toBe(true);
      expect(existsSync(entry.filePath), entry.filePath).toBe(true);
    }
  });
});

describe('T047 — the emitted list', () => {
  it('names every module exactly once', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries only modules that own a registered manifest, with its version', () => {
    const byId = new Map(REGISTERED_MANIFESTS.map((e) => [e.manifest.id, e.manifest]));
    for (const entry of MODULES) {
      const manifest = byId.get(entry.id);
      expect(manifest, `${entry.id} has no registered manifest`).toBeDefined();
      expect(entry.version).toBe(manifest?.version);
      expect(typeof entry.registerModule).toBe('function');
    }
  });

  it('holds wave 0 and the modules converted since', () => {
    // The list grows with every conversion; what it may never do is lose one.
    expect(MODULES.map((m) => m.id)).toEqual(
      expect.arrayContaining(['blog', 'email', 'health_checks']),
    );
  });
});

describe('T047 — ordering', () => {
  const node = (id: string, dependencies: string[], overlay = false): ComposerNode => ({
    id,
    dependencies,
    isOverlay: overlay,
    backendImportPath: `./modules/${id}/backend.js`,
    manifestImportPath: `./modules/${id}/manifest.js`,
  });

  it('places a dependency before its dependent', () => {
    const ordered = orderModules([node('zeta', []), node('alpha', ['zeta'])]);
    expect(ordered.map((n) => n.id)).toEqual(['zeta', 'alpha']);
  });

  it('breaks ties alphabetically, so the output is deterministic', () => {
    const ordered = orderModules([node('c', []), node('a', []), node('b', [])]);
    expect(ordered.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores a dependency on a module that is not in the list', () => {
    // A dependency on a module absent from the list — an overlay module, or a
    // name no manifest claims — constrains nothing about this list's order.
    const ordered = orderModules([node('blog', ['dictionaries', 'assets_library'])]);
    expect(ordered.map((n) => n.id)).toEqual(['blog']);
  });

  it('puts the pinned exception first even though nothing declares it', () => {
    const ordered = orderModules([node('auth', []), node('api_keys', [])]);
    expect(ordered.map((n) => n.id)).toEqual(['api_keys', 'auth']);
  });

  it('puts overlay modules last so their decorations win', () => {
    const ordered = orderModules([node('acme_bi', [], true), node('zeta', [])]);
    expect(ordered.map((n) => n.id)).toEqual(['zeta', 'acme_bi']);
  });

  it('reports a dependency cycle naming the modules, rather than linearising it', () => {
    expect(() => orderModules([node('a', ['b']), node('b', ['a'])])).toThrow(/cycle.*a.*b|a.*b.*cycle/s);
  });
});

describe('issue #203 — a module entry says whether it is the deployment\'s', () => {
  const node = (id: string, overlay: boolean): ComposerNode => ({
    id,
    dependencies: [],
    isOverlay: overlay,
    backendImportPath: overlay
      ? `./apps/acme/modules/${id}/backend.js`
      : `./modules/${id}/backend.js`,
    manifestImportPath: overlay
      ? `./apps/acme/modules/${id}/manifest.js`
      : `./modules/${id}/manifest.js`,
  });

  /**
   * `ctx.di.decorate` refuses a module wrapping a registration it does not own,
   * and exempts a deployment's overlay module — the sanctioned per-deployment
   * customisation seam. The exemption reaches the kernel as `overlay: true` on
   * the composed entry, and it is derived here, from the root the module was
   * discovered under. If the emitter dropped it, the guard would be a flat
   * refusal that breaks every overlay deployment, and no test that *sets* the
   * flag by hand could notice.
   */
  it('emits `overlay: true` for a module discovered under a deployment root', () => {
    const content = emitComposer([node('price_lists', false), node('acme_pricing', true)]);
    expect(content).toContain("{ id: 'acme_pricing', version: manifest1.version, overlay: true,");
  });

  it('emits no overlay marker for a core module, so core cannot claim the exemption', () => {
    const content = emitComposer([node('price_lists', false)]);
    expect(content).toContain(
      "{ id: 'price_lists', version: manifest0.version, registerModule: module0.registerModule },",
    );
    // The entries, not the header — which explains the marker and would match
    // a substring search whether or not the emitter ever writes one.
    const entries = content.slice(content.indexOf('export const MODULES'));
    expect(entries).not.toContain('overlay');
  });
});

describe('T056 — a removed module still named as a dependency fails generation', () => {
  const module = (id: string, dependencies: string[] = []): { id: string; dependencies: string[] } => ({
    id,
    dependencies,
  });

  it('accepts a tree where every declared dependency is present', () => {
    expect(() =>
      assertDependenciesPresent([module('blog', ['cms']), module('cms', []), module('email')]),
    ).not.toThrow();
  });

  it('fails naming the missing dependency and every module that still declares it', () => {
    let thrown: unknown;
    try {
      assertDependenciesPresent([
        module('blog', ['loyalty', 'cms']),
        module('orders', ['loyalty']),
        module('cms'),
      ]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(MissingModuleDependencyError);
    const message = (thrown as Error).message;
    // The fix belongs in the dependents, so the dependents are what it names.
    expect(message).toContain("'loyalty'");
    expect(message).toContain('blog');
    expect(message).toContain('orders');
    expect(message).not.toContain("'cms'");
  });

  it('reports every missing dependency at once, deterministically ordered', () => {
    const error = new MissingModuleDependencyError(
      new Map([
        ['zeta', ['b', 'a']],
        ['alpha', ['c']],
      ]),
    );
    expect(error.message.indexOf("'alpha'")).toBeLessThan(error.message.indexOf("'zeta'"));
    expect(error.message).toContain('a, b');
  });

  it('the real tree declares no dependency on a module that is not there', async () => {
    // `renderComposer` runs the check before it emits anything, so this is the
    // same failure a build would hit.
    await expect(renderComposer()).resolves.toBeDefined();
  });
});

/**
 * The manifest install seam is the only one there is (D-46 deleted the
 * container-side `ctx.onInstall`), so a hook the generator cannot see is a hook
 * that never runs — and it looks exactly like a hook with nothing to do.
 */
describe('the install-hook detector', () => {
  const constDeclared = `export const manifest = defineModuleManifest({});
export const installHook = async () => {};`;

  const functionDeclared = `export const manifest = defineModuleManifest({});
export async function uninstallHook(ctx) { return ctx; }`;

  it('sees a hook declared as a const', () => {
    expect(detectHookExport('installHook', constDeclared, 'demo')).toBe(true);
  });

  it('sees a hook declared as a function — the spelling it used to drop silently', () => {
    expect(detectHookExport('uninstallHook', functionDeclared, 'demo')).toBe(true);
  });

  it('sees a plain function declaration too, not only an async one', () => {
    const source = 'export function installHook(ctx) { return ctx; }';
    expect(detectHookExport('installHook', source, 'demo')).toBe(true);
  });

  it('answers false when the module declares no such hook', () => {
    expect(detectHookExport('installHook', functionDeclared, 'demo')).toBe(false);
  });

  it('throws rather than dropping an export it cannot wire', () => {
    const reExported = `const installHook = async () => {};
export { installHook };`;
    expect(() => detectHookExport('installHook', reExported, 'demo')).toThrow(
      /cannot wire[\s\S]*would never run/,
    );
  });

  it('names the module and both admissible spellings, so the message is actionable', () => {
    expect(() => detectHookExport('uninstallHook', 'export { uninstallHook };', 'payments')).toThrow(
      /payments\/manifest\.ts[\s\S]*export const uninstallHook[\s\S]*export async function uninstallHook/,
    );
  });
});

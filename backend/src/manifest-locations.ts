// Where a registered module's manifest actually is (feature 080, T041a).
//
// `registered-manifests.ts` used to answer this by **convention**:
//
//     const MODULES_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
//     const pathFor = (id: string) => join(MODULES_ROOT, id, 'manifest.ts');
//
// — a path computed from a rule rather than read from anywhere, and one that
// nothing verified. Every downstream consumer takes `dirname` of it and joins a
// directory to the result: the i18n boot reconciler joins `bundlesDir` to find
// `i18n/<lang>.json`, and the lifecycle orchestrator hands the same directory to
// the install-time bundle load. So the day the convention stops holding — which
// is the day the first module becomes a package under `packages/modules/<id>/`
// (D-141) — the answer is a directory that does not exist, the `_i18n`
// reconciler **logs and skips** a bundle it cannot read, and every screen that
// module owns renders raw i18n keys. Nothing throws and nothing is reported;
// the symptom looks like a translation bug three layers away from its cause.
//
// The repair is that the **generator** answers it. It walked the tree, so it
// knows where each manifest is, and it already emits the import specifier that
// reaches it. `manifest-index.generated.ts` therefore calls
// {@link resolveManifestPath} once per entry, with its **own** `import.meta.url`
// and the specifier it imported the manifest through — which means the answer
// follows the index wherever it is loaded from (`backend/src` under `tsx` and
// `vitest`, `backend/dist` in production) and wherever the index itself moves to
// (D-160.3 makes it host-owned under `backend/src/`), because both are read off
// the running file rather than written down.
//
// And it **refuses** rather than guessing. A specifier that reaches no file on
// disk is a registry entry pointing at nothing, which is exactly the state the
// convention degraded into silently; here it is a throw at the first import of
// the index, naming the module, the specifier and both candidates tried.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Raised when a registered module's manifest cannot be located on disk. */
export class ModuleManifestPathUnresolvableError extends Error {
  override readonly name = 'ModuleManifestPathUnresolvableError';
}

/**
 * Does this package claim to *be* a module, in its own `endora` block?
 *
 * The question decides which file a bare specifier's answer anchors on, and it
 * is asked of the artefact rather than of the specifier's shape deliberately —
 * see {@link resolveManifestPath}. A package that says nothing, or that cannot
 * be read, is not a module package; that is the direction that keeps the answer
 * a real directory rather than a package root that holds no bundles.
 */
function claimsToBeAModule(packageJsonPath: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (typeof manifest !== 'object' || manifest === null) return false;
    const endora = (manifest as Record<string, unknown>)['endora'];
    if (typeof endora !== 'object' || endora === null) return false;
    return (endora as Record<string, unknown>)['type'] === 'module';
  } catch {
    return false;
  }
}

/**
 * The real path of the file a manifest specifier names.
 *
 * Two specifier shapes, because the generated index emits two (D-149):
 *
 *   * a **relative** one (`../blog/manifest.js`) for a module in the
 *     application's own tree. It is written with the `.js` extension every ESM
 *     specifier in this repository uses, so the file it names is `manifest.js`
 *     in a `dist` run and `manifest.ts` under `tsx`/`vitest` — both are tried,
 *     in that order, because the compiled tree is the one where an extension
 *     swap would be wrong.
 *   * a **bare** one (`@endora-commerce/mod-blog`) for a module that lives in a
 *     workspace package. Its `package.json` is the file that claims the module
 *     id, so that is the path returned — the same anchor
 *     `installed-packages.ts` uses for a package discovered at runtime, which
 *     keeps `dirname(filePath)` meaning "the module's own directory" for all
 *     three origins. It is resolved through Node's own resolver from the
 *     index's location, so it honours the package's `exports` map (R1 makes
 *     `"./package.json"` mandatory for exactly this reason).
 *
 * **The bare shape has two answers, and the second is not a special case for
 * one module** (`specs/115-lifecycle-container-move/`, Phase 6). Everything
 * downstream takes `dirname` of this path and joins a directory to it —
 * `i18n.bundlesDir`, `docs.dir` — so what is actually being asked for is *the
 * module's own directory*. The package root is that directory only when **the
 * package is the module**, which is what a module package's
 * `endora: { type: 'module', id }` says and what a package holding a module
 * among other things does not. `@endora-commerce/platform` is the second kind:
 * it declares `endora.type: "platform"`, holds `_lifecycle` at
 * `dist/lifecycle/`, and its own root holds no `i18n/` at all. Anchoring on its
 * `package.json` would make the boot reconciler join `i18n` to a directory that
 * has none — and it *logs and skips* an absent bundles directory, so
 * `_lifecycle` would serve raw keys with nothing thrown and nothing reported.
 * That is the exact failure this file was written to end, arriving through the
 * repair for it.
 *
 * So a bare specifier whose package makes no module claim is resolved **as
 * written** — `@endora-commerce/platform/lifecycle` through the `exports` map to
 * `dist/lifecycle/index.js`, whose `dirname` is the module's directory. The
 * discriminator is the package's own declaration, the same statement the runtime
 * package discovery reads, and never the presence of a subpath: a module package
 * that declared a narrower subpath over its manifest would otherwise be
 * re-anchored at its build output, silently, in the direction that loses its
 * bundles.
 */
export function resolveManifestPath(indexUrl: string, specifier: string): string {
  if (specifier.startsWith('.')) {
    const compiled = fileURLToPath(new URL(specifier, indexUrl));
    if (existsSync(compiled)) return compiled;
    const source = compiled.replace(/\.js$/, '.ts');
    if (existsSync(source)) return source;
    throw new ModuleManifestPathUnresolvableError(
      `[manifest-index] '${specifier}' names no file on disk — tried ${compiled} and ` +
        `${source}. The generated index carries each module's real location so that ` +
        `dirname() of it is the module's own directory; a specifier that reaches nothing ` +
        `means the tree moved without the artefact being regenerated. Run ` +
        `\`pnpm --filter backend run composer:generate\` and commit the result.`,
    );
  }
  const packageName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]!;
  const require = createRequire(indexUrl);
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`);
  } catch (error: unknown) {
    throw new ModuleManifestPathUnresolvableError(
      `[manifest-index] the package '${packageName}' behind '${specifier}' could not be ` +
        `resolved from ${indexUrl} (${error instanceof Error ? error.message : String(error)}). ` +
        `A packaged module is located through its own package.json, which its exports map ` +
        `must expose as "./package.json"; without a real path its i18n bundles never load ` +
        `and its command-palette entries render as raw keys.`,
    );
  }
  if (claimsToBeAModule(packageJsonPath)) return packageJsonPath;
  try {
    return require.resolve(specifier);
  } catch (error: unknown) {
    throw new ModuleManifestPathUnresolvableError(
      `[manifest-index] '${specifier}' could not be resolved from ${indexUrl} ` +
        `(${error instanceof Error ? error.message : String(error)}). The package ` +
        `'${packageName}' makes no \`endora: { type: 'module' }\` claim, so it holds this ` +
        `module among other things rather than being it, and the module's own directory is ` +
        `the one the specifier's subpath lands in — not the package root, which holds none ` +
        `of its bundles. A subpath its exports map refuses cannot answer that, and ` +
        `answering with the package root instead is how a module comes to serve raw i18n ` +
        `keys with nothing thrown.`,
    );
  }
}

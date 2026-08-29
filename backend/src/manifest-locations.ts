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

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Raised when a registered module's manifest cannot be located on disk. */
export class ModuleManifestPathUnresolvableError extends Error {
  override readonly name = 'ModuleManifestPathUnresolvableError';
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
  try {
    return createRequire(indexUrl).resolve(`${packageName}/package.json`);
  } catch (error: unknown) {
    throw new ModuleManifestPathUnresolvableError(
      `[manifest-index] the package '${packageName}' behind '${specifier}' could not be ` +
        `resolved from ${indexUrl} (${error instanceof Error ? error.message : String(error)}). ` +
        `A packaged module is located through its own package.json, which its exports map ` +
        `must expose as "./package.json"; without a real path its i18n bundles never load ` +
        `and its command-palette entries render as raw keys.`,
    );
  }
}

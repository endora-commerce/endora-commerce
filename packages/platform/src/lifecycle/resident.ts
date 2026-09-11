/**
 * The modules that arrive **with this package** rather than with the tree that
 * installs it (`specs/110-instance-repository/` T141).
 *
 * ## The defect this closes
 *
 * `_lifecycle` is a registered module that is not a package (D-160.11): its
 * sources are this package's, at `lifecycle/`, and the only thing that has ever
 * named it is this repository's own generated manifest index, through the
 * host-internal `@endora-commerce/platform/lifecycle` subpath. An instance ships
 * no generated index — that is what an instance *is* — so it passes `core: []`
 * to {@link resolveManifestEntries} and composes `_lifecycle` nowhere.
 *
 * Measured on the first end-to-end run of `endora new instance` (T140), the boot
 * refuses with `not-shipped: _lifecycle`, needed by `admin_actions`,
 * `credentials`, `_i18n`, `prompt_actions` and `pwa` — every one of them in the
 * default module set the command writes. There is nothing a client could put in
 * their own tree to fix it: the module is ours, and the subpath that reaches it
 * is one `check:platform-surface` gives a module a finding for naming.
 *
 * ## Why the platform contributes it, and why the host still may not be asked
 *
 * It is the same argument `../migrations/index.ts` makes for
 * `BASELINE_MIGRATIONS` and `../db/platform-schema.ts` makes for the twelve
 * migrations and six entities beside it: a datum that arrives by installing this
 * package is this package's to supply, and a client receives a correction to it
 * by `pnpm update`. The host keeps supplying **its** core registry, which is a
 * fact about its own tree (R7.4); this adds what is a fact about ours.
 *
 * ## The `filePath` is this file, and that is not an approximation
 *
 * Every consumer of `filePath` takes `dirname` of it and joins a directory —
 * `i18n.bundlesDir` above all, which the `_i18n` boot reconciler *logs and
 * skips* when it is absent. `dirname` of this file is `lifecycle/`, which is
 * where `i18n/en.json` and `i18n/pl.json` are, in the sources and in the build
 * alike. It is the same directory `resolveManifestPath` answers for
 * `@endora-commerce/platform/lifecycle` — that call resolves the subpath to
 * `lifecycle/index.js` — reached here without a resolver, because a file knows
 * where it is.
 */
import { fileURLToPath } from 'node:url';

import type { RegisteredManifestEntry } from './manifest-registry.js';
import { manifest } from './manifest.js';

/**
 * Every module whose sources are this package's, as manifest entries.
 *
 * A function rather than a constant because `import.meta.url` is read once per
 * call and the array is handed to callers that may sort or splice it; there is
 * nothing here worth memoising.
 *
 * `origin: 'core'` is the truth and it is load-bearing: `deploymentShippedEntries`
 * narrows the first-boot `module_registrations` insert and the boot settings
 * reconcile to entries that are **not** `'package'`, and `_lifecycle` is not an
 * installed package — there is no `module:install` that could converge it, so an
 * instance whose registry never learns about it has no module registry at all.
 */
export function platformResidentManifestEntries(): RegisteredManifestEntry[] {
  return [{ manifest, filePath: fileURLToPath(import.meta.url), origin: 'core' }];
}

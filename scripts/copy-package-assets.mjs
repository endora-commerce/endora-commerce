#!/usr/bin/env node
/**
 * Build step for a module package that ships a non-`.ts` runtime asset —
 * feature 080, criterion 8.
 *
 *     node ../../../scripts/copy-package-assets.mjs --src src --out dist
 *
 * Run from the package directory, as the second half of the `build` script the
 * manifest generator renders. `--src` and `--out` are the package's own
 * `rootDir` and `outDir`, read out of its `tsconfig.build.json` by the
 * generator and rendered into the script — the same derivation that produces
 * the `exports` targets, so the two cannot come to disagree and neither is a
 * path written down (D-100).
 *
 * ## Why the step exists at all
 *
 * `tsc` emits compiled `.ts` and copies nothing else, measured. Until this
 * landed, every one of the 50 module packages built with a bare
 * `tsc -p tsconfig.build.json` and no package in the tree shipped a non-`.ts`,
 * non-i18n file — so the hole was real and unoccupied. `product_feeds` is the
 * first tenant: it reads its four bundled Google/Meta taxonomy files relative to
 * `import.meta.url`, which resolves inside `dist/` in a package.
 *
 * **i18n bundles are not this**, and the difference decides the design. A
 * module package's `i18n/` sits at the **package root**, outside `src/`, and
 * travels in the `files` list; the platform finds it by joining the manifest's
 * `bundlesDir` to `dirname(<package>/package.json)`, an anchor the *platform*
 * supplies. A module that reads its own data supplies its own anchor —
 * `import.meta.url` — and that anchor points at the emitted file. So the asset
 * has to be **beside the emitted code**, which means copied into `outDir`,
 * mirroring `rootDir`. That also keeps the module's source identical whether it
 * lives in `backend/src/modules/<id>/` or in a package: nothing in it names a
 * package, a root, or a build.
 *
 * ## What it refuses, and why here
 *
 * Exit 1 — an extension neither `RUNTIME_ASSET_EXTENSIONS` nor
 * `NON_RUNTIME_EXTENSIONS` names; or an asset that is not in the built tree
 * after the copy.
 *
 * Exit 2 — nothing was read: no source root, no output root (the compile
 * has not run), or **no asset at all**. The last is the one that earns its
 * keep. This step is rendered into a package's `build` only when the generator
 * saw an asset under its `src/`, so a run that finds none is a walk reading a
 * tree it does not think it is reading — issue #215's short walk, one layer
 * down — and the alternative is a `dist` of pure code that every reader
 * downstream reports as a module with no data.
 *
 * The audit belongs **here**, at build time, and not at package load or first
 * read. At build time the source tree has already said the asset exists, so
 * "absent" and "this module ships none" are still two different things; by the
 * first read there is no source tree left to compare against, and the module
 * that would do the comparing is the module that documents absence as a
 * supported operating state.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import {
  auditCopiedAssets,
  collectRuntimeAssets,
  copyRuntimeAssets,
  NON_RUNTIME_EXTENSIONS,
  RUNTIME_ASSET_EXTENSIONS,
} from './lib/runtime-assets.mjs';

const PREFIX = '[package-assets]';

/** `--name value`, or `null` when the flag is absent. */
function flag(argv, name) {
  const at = argv.indexOf(`--${name}`);
  if (at < 0) return null;
  const value = argv[at + 1];
  return value === undefined || value.startsWith('--') ? null : value;
}

function resolveRoot(value) {
  return isAbsolute(value) ? value : join(process.cwd(), value);
}

function main(argv) {
  const src = flag(argv, 'src');
  const out = flag(argv, 'out');
  if (src === null || out === null) {
    process.stderr.write(
      `${PREFIX} usage: node scripts/copy-package-assets.mjs --src <rootDir> --out <outDir>\n` +
        `Both are the package's own emit layout, rendered by ` +
        `\`pnpm --filter backend run manifests:generate\`; this step does not guess them, ` +
        `because a guessed outDir copies a package's data somewhere nothing reads.\n`,
    );
    return 2;
  }

  const srcRoot = resolveRoot(src);
  const outRoot = resolveRoot(out);

  if (!existsSync(srcRoot)) {
    process.stderr.write(`${PREFIX} ${srcRoot} does not exist — nothing to copy from.\n`);
    return 2;
  }
  if (!existsSync(outRoot)) {
    process.stderr.write(
      `${PREFIX} ${outRoot} does not exist. This step runs after the compile; run ` +
        `\`tsc -p tsconfig.build.json\` first (the generated \`build\` script does both).\n`,
    );
    return 2;
  }

  const { assets, fixtures, unclassified, scanned } = collectRuntimeAssets(srcRoot);
  if (unclassified.length > 0) {
    process.stderr.write(
      `${PREFIX} ${unclassified.length} file(s) under ${src}/ have an extension this build ` +
        `has no ruling for. Whoever added them knows whether the module opens one at ` +
        `runtime, and nobody downstream does — an unshipped asset is read as an absent ` +
        `feature, silently. Add the extension to RUNTIME_ASSET_EXTENSIONS (currently ` +
        `${RUNTIME_ASSET_EXTENSIONS.join(', ')}) or to NON_RUNTIME_EXTENSIONS (currently ` +
        `${Object.keys(NON_RUNTIME_EXTENSIONS).join(', ')}) with a reason, in ` +
        `scripts/lib/runtime-assets.mjs:\n`,
    );
    for (const path of unclassified) process.stderr.write(`  ${src}/${path}\n`);
    return 1;
  }
  if (assets.length === 0) {
    process.stderr.write(
      `${PREFIX} no runtime asset found under ${srcRoot}. This step is only rendered into a ` +
        `package's build script when the manifest generator saw one, so finding none means ` +
        `the walk did not read what it thinks it read. Re-run ` +
        `\`pnpm --filter backend run manifests:generate\`: if the module genuinely ships no ` +
        `asset any more, the step comes back out of the build script in the same commit.\n`,
    );
    return 2;
  }

  copyRuntimeAssets(srcRoot, outRoot, assets);

  const missing = auditCopiedAssets(outRoot, assets);
  if (missing.length > 0) {
    process.stderr.write(
      `${PREFIX} ${missing.length} asset(s) are not in the built tree after the copy:\n`,
    );
    for (const path of missing) process.stderr.write(`  ${out}/${path}\n`);
    return 1;
  }

  process.stdout.write(
    `${PREFIX} read: files=${scanned} assets=${assets.length} ` +
      // D-218 — a file that would have shipped and sits beside a test. Named,
      // because a genuine runtime asset parked next to one stops shipping and
      // the author would otherwise meet that as a missing file at runtime.
      `fixtures=${fixtures.length} copied=${assets.length} ${src}/ -> ${out}/\n`,
  );
  for (const path of fixtures) {
    process.stdout.write(
      `${PREFIX} ${src}/${path} is a test's fixture (a test sits beside it) and is not ` +
        `copied. If the module reads it at runtime, move it to a directory holding no test.\n`,
    );
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));

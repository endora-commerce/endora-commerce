#!/usr/bin/env node
/**
 * `blocks:generate` — this storefront discovers the Page Builder renderers it
 * has installed.
 *
 * One walk of this storefront's own `node_modules` (`block-discovery.mjs`), two
 * artefacts: the registry `lib/page-builder/config.ts` composes from, and the
 * stylesheet aggregate `app/globals.css` imports. A discovered module is
 * *registered* and its stylesheet *imported* by the same act, so the two cannot
 * drift, and installing a module's renderers is `pnpm add` and nothing else —
 * no line for anyone to add to a file they edit.
 *
 * It runs at build time (`dev`, `build`) beside `themes:generate`, and never on
 * a request path: the answer cannot change between deploys, and a rendering
 * server may have no `node_modules` tree to walk (`output: 'standalone'`).
 *
 * Exit codes: **0** written; **1** a package cannot be composed (nothing is
 * written); **2** there was no `node_modules` to read — never a green over
 * nothing.
 *
 * `--root <dir>` re-bases the walk and the two outputs onto another tree, which
 * is how the tests drive it.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  analyseBlockPackages,
  discoverBlockPackages,
  renderBlockRegistry,
  renderBlockStylesheet,
} from './block-discovery.mjs';

const INSTANCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? INSTANCE_ROOT : argv[rootFlag + 1];
  const nodeModules = join(root, 'node_modules');

  if (!existsSync(nodeModules)) {
    process.stderr.write(
      `[blocks:generate] ${nodeModules} does not exist, so there is nothing to discover and ` +
        `nothing was written. Install the storefront's dependencies first.\n`,
    );
    process.exit(2);
  }

  const { packages, findings, filesRead } = discoverBlockPackages(nodeModules);
  const refusals = [...findings, ...analyseBlockPackages(packages)];
  if (refusals.length > 0) {
    for (const refusal of refusals) {
      process.stderr.write(`[blocks:generate] ${refusal.finding}: ${refusal.message}\n`);
    }
    process.stderr.write(
      `[blocks:generate] refused: ${refusals.length} package(s) cannot be composed. Nothing was written.\n`,
    );
    process.exit(1);
  }

  writeFileSync(
    join(root, 'lib', 'page-builder', 'blocks.generated.ts'),
    renderBlockRegistry(packages),
    'utf8',
  );
  writeFileSync(join(root, 'app', 'blocks.generated.css'), renderBlockStylesheet(packages), 'utf8');

  const layers = packages.filter((pkg) => pkg.storefront !== null).length;
  const stylesheets = packages.filter((pkg) => pkg.stylesheet !== null).length;
  process.stdout.write(
    `[blocks:generate] wrote: modules=${packages.length} layers=${layers} ` +
      `stylesheets=${stylesheets} manifests-read=${filesRead} ` +
      `ids=${packages.map((pkg) => pkg.moduleId).join(',') || '(none)'}\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

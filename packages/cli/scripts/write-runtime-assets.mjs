// The fifth step of this package's `build`: carry the runtime-asset classification
// (`scripts/lib/runtime-assets.mjs`, D-218's one owner of "does this file ship") into
// `dist/runtime-assets.mjs`, so that `endora build overlays` asks the same function in an
// instance that a checkout asks (`specs/190-overlay-full-modules/` T013). The reader is
// `src/lib/runtime-assets.ts`.
//
// Like the backend supervisor, it writes nothing where there is nothing to copy from, and
// says so; `prepack` (`assert-storefront-reference.mjs`) is what refuses to publish a
// tarball in that state.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(cliDir, '..', '..', 'scripts', 'lib', 'runtime-assets.mjs');
const target = join(cliDir, 'dist', 'runtime-assets.mjs');

if (existsSync(source)) {
  copyFileSync(source, target);
  process.stdout.write(`[runtime-assets] carried ${source} -> ${target}\n`);
} else {
  process.stdout.write(`[runtime-assets] no ${source} to carry; dist has no classification\n`);
}

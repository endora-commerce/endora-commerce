// The fourth step of this package's `build`: carry the backend supervisor
// (issue #596) into `dist/backend-supervisor.mjs`, so that `endora new
// instance` can scaffold `backend/scripts/supervise.mjs` outside a checkout.
// The reader is `src/new-instance/backend-supervisor.ts`.
//
// Like the storefront reference, it writes nothing where there is nothing to
// copy from, and says so; `prepack` (`assert-storefront-reference.mjs`) is what
// refuses to publish a tarball in that state.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(cliDir, '..', '..', 'backend', 'scripts', 'supervise.mjs');
const target = join(cliDir, 'dist', 'backend-supervisor.mjs');
if (existsSync(source)) {
  copyFileSync(source, target);
  process.stdout.write('backend-supervisor: carried\n');
} else {
  process.stdout.write(
    `backend-supervisor: NOT WRITTEN — ${source} is absent.\n` +
      '  This build cannot scaffold an instance outside a checkout, and `pnpm pack` refuses it.\n',
  );
}

// `prepack`: a tarball of this package must carry the reference storefront.
//
// The build writes it only from a git checkout that holds the storefront
// (`write-storefront-reference.mjs`), and deliberately does not fail where it
// cannot — a container image builds this package with neither. What must not
// happen is that state reaching a registry: every `npx create-endora-commerce`
// would then refuse the storefront, silently one release later. So the refusal
// is here, at the one step every published tarball goes through.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ownPackagedReference } from '../dist/new-storefront/packaged.js';

const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));
let found = null;
let problem = 'dist/storefront-reference/reference.json is absent';
try {
  found = ownPackagedReference(import.meta.url);
} catch (error) {
  problem = error instanceof Error ? error.message : String(error);
}
if (found === null) {
  process.stderr.write(
    `@endora-commerce/cli: refusing to pack ${cliDir} — ${problem}.\n` +
      'Run `pnpm --filter @endora-commerce/cli run build` in a git checkout that holds the ' +
      'storefront, at the version being packed, and pack again.\n',
  );
  process.exit(1);
}
process.stdout.write(
  `storefront-reference: ${String(found.packaged.files.length)} files for CLI ${found.packaged.cliVersion}\n`,
);

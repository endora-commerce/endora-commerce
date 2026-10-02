// The third half of this package's `build`: write `dist/storefront-reference/`,
// the reference storefront a published CLI carries so that `endora new
// storefront` and `endora install` can write one outside a checkout. The
// derivation is `src/new-storefront/packaged.ts`, compiled by the `tsc` that
// runs first; this file only calls it.
//
// It writes nothing where there is nothing to derive it from — a container
// image build has no git and, for the backend image, no storefront — and says
// so. `prepack` (`assert-storefront-reference.mjs`) is what refuses to publish
// a tarball in that state.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writePackagedReference } from '../dist/new-storefront/packaged.js';

const result = await writePackagedReference(dirname(dirname(fileURLToPath(import.meta.url))));
process.stdout.write(
  result.written
    ? `storefront-reference: ${String(result.files)} files, ${String(result.omitted)} omitted, ` +
        `${String(Math.round(result.bytes / 1024))} kB\n`
    : `storefront-reference: NOT WRITTEN — ${result.reason}\n` +
        '  This build cannot write a storefront outside a checkout, and `pnpm pack` refuses it.\n',
);

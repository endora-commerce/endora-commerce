// The second half of this package's `build`: write `dist/release-index.json`
// (D-271 clause 2). The derivation is `src/lib/release-index.ts`, compiled by
// the `tsc` that runs first; this file only calls it.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeReleaseIndex } from '../dist/lib/release-index.js';

const index = writeReleaseIndex(dirname(dirname(fileURLToPath(import.meta.url))));
process.stdout.write(`release-index.json: ${String(index.packages.length)} packages\n`);

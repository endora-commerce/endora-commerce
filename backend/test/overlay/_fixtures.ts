// Shared helper: absolute paths to the overlay test fixtures.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const FIXTURES = join(here, 'fixtures');
export const overlayRoot = (name: string): string => join(FIXTURES, name);

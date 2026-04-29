/**
 * Fixture loader for feature 002 (catalog module extension).
 *
 * Drives the smoke scenarios in `specs/002-catalog-module/quickstart.md` §2.
 * Each user-story phase contributes its own seed data block; this skeleton
 * exposes a single `runSeed()` entry point and a typed envelope so the
 * subsequent US-specific tasks can plug in without wiring boilerplate.
 *
 * Invocation: `pnpm --filter backend run seed:002`.
 */

import { initOrm } from '../../src/db/index.js';

export interface SeedResult {
  attributeSets: { id: string; code: string }[];
  attributes: { id: string; key: string }[];
  products: { id: string; sku: string; type: string }[];
  galleries: { productId: string; itemCount: number }[];
  attachments: { productId: string; count: number }[];
  links: { sourceProductId: string; count: number }[];
  bundles: { productId: string; slotCount: number }[];
  groupedSets: { productId: string; itemCount: number }[];
  virtualProducts: { productId: string }[];
}

const emptyResult = (): SeedResult => ({
  attributeSets: [],
  attributes: [],
  products: [],
  galleries: [],
  attachments: [],
  links: [],
  bundles: [],
  groupedSets: [],
  virtualProducts: [],
});

export async function runSeed(): Promise<SeedResult> {
  const orm = await initOrm();
  try {
    const em = orm.em.fork();
    const result = emptyResult();

    // US1 (T027): Default AttributeSet, sample attributes of all 6 API types,
    //             10 simple Products across category leaves.
    // US2 (T048): configurable T-shirt with 5/9 variants.
    // US3 (T080): 4 attachment types + 2 PDFs on existing simple products.
    // US3 (gallery): sample images attached to several products with labels.
    // US4 (US4-related seed): related/up-sell/cross-sell links between products.
    // US5 (T133): one grouped, one bundle (2 slots), one virtual product.
    //
    // Each block is added by the task that needs it; this function commits
    // once at the end so partial failures roll back cleanly.

    await em.flush();
    return result;
  } finally {
    await orm.close(true);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed()
    .then((result) => {
      const counts = Object.entries(result)
        .map(([key, value]) => `${key}=${Array.isArray(value) ? value.length : 0}`)
        .join(' ');
      // eslint-disable-next-line no-console
      console.log(`[seed:002] ok ${counts}`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[seed:002] failed:', err);
      process.exit(1);
    });
}

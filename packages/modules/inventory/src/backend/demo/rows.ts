/**
 * The warehouse this module's demo data creates (feature 113, T223).
 *
 * One place holding the data, imported by both bodies: `seed.ts` creates the
 * warehouse and its channel assignments and `reset.ts` withdraws exactly them,
 * by the fixed id `seed` assigns (contract §2.5).
 *
 * **The id is fixed rather than minted**, and it always has been: the demo's
 * second warehouse is referenced by code from the instance composition's stock
 * spread, and a re-seed that minted a new id would leave the previous one
 * behind with stock on it.
 *
 * ## §2.6, and why this row has no per-language map
 *
 * `Warehouse.name` and `Warehouse.description` are scalar columns — a
 * `varchar(160)` and a `text` — so the per-language shape §2.6 asks for has
 * nowhere to go, and putting it there would be a migration this feature does
 * not take (contract §8). What that leaves is a choice about the value itself,
 * and it is decided the way the rest of the platform decides it: a warehouse
 * name is **operator content**, the sort of string a shop writes for itself, and
 * the default language for anything a developer writes is English (the owner's
 * ruling of 2026-09-01). The demo used to write `Magazyn Kraków`, which is a
 * Polish sentence in a module's own sources with no per-language structure
 * around it — `check:default-language-prose`'s subject exactly, invisible only
 * because `backend/src/seeds/` is in no module walk root. So the label is
 * English and the place name stays a place name.
 */

/** The demo's second warehouse, in `Warehouse`'s own field names. */
export const DEMO_WAREHOUSE = {
  id: '00000000-0000-4000-8000-00000000d0c0',
  code: 'pl-krk',
  name: 'Krakow warehouse',
  active: true,
  description: 'Demo secondary warehouse — Krakow, PL',
} as const;

/** Where the demo's assignments sort, behind the system warehouse's default. */
export const DEMO_ASSIGNMENT_SORT_ORDER = 1;

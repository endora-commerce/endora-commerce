/**
 * Cross-module reaches still standing in `carrier_fixture`, the example
 * deployment's stand-in carrier (feature 075; feature 134, FR-021/FR-064).
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes.
 *
 * **This module's whole purpose is to be a consumer**, so its one entry retires
 * with the seam rather than with the fixture: the two carriers that used to call
 * `delivery_methods`' install surface stop being workspace peers at wave 1's end,
 * and a published surface with no caller in this workspace is a breaking change
 * that type-checks green here and reds in a consumer's build, days later. The same
 * reach in a real carrier's manifest is ledgered in that carrier's own shard, with
 * the argument; this shard outlives them.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'apps/example/modules/carrier_fixture/manifest.ts:delivery_methods/install':
    'Import reach: the fixture\'s `installHook` and `uninstallHook` construct ' +
    '`delivery_methods`\' published install surface — `createDeliveryMethodSeeder()` on ' +
    '`@endora-commerce/mod-delivery-methods/install`, typed by `DeliveryMethodSeedApi` on that ' +
    'package\'s `./ports` — to seed one delivery method for its courier adapter, bind it to the ' +
    'default channel **on create only**, and remove it on a hard uninstall (W7\'s last step; ' +
    '`specs/134-paid-module-extraction/contracts/foreign-write-repair.md` §2.1).\n\n' +
    '**The reach is the point of the module rather than a cost of it.** An install hook has no ' +
    'container — `ModuleLifecycleContext` is `{ em, redis, log, module }` and `module:install` ' +
    'composes nothing (D-46) — so the factory is a runtime import and contract surface is the ' +
    'subpath exporting none; `specs/conventions/module-composition.md` item 9a rules that this ' +
    'seam takes a key here and accepts it.\n\n' +
    'Retired by a seam that hands an install hook the owner\'s surface without an import, which ' +
    'does not exist and whose obvious form D-46 refuses. Not by deleting the fixture: FR-021 is ' +
    'what put it here.',
};

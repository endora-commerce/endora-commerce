/**
 * Cross-module reaches still standing in `payment_gateway_fixture`, the example
 * deployment's stand-in payment gateway (feature 075; feature 134,
 * FR-021/FR-064).
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes.
 *
 * **This module's whole purpose is to be a consumer**, so its one entry retires
 * with the seam rather than with the fixture: the five gateways that call
 * `payment_methods`' install surface stop being workspace peers at wave 2's end,
 * and a published surface with no caller in this workspace is a breaking change
 * that type-checks green here and reds in a consumer's build, days later. The same
 * reach in a real gateway's manifest is ledgered in that gateway's own shard, with
 * the argument; this shard outlives them.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'apps/example/modules/payment_gateway_fixture/manifest.ts:payment_methods/install':
    'Import reach: the fixture\'s `installHook` and `uninstallHook` construct ' +
    '`payment_methods`\' published install surface — `createPaymentMethodSeeder()` on ' +
    '`@endora-commerce/mod-payment-methods/install`, typed by `PaymentMethodSeedApi` on that ' +
    'package\'s `./ports` — to seed one payment method for its redirect adapter, bind it to the ' +
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

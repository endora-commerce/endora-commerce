/**
 * The two consequences of a duplicated platform, measured directly (feature 080,
 * the platform relocation).
 *
 * `platform-single-copy-probe.ts` compares object identity, which is the general
 * statement. These two are the specific ones the duplication was found through,
 * and they are worth measuring on their own because each fails in a way object
 * identity does not describe to a reader:
 *
 *  1. **`instanceof` across the boundary.** `http/error-envelope.ts` and
 *     `http/interceptors/dispatch.ts` both ask `err instanceof HttpError`. With
 *     two copies the answer is `false` for anything a packaged module threw, so
 *     every 404 and 409 rendered as a 500 — no type error, no log line.
 *  2. **`MikroORM` metadata.** `MetadataStorage.metadata` is
 *     `globalThis['mikro-orm-metadata']` under an unversioned key, so two copies
 *     of an entity class land in one registry and discovery throws
 *     `Duplicate entity names are not allowed: SalesChannel` (D-160.6, §3.2
 *     experiments 2/3). `kernel/sales-channels/sales-channel.entity` is imported
 *     48 times by 23 modules, so this is the ordinary case rather than a corner.
 *
 * Both are measured **across the two specifier shapes**: the bare
 * `@endora-commerce/platform/*` an installed package writes, and the relative
 * path into `backend/src/` that every module in this repository still writes.
 *
 * Spawned, and never imported into the suite: it puts entity classes into the
 * global metadata storage and runs discovery over them.
 */
import { HttpError as HttpErrorFromPackage } from '@endora-commerce/platform/http';
import { SalesChannel as SalesChannelFromPackage } from '@endora-commerce/platform/kernel';
import { HttpError as HttpErrorFromApplication } from '@endora-commerce/platform/http';
import { SalesChannel as SalesChannelFromApplication } from '../../src/kernel/sales-channels/sales-channel.entity.js';
import { MikroORM } from '@mikro-orm/postgresql';

interface Result {
  /** A value the *package* built, tested against the *application*'s class. */
  readonly packageThrowIsApplicationError: boolean;
  /** And the other way, because a one-way test passes when both sides are one class. */
  readonly applicationThrowIsPackageError: boolean;
  /** `true` when both specifier shapes name one class object. */
  readonly oneSalesChannelClass: boolean;
  /** What discovery found, or the message it refused with. */
  readonly discovered: readonly string[] | string;
}

const raised = new HttpErrorFromPackage(404, 'NOT_FOUND', 'nothing here');
const thrownHere = new HttpErrorFromApplication(409, 'VERSION_CONFLICT', 'already there');

let discovered: readonly string[] | string;
try {
  const orm = MikroORM.initSync({
    // The two shapes as a **set**, which is what an entity registry really is:
    // `db/entities-registry.generated.ts` names `SalesChannel` once and a
    // packaged module names its own imports, and MikroORM is handed the union.
    // One class arrives once and discovery succeeds; two arrive twice under one
    // name and it throws, which is the whole of D-160.6. A plain array of both
    // references is not the test — MikroORM refuses even *one* class listed
    // twice, so it would throw whether or not the duplication were fixed.
    entities: [...new Set([SalesChannelFromPackage, SalesChannelFromApplication])],
    discovery: { requireEntitiesArray: true },
    dbName: 'platform-cross-boundary-probe',
    // Never connected: `initSync` defers the connection until the first query
    // and this probe issues none. Discovery — the half under test — is
    // synchronous and has already run by the time this returns.
    connect: false,
  });
  discovered = Object.keys(orm.getMetadata().getAll()).sort();
} catch (error: unknown) {
  discovered = error instanceof Error ? error.message : String(error);
}

const result: Result = {
  packageThrowIsApplicationError: raised instanceof HttpErrorFromApplication,
  applicationThrowIsPackageError: thrownHere instanceof HttpErrorFromPackage,
  oneSalesChannelClass: SalesChannelFromPackage === SalesChannelFromApplication,
  discovered,
};
process.stdout.write(`${JSON.stringify(result)}\n`);

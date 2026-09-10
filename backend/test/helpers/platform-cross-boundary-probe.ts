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
 *     experiments 2/3). `SalesChannel` was the entity class the whole tree
 *     imported, which is why it is the one measured here.
 *
 * ## Both sides are now the bare specifier, and that is the drain finishing
 *
 * This block read *"both are measured **across the two specifier shapes**: the
 * bare `@endora-commerce/platform/*` an installed package writes, and the
 * relative path into `backend/src/` that every module in this repository still
 * writes"*, and it is no longer true of either pair. `specs/110-instance-repository/`
 * T119b re-pointed the last consumers of `backend/src/http/` and deleted the
 * directory; T119c deleted the six platform **entity** shims with it, so
 * `kernel/sales-channels/sales-channel.entity.ts` has no application spelling at
 * all. The two `FromApplication` bindings below therefore name the same module as
 * their `FromPackage` neighbours, and both assertions in
 * `test/unit/kernel/platform-single-copy.test.ts`' second `describe` are true
 * over **one** spelling.
 *
 * That is the ledger emptying seen from this file, and it is the same arithmetic
 * `platform-single-copy.test.ts`' *"shares 50 values"* records: a value is
 * comparable only while the application spells it twice, so the population
 * shrinks as each shim goes and reaches zero when `RELATIVE_HOST_REACHES` does
 * (T119e). It is **left standing rather than quietly weakened**: nothing here was
 * relaxed to keep a run green, the two `instanceof` directions and the discovery
 * refusal are the sentences a reader of a future regression will recognise, and a
 * second spelling of either value — a `paths` alias, a second `dist`, a shim
 * re-pointed at `packages/platform/src` — makes both real again in the same run,
 * with nobody having to remember to re-write them. What must not happen is a
 * *third* reading of this paragraph that finds it stale again: the retirement
 * decision belongs with T119e, where the subject goes.
 *
 * Spawned, and never imported into the suite: it puts entity classes into the
 * global metadata storage and runs discovery over them.
 */
import { HttpError as HttpErrorFromPackage } from '@endora-commerce/platform/http';
import { SalesChannel as SalesChannelFromPackage } from '@endora-commerce/platform/kernel';
import { HttpError as HttpErrorFromApplication } from '@endora-commerce/platform/http';
import { SalesChannel as SalesChannelFromApplication } from '@endora-commerce/platform/kernel';
import { MikroORM } from '@mikro-orm/postgresql';

interface Result {
  /**
   * A value one binding built, tested against the other's class. The two named
   * the two specifier shapes until T119b; they name one module now, and the
   * header says what that costs and why the assertion stays.
   */
  readonly packageThrowIsApplicationError: boolean;
  /** And the other way, because a one-way test passes when both sides are one class. */
  readonly applicationThrowIsPackageError: boolean;
  /** `true` when the two bindings name one class object. */
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

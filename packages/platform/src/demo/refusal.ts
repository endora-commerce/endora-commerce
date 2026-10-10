/**
 * A demo reset that **declined to run**, as opposed to one that failed
 * (issue #143).
 *
 * The distinction is what the operator reads. A failure is somebody's defect
 * and is printed with its stack; a refusal is the command working as designed —
 * it looked, found something it will not delete on its own authority, and
 * changed nothing — so it is printed as its message alone, which says what was
 * found and what to do.
 *
 * It is the platform's class so that the dispatcher can tell the two apart
 * without naming a composition, and a composition throws it so that its
 * refusals read the same whoever wrote it.
 */
export class DemoResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoResetRefusedError';
  }
}

/**
 * The one way a demo reset is told to delete financial records.
 *
 * ## Why it is a flag, and only a flag
 *
 * An invoice, a payment or what was sent to an accounting system is a record
 * with a life outside the shop: it may have been reported to a tax authority
 * or matched in somebody's books. A reset that met one used to delete it like
 * any other row. It now refuses, and this flag is how the operator of an
 * instance whose data is disposable says so — on the command line of that one
 * invocation. It is deliberately **not** readable from the environment or from
 * any configuration: a default that deletes financial records is the thing
 * the refusal exists to prevent, and an environment variable is a default.
 *
 * ## What it does not do
 *
 * It is not `--force`. It skips no guard: the production guard runs first and
 * is unaffected, and a foreign key that refuses the reset still refuses it —
 * the flag deletes the kinds of record the composition knows how to delete and
 * nothing it does not know about.
 */
export const DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG = '--force-delete-financial-records';

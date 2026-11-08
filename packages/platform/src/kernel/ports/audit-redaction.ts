/**
 * Kernel port — erasing an anonymised subject's audit history in place
 * (issue #844).
 *
 * The audit log is append-only with **one** exception, and this is it: when a
 * customer is anonymised, the values its history recorded about it — names,
 * e-mails, addresses, free text, every custom-field value — are rewritten to the
 * marker `AUDIT_ERASED_MARKER` (`@endora-commerce/contracts`), while the keys,
 * the ids, the timestamps, the codes, the action, the actors and the time of
 * every row stay. One `audit.redacted` row records that it happened.
 *
 * **The container name is `auditRedactionService`**, platform-owned beside
 * `auditLogService`: the kernel writes its own table, so there is no module
 * owner, no manifest edge to declare and no off state to honour. `composeApp`
 * and the test kit register it, and `PLATFORM_OWNED_NAMES`
 * (`backend/scripts/check-port-dependencies.ts`) lists it; its reader is the
 * customers retention sweep.
 *
 * **A port of its own, not a method on {@link AuditPort}.** That port is typed
 * on by most modules and faked by many tests, and its writer's contract is
 * append-only; the one non-append write is a separate, named capability with
 * one caller — the customers retention sweep — so it is easy to find and to
 * audit.
 *
 * **What it touches is named, never searched for.** A target is an object type
 * and an explicit list of ids; there is no predicate. The caller derives the
 * ids from one subject's own records, which is what keeps a system-scope write
 * on a global table inside one subject (Principle XI).
 */
export interface AuditRedactionPort {
  /**
   * Rewrite every audit row about the targets, in chunks, and record one
   * `audit.redacted` row about the subject.
   *
   * **Idempotent and restartable.** A row whose rewrite equals what it already
   * holds is not written, so a second run writes nothing; a run that failed
   * part-way is finished by the next one. The marker row is written on a run
   * that changed something, and on the first complete run for a subject even
   * when there was nothing to change — so every anonymised subject has one.
   *
   * **Irreversible.** Nothing keeps the values it erases.
   *
   * Refuses — it throws, never silently narrows — on no target, a target with
   * no id, an id that is not UUID-shaped, more than
   * {@link AUDIT_REDACTION_MAX_IDS_PER_TARGET} ids in one target, a reason it
   * does not know, or a subject that is not a UUID-shaped customer account.
   */
  redact(input: AuditRedactionInput): Promise<AuditRedactionResult>;
}

/** The action of the one row a redaction writes about its subject. */
export const AUDIT_REDACTED_ACTION = 'audit.redacted';

/** The most ids one {@link AuditRedactionTarget} may name. */
export const AUDIT_REDACTION_MAX_IDS_PER_TARGET = 1000;

/** One object type, and the explicit ids of its rows to rewrite. */
export interface AuditRedactionTarget {
  /** The audit row's `objectType` — `customer_account`, `organization`, … */
  readonly objectType: string;
  /** Explicit, UUID-shaped object ids; never a predicate. */
  readonly objectIds: readonly string[];
  /**
   * The owner's extra **code** keys for this object type — the
   * `*_AUDIT_KEEP_KEYS` constant in the owner's contracts file. A value under
   * one of them is kept only when it has a code's shape.
   */
  readonly keepKeys?: readonly string[];
}

export interface AuditRedactionInput {
  /** Why. An enum of one, so a second reason is a reviewed change. */
  readonly reason: 'anonymization';
  /** Who the history is erased for; the `audit.redacted` row is about it. */
  readonly subject: { readonly objectType: 'customer_account'; readonly objectId: string };
  readonly targets: readonly AuditRedactionTarget[];
  /**
   * The subject's account id as an *actor*: on an in-scope row it wrote for
   * itself (`actorCustomerAccountId`), the IP address and the user agent are
   * the subject's own data and are erased too (owner ruling on #844). On a row
   * an operator or anybody else wrote, they are that actor's and stay. `null`
   * or absent leaves every IP and user agent alone.
   */
  readonly subjectActorAccountId?: string | null;
}

export interface AuditRedactionResult {
  /** Rows about the targets, the `audit.redacted` rows excepted. */
  readonly rowsInScope: number;
  /** Rows this run rewrote; `0` on a run that found everything already erased. */
  readonly rowsChanged: number;
  /** Whether this run wrote an `audit.redacted` row. */
  readonly markerWritten: boolean;
}

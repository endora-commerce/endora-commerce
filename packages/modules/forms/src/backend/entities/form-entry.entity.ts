import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import type { AnswerValue, FormConsentRecord, FormEntryStatus } from '@endora-commerce/contracts';
import { CustomerScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * One submission of a published form version (`specs/170-forms-module/data-model.md` §4).
 *
 * ## Principle XI review (research § Principle XI review — compliant)
 *
 * `@CustomerScoped` **with** an `organizationId` property, as `NewsletterSubscriber` is: the
 * column's presence in the ORM metadata is what makes the guard's `allowed-set` arm **grant**
 * (`organization_id IN (…)`) rather than refuse the table, so a scoped administrator reads the
 * entries of the organisations assigned to them — and never an anonymous entry, because that
 * predicate cannot match NULL. A signed-in customer's context restricts to their own account; an
 * unrestricted administrator and the system scope read everything.
 *
 * **The attribution is an equivalence, not an implication**: `customer_account_id` and
 * `organization_id` are null together or set together (`form_entries_attribution_chk`), because
 * FR-045 states both directions. Both are stamped **by the server at the write** from the session's
 * customer and the organisation `customerAccountReadPort` resolves for them — never from the
 * request body (the public submission schema is strict and has no field for either), and never
 * from a typed e-mail address. MikroORM applies no filter to an INSERT, so the CHECK is the write's
 * own refusal.
 *
 * An anonymous entry is not a "no-organisation scoping path": the anonymous submitter is not a
 * customer and runs in the platform's explicit `system` mode, and no read path resolves
 * "organisation = null" for anybody but an unrestricted actor.
 *
 * Never updated except `status` and `confirmationSentAt`. `answers` hold **visible input fields
 * only** (FR-032); `answers`, `consents`, `submitterEmail` and `searchText` never enter an audit
 * state, a log line, a queue payload or an event other than FR-064's shared answers (FR-055).
 */
@CustomerScoped()
@Entity({ tableName: 'form_entries' })
export class FormEntry {
  [OptionalProps]?:
    | 'id'
    | 'pageUrl'
    | 'submittedAt'
    | 'answers'
    | 'consents'
    | 'submitterEmail'
    | 'searchText'
    | 'status'
    | 'confirmationSentAt'
    | 'customerAccountId'
    | 'organizationId'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  formId!: string;

  @Property({ type: 'uuid' })
  formVersionId!: string;

  /** Denormalised for the list and the export. */
  @Property({ type: 'integer' })
  formVersionNumber!: number;

  /** The resolved request channel (FR-035); held by value — no cross-module key. */
  @Property({ type: 'uuid' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 16 })
  language!: string;

  /** Same-origin path and query from the storefront; plain text. */
  @Property({ type: 'string', length: 2048, nullable: true })
  pageUrl: string | null = null;

  @Property({ type: 'datetime' })
  submittedAt: Date = new Date();

  @Property({ type: 'json' })
  answers: Record<string, AnswerValue> = {};

  /** The consent texts as shown, in the submission language (FR-029). */
  @Property({ type: 'json' })
  consents: FormConsentRecord[] = [];

  /** The submitter e-mail answer, lower-cased; `null` when hidden or absent. */
  @Property({ type: 'string', length: 320, nullable: true })
  submitterEmail: string | null = null;

  /** The lower-cased text answers, ≤ 20 000 characters (R-18). */
  @Property({ type: 'text' })
  searchText: string = '';

  @Property({ type: 'string', length: 16 })
  status: FormEntryStatus = 'new';

  /** FR-058: the confirmation e-mail is sent at most once. */
  @Property({ type: 'datetime', nullable: true })
  confirmationSentAt: Date | null = null;

  /** Server-stamped from the session (see the class comment). */
  @Property({ type: 'uuid', nullable: true })
  customerAccountId: string | null = null;

  /** Server-stamped from the account; null exactly when the account is (see the class comment). */
  @Property({ type: 'uuid', nullable: true })
  organizationId: string | null = null;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}

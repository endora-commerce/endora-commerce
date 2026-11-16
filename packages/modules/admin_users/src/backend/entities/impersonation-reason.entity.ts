import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { CustomerScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * ImpersonationReason — the reason an administrator gave when they started
 * impersonating a customer account (issue #470, D-288).
 *
 * The reason is free text about a tenant's account, so it may not sit in the
 * platform audit log, which is one global table read under `audit_log:read`
 * without Organization reach (`specs/conventions/audit-state.md` §2, §3). The
 * `impersonation.start` entry records `hasReason`, `reasonLength` and this
 * row's id as `valueChangeId`; the text lives here.
 *
 * `@CustomerScoped` with an `organizationId` property, classified like the
 * account it is about: the guard narrows a read to the caller's accounts or
 * Organizations, as it narrows a read of the account. One row per
 * `impersonation.start` that carried a reason, written in the same transaction
 * as the audit entry, so a rolled-back start leaves neither. Never updated.
 *
 * Nothing reads it yet: a reader that shows the reason beside the audit entry
 * is a follow-up, and it must load the account through its scoped path first.
 */
@CustomerScoped()
@Entity({ tableName: 'admin_impersonation_reasons' })
export class ImpersonationReason {
  [OptionalProps]?: 'id' | 'at';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index({ name: 'admin_impersonation_reasons_customer_account_idx' })
  @Property({ type: 'uuid' })
  customerAccountId!: string;

  @Property({ type: 'uuid' })
  organizationId!: string;

  @Property({ type: 'uuid' })
  actorAdminUserId!: string;

  @Property({ type: 'text' })
  reason!: string;

  @Property({ type: 'datetime' })
  at: Date = new Date();
}

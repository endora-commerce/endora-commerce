import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import type { FormDefinition, FormStatus } from '@endora-commerce/contracts';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A form (`specs/170-forms-module/data-model.md` §1): the editable working copy and the live
 * settings — name, key, status, recipients, retention — of a form an operator builds. What a
 * shopper sees is the form's latest **published version** (`FormVersion`), which this row points
 * at; editing the working copy changes nothing on the storefront until the next publish (FR-009).
 *
 * Operator content, like a CMS page: platform-wide and about no customer (research § Principle XI
 * review). `acceptedEntryCount` is the form's count of non-spam entries across all tenants,
 * maintained by the Commands that change it, so the maximum-entries rule needs no widened count.
 */
@GlobalEntity()
@Entity({ tableName: 'forms' })
export class Form {
  [OptionalProps]?:
    | 'id'
    | 'status'
    | 'revision'
    | 'publishedVersionId'
    | 'publishedVersionNumber'
    | 'recipients'
    | 'channelRecipients'
    | 'retentionDays'
    | 'acceptedEntryCount'
    | 'createdByAdminUserId'
    | 'updatedByAdminUserId'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `^[a-z][a-z0-9_]{0,63}$`, unique; live (R-4). */
  @Property({ type: 'string', length: 64 })
  key!: string;

  /** Admin-facing; live. */
  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'string', length: 16 })
  defaultLanguage!: string;

  @Property({ type: 'string', length: 16 })
  status: FormStatus = 'draft';

  /** The working copy (`formDefinitionSchema`), shape-validated on save. */
  @Property({ type: 'json' })
  definition!: FormDefinition;

  /** Optimistic concurrency (R-26): every save increments it, every write names it. */
  @Property({ type: 'integer' })
  revision: number = 1;

  @Property({ type: 'uuid', nullable: true })
  publishedVersionId: string | null = null;

  /** `0` until the first publish. */
  @Property({ type: 'integer' })
  publishedVersionNumber: number = 0;

  /** The default recipients of the shop notification, ≤ 10; live. */
  @Property({ type: 'json' })
  recipients: string[] = [];

  /** Per sales channel, a list that **replaces** the default on that channel (A-2); live. */
  @Property({ type: 'json' })
  channelRecipients: Record<string, string[]> = {};

  /** 1–3 650; `null` keeps entries (A-12); live. */
  @Property({ type: 'integer', nullable: true })
  retentionDays: number | null = null;

  @Property({ type: 'integer' })
  acceptedEntryCount: number = 0;

  @Property({ type: 'uuid', nullable: true })
  createdByAdminUserId: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  updatedByAdminUserId: string | null = null;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}

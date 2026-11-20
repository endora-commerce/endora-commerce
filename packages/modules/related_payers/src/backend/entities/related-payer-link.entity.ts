import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import type {
  PayerCommercialTerms,
  RelatedPayerAddressScopeKind,
  RelatedPayerLinkOrigin,
  RelatedPayerLinkState,
  RelatedPayerRevokedByKind,
} from '@endora-commerce/contracts';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

/**
 * A payer link: buyer Organization X (`organizationId`, the tenant anchor) may name
 * Organization Y (`payerOrganizationId`) as the payer of its orders
 * (`specs/182-related-payers/` data-model §1).
 *
 * `@OrgScoped` on the buyer: X's reads are confined to X by the tenant filter. The payer's
 * side (`listAsPayer`, `findAsPayer`) reads under `withSystemScope` and constrains by
 * `payerOrganizationId` itself (research R-5).
 */
@OrgScoped()
@Entity({ tableName: 'related_payer_links' })
export class RelatedPayerLink {
  [OptionalProps]?:
    | 'id'
    | 'state'
    | 'addressScope'
    | 'billingAddressId'
    | 'validFrom'
    | 'validTo'
    | 'commercialTerms'
    | 'notifyPayerOnOrders'
    | 'originSource'
    | 'originRequestId'
    | 'revokedAt'
    | 'revokedByKind'
    | 'revokedById'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'uuid' })
  @Index()
  payerOrganizationId!: string;

  @Property({ type: 'string', length: 16 })
  state: RelatedPayerLinkState = 'active';

  @Property({ type: 'string', length: 8 })
  addressScope: RelatedPayerAddressScopeKind = 'all';

  @Property({ type: 'uuid', nullable: true })
  billingAddressId: string | null = null;

  /** RP-15 — an instant; the window is inclusive at both ends. */
  @Property({ type: 'datetime', nullable: true })
  validFrom: Date | null = null;

  @Property({ type: 'datetime', nullable: true })
  validTo: Date | null = null;

  @Property({ type: 'string', length: 8 })
  commercialTerms: PayerCommercialTerms = 'buyer';

  @Property({ type: 'boolean' })
  notifyPayerOnOrders: boolean = false;

  @Property({ type: 'string', length: 16 })
  origin!: RelatedPayerLinkOrigin;

  @Property({ type: 'string', length: 64, nullable: true })
  originSource: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  originRequestId: string | null = null;

  @Property({ type: 'datetime', nullable: true })
  revokedAt: Date | null = null;

  @Property({ type: 'string', length: 16, nullable: true })
  revokedByKind: RelatedPayerRevokedByKind | null = null;

  @Property({ type: 'uuid', nullable: true })
  revokedById: string | null = null;

  /** Optimistic lock — the admin `PATCH` sends it back as `If-Match`. */
  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}

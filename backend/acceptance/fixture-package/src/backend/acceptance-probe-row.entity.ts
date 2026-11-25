import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

/**
 * The one persisted entity the fixture package ships.
 *
 * It is the whole point of the criterion: `generate-composer.ts` finds entities
 * by the source text `@Entity(` under `backend/src`, and this decorator is
 * compiled away into a `__decorate([...])` call inside a published `dist`. So a
 * source-text probe cannot see this class, and the entity registry the ORM is
 * configured with cannot carry it — which is what assertion A4 measures.
 *
 * **It is `@OrgScoped()`, through the platform's published `./tenancy` barrel**
 * — what any third-party module does. Since #1849 the platform refuses to boot
 * with a persisted entity that carries no tenancy classification, so the
 * fixture that once surfaced the gap ("a package cannot classify its own
 * entity") now has to close it the way a real package would. The decorator
 * comes from the one platform copy host and package share (the peer link A8
 * holds), so it writes into the registry the host's filters are built from.
 *
 * `@mikro-orm/core` is an optional peer dependency, resolved from the host —
 * one copy, or the decorators write into a MetadataStorage the host's ORM never
 * reads.
 */
@Entity({ tableName: 'acceptance_probe_rows' })
@OrgScoped()
export class AcceptanceProbeRow {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  /** The tenant column, as the migration declares it; `@OrgScoped()` filters on it. */
  @Property({ type: 'uuid', nullable: true })
  organizationId?: string | null;

  @Property({ type: 'text' })
  label!: string;

  @Property({ type: 'timestamptz', defaultRaw: 'now()' })
  createdAt!: Date;
}

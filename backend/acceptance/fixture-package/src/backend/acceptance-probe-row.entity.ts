import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * The one persisted entity the fixture package ships.
 *
 * It is the whole point of the criterion: `generate-composer.ts` finds entities
 * by the source text `@Entity(` under `backend/src`, and this decorator is
 * compiled away into a `__decorate([...])` call inside a published `dist`. So a
 * source-text probe cannot see this class, and the entity registry the ORM is
 * configured with cannot carry it — which is what assertion A4 measures.
 *
 * **It carries no tenant-scope decorator, and that is a gap this fixture
 * surfaces rather than papers over.** `@GlobalEntity()`, `@OrgScoped()` and
 * `@CustomerScoped()` live in `backend/src/tenancy/` and no package publishes
 * them, so a third-party module physically cannot classify its own entity
 * today. Importing them by a relative path back into the repository is exactly
 * the trap A8 refuses, and inventing a second classification mechanism here
 * would make the fixture prove something the platform does not do. The column
 * below is the tenant column the migration declares; nothing filters on it yet.
 *
 * `@mikro-orm/core` is an optional peer dependency, resolved from the host —
 * one copy, or the decorators write into a MetadataStorage the host's ORM never
 * reads.
 */
@Entity({ tableName: 'acceptance_probe_rows' })
export class AcceptanceProbeRow {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  /** The tenant column, as the migration declares it. See the note above. */
  @Property({ type: 'uuid', nullable: true })
  organizationId?: string | null;

  @Property({ type: 'text' })
  label!: string;

  @Property({ type: 'timestamptz', defaultRaw: 'now()' })
  createdAt!: Date;
}

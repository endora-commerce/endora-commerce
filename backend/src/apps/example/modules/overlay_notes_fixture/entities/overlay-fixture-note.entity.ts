import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'node:crypto';

/**
 * One note an organization keeps — the row `overlay_notes_fixture` owns.
 *
 * Organization-scoped (Principle XI): the tenancy filter is what makes another
 * organization's note "not found", which is the one behaviour the fixture's
 * integration test reads. Registered through `backend.ts`' `entities` export, as
 * every overlay entity is (`overlay-schema-discovery.md` §1).
 */
@OrgScoped()
@Entity({ tableName: 'overlay_fixture_notes' })
export class OverlayFixtureNote {
  [OptionalProps]?: 'id' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @Property({ type: 'uuid', fieldName: 'organization_id' })
  organizationId!: string;

  @Property({ type: 'text' })
  body!: string;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();
}

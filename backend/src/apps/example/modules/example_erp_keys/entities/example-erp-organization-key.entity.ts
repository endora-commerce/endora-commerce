import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

/**
 * One Organization's ERP key — the side row `example_erp_keys` keeps on
 * `organizations.Organization` (`specs/187-side-table-extensions/`, declared in
 * the manifest's `extends`).
 *
 * Shaped as 187's rules require of a side table on `organizations`
 * (`contracts/verification-rules.md` §2 – §4): one primary-key property, a
 * `uuid`, which **is** the Organization's id and a cascading foreign key to it;
 * and `@OrgScoped()` keyed by that same property — the one scoped form admitted
 * for a global host — so the tenancy filter is what makes another
 * Organization's key "not found".
 *
 * The key is unique across the shop (`erp_key` carries a unique constraint), so
 * a second Organization claiming one is refused by the database, inside the
 * create, whatever the caller's scope.
 */
/**
 * The unique constraint on `erp_key`, as the module's migration names it — what
 * the hook matches a unique violation on, so it claims only its own.
 */
export const ERP_KEY_UNIQUE_CONSTRAINT = 'example_erp_keys_organization_keys_erp_key_unique';

@OrgScoped()
@Entity({ tableName: 'example_erp_keys_organization_keys' })
export class ExampleErpOrganizationKey {
  [OptionalProps]?: 'createdAt';

  @PrimaryKey({ type: 'uuid', fieldName: 'organization_id' })
  organizationId!: string;

  @Unique({ name: ERP_KEY_UNIQUE_CONSTRAINT })
  @Property({ type: 'text' })
  erpKey!: string;

  @Property({ type: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date();
}

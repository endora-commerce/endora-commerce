import { describe, expect, it } from 'vitest';
import { MetadataStorage, type EntityProperty } from '@mikro-orm/core';
import { Organization } from './organization.entity.js';
import { OrganizationTaxIdPolicy } from './organization-tax-id-policy.entity.js';

/**
 * `specs/177-tax-id-scope/` data-model §1–§2 — what the entities map.
 *
 * The tax ID is nullable (a personal organization has none) and carries no
 * entity-level uniqueness: which constraint enforces it is the installation's
 * scope, owned by the migration and the scope Command, and an `@Unique()` here
 * would be wrong in `per-tree-root`. `root_id` is a stored generated column the
 * entity must not map — every `em.create` would otherwise try to write it.
 */
const meta = MetadataStorage.getMetadataFromDecorator(Organization);
const properties = meta.properties as unknown as Record<string, EntityProperty | undefined>;

describe('Organization — the tax-ID columns [unit]', () => {
  it('maps taxId as a nullable varchar(32) with no entity-level unique', () => {
    const taxId = properties.taxId!;
    expect(taxId.nullable).toBe(true);
    expect(taxId.length).toBe(32);
    expect(taxId.unique).toBeFalsy();
    const uniques = (meta.uniques ?? []).flatMap((u) => [u.properties ?? []].flat());
    expect(uniques).not.toContain('taxId');
  });

  it('maps personalAccountId and convertedToCompanyAt, both nullable', () => {
    expect(properties.personalAccountId).toMatchObject({ type: 'uuid', nullable: true });
    expect(properties.convertedToCompanyAt).toMatchObject({ nullable: true });
  });

  it('does not map root_id', () => {
    const mapped = Object.values(properties).flatMap((p) => (p ? [p.name, ...(p.fieldNames ?? [])] : []));
    expect(mapped).not.toContain('rootId');
    expect(mapped).not.toContain('root_id');
  });

  it('a new organization has no tax ID, no account link and no conversion time', () => {
    const org = new Organization();
    expect(org.taxId ?? null).toBeNull();
    expect(org.personalAccountId ?? null).toBeNull();
    expect(org.convertedToCompanyAt ?? null).toBeNull();
  });
});

describe('OrganizationTaxIdPolicy [unit]', () => {
  const policy = MetadataStorage.getMetadataFromDecorator(OrganizationTaxIdPolicy);
  const policyProperties = policy.properties as unknown as Record<string, EntityProperty | undefined>;

  it('maps the single-row policy table', () => {
    expect(policy.tableName ?? policy.collection).toBe('organization_tax_id_policy');
    expect(Object.keys(policyProperties).sort()).toEqual(
      ['id', 'scope', 'updatedAt', 'updatedByAdminUserId'].sort(),
    );
    expect(policyProperties.id?.primary).toBe(true);
    expect(policyProperties.updatedByAdminUserId?.nullable).toBe(true);
  });

  it('defaults to the global scope', () => {
    expect(new OrganizationTaxIdPolicy().scope).toBe('global');
  });
});

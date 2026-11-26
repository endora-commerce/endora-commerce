/**
 * The one invariant A9's tenants have to satisfy beyond their required
 * properties (`instance-tenancy-probe.ts`).
 *
 * The probe seeds a row from what the entity's metadata says is required, so a
 * nullable column is left out. On `organizations` that is not enough:
 * `organizations_tax_id_presence` (#1034) holds `is_personal = (tax_id is null)`,
 * so a company carries a tax ID and a personal organization does not, and a row
 * with neither is refused. A personal organization also needs the customer
 * account it belongs to, which a tenant written on its own does not have — so
 * the probe's tenants are companies, and a company is given a tax ID here.
 *
 * Only the property is named, never a module: the Organization is the one
 * tenant concept (Principle XI), and an instance whose organizations map no tax
 * ID gets its seed back unchanged.
 */
import { randomUUID } from 'node:crypto';

/** The two facts about a mapped property this needs. */
export interface SeedProperty {
  readonly name: string;
  readonly persist?: boolean;
}

/** The Organization's tax ID property, and its flag for a personal organization. */
const TAX_ID = 'taxId';
const IS_PERSONAL = 'isPersonal';

/**
 * `seed` as a company tenant: a tax ID unique to this call, and `isPersonal`
 * set to `false` where the entity maps it, unless the seed already says
 * otherwise. The tax ID is short enough for the 32-character column and is
 * validated by nothing in the database beyond its presence.
 */
export function companyTenantSeed(
  seed: Readonly<Record<string, unknown>>,
  properties: Readonly<Record<string, SeedProperty>>,
): Record<string, unknown> {
  const taxId = properties[TAX_ID];
  if (taxId === undefined || taxId.persist === false) return { ...seed };
  const out: Record<string, unknown> = { ...seed };
  if (out[TAX_ID] === undefined) out[TAX_ID] = `a9-${randomUUID().slice(0, 13)}`;
  if (properties[IS_PERSONAL] !== undefined && out[IS_PERSONAL] === undefined) {
    out[IS_PERSONAL] = false;
  }
  return out;
}

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `specs/193-admin-form-extensions/` T088, D-300.10 as amended by D-300.31 — the
 * inventory of every place that declares a write buyer self-service.
 *
 * The flag skips a deployment's tightened field rules, and it is honoured on any
 * `system` or `customer` actor with no acting admin, so server code running as
 * `system` could declare itself a buyer. Review is what holds it to the
 * storefront, and this list is what review reads: a new source that sets the
 * flag reds this test until it is added here with the storefront route it
 * serves.
 */

const REPOSITORY = resolve(__dirname, '../../../..');
const ROOTS = ['packages/modules', 'backend/src'];
const FLAG = /\bbuyerSelfService:\s*true\b/;

/** Every source that sets the flag, and why — the storefront write behind it. */
const EXPECTED: Readonly<Record<string, string>> = {
  'packages/modules/organizations/src/backend/commands/register-organization.command.ts':
    'organization.register — POST /api/v1/organizations/register, the storefront business registration.',
  'packages/modules/organizations/src/backend/services/invitation-service.ts':
    'the invitation acceptance — POST /api/v1/organizations/invitations/:token/accept, through CustomerAccountMemberWritePort.create (honoured from WP-E3).',
  'packages/modules/customers/src/backend/services/customer-registration-service.ts':
    'createStandalone — POST /api/v1/customers/register, the storefront individual registration; the only caller passing the option.',
  'packages/modules/customer_accounts/src/backend/services/customer-account-command-port.ts':
    'forwards createStandalone’s option onto the Command; sets nothing on its own.',
  'packages/modules/customer_accounts/src/backend/commands/customer-account-register-standalone.command.ts':
    'puts the caller’s option on customer_account.register_standalone; sets nothing on its own.',
  'packages/modules/customer_accounts/src/backend/commands/customer-account-register-social.command.ts':
    'customer_account.register_social — the federated sign-in the storefront starts (mfa’s social login).',
  'packages/modules/organizations/src/manifest.ts':
    'a doc comment naming the flag; the manifest declares buyerSelfServiceActions, which sets nothing.',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('every source declaring a write buyer self-service (193 T088)', () => {
  it('is in the inventory, with the storefront write it serves', () => {
    const found = ROOTS.flatMap((root) => sources(join(REPOSITORY, root)))
      .filter((path) => FLAG.test(readFileSync(path, 'utf8')))
      .map((path) => relative(REPOSITORY, path))
      .sort();
    expect(found).toEqual(Object.keys(EXPECTED).sort());
  });
});

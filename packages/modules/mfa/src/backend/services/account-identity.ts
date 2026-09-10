import { ERROR_CODES } from '@endora-commerce/contracts';
import type {
  AdminPasswordVerificationPort,
  AdminUserReadPort,
  CustomerAccountReadPort,
  CustomerPasswordVerificationPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The four questions MFA asks the two identity modules about an account
 * (`specs/110-instance-repository/` T118c).
 *
 * All four were `MfaActorBridge` members — closures a composition root wrote,
 * once in `backend/src/composition.ts` and once in
 * `backend/test/helpers/test-server.ts`. None of them was a composition's answer
 * to give: every one is `adminUserReadPort`, `customerAccountReadPort`,
 * `adminPasswordVerificationPort` or `customerPasswordVerificationPort` and
 * nothing else, and the two roots spelled the same body twice — where they
 * spelled it at all. Two of the four the harness did not spell, which is what
 * made them invisible; see the note on each.
 *
 * They are functions of the ports they read rather than of a `ModuleContext`, so
 * `backend/index.ts` supplies the real inputs and this file is testable over a
 * stub with nothing composed.
 *
 * **No `catch` anywhere below, deliberately.** Each call goes through a
 * `lazyPort` proxy that throws `ModuleDisabledError` when its owner is absent,
 * and reading that as "this account has no e-mail" or "the password does not
 * match" is the fail-open the composition checklist's item 7 refuses — on an
 * authentication path, where it is the difference between requiring a second
 * factor and accepting a credential nobody verified. `admin_users` and
 * `customer_accounts` both declare `nonDeactivatable`, so it cannot happen
 * today; the absence of the `catch` is what keeps it fail-closed if that ever
 * changes.
 */

/**
 * The caller's organisation, and the assertion that they may set policy for it
 * (US3, FR-014).
 *
 * Takes the account id rather than the request: who is asking is
 * `customerActorResolver`'s answer, which the platform contributes and eight
 * other modules already read, and asking it a second time here is the duplicate
 * spelling this drain removes.
 */
export function createOrganizationAdminResolver(
  accounts: Pick<CustomerAccountReadPort, 'findById'>,
): (customerAccountId: string) => Promise<{ organizationId: string; actor: string }> {
  return async (customerAccountId) => {
    const account = await accounts.findById(customerAccountId);
    if (!account || account.role !== 'organization_admin' || !account.organizationId) {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        'Organization administrator role required.',
      );
    }
    return { organizationId: account.organizationId, actor: account.id };
  };
}

/** The accounts a bulk 2FA reset by organisation covers (US6, FR-026/028). */
export function createOrganizationCustomerIdsResolver(
  accounts: Pick<CustomerAccountReadPort, 'listByOrganization'>,
): (organizationId: string) => Promise<string[]> {
  return async (organizationId) =>
    (await accounts.listByOrganization(organizationId)).map((account) => account.id);
}

/**
 * The address that labels an authenticator entry.
 *
 * **This is one of the two members no test in the tree could see.** Production
 * contributed it and the harness did not, so under test the label fell back to
 * the subject id and the `otpauth://` URI carried a UUID where a real enrolment
 * carries an e-mail address — a difference every MFA test was blind to, because
 * the one assertion over that URI is `toContain('otpauth://totp/')`.
 *
 * `null` for an account that does not resolve; the route falls back to the
 * subject id, which is a worse label and nothing more.
 */
export function createAccountEmailResolver(
  customers: Pick<CustomerAccountReadPort, 'findById'>,
  admins: Pick<AdminUserReadPort, 'findById'>,
): (subjectType: 'customer' | 'admin', subjectId: string) => Promise<string | null> {
  return async (subjectType, subjectId) =>
    subjectType === 'admin'
      ? ((await admins.findById(subjectId))?.email ?? null)
      : ((await customers.findById(subjectId))?.email ?? null);
}

/**
 * Does the account's stored credential match the password presented?
 *
 * **The other member no test could see**, and the one whose absence changed
 * behaviour rather than a label: `reauthenticate` accepts either a current
 * second factor or the account password before disabling 2FA, and with no
 * verifier the password branch is unreachable, so the harness answered 400
 * `MFA_REAUTH_REQUIRED` where production answers 401 or lets the disable
 * through. Every `/disable` call in the tree passes a code, so nothing ever
 * took the branch that differed.
 *
 * Only the boolean crosses: the hash stays behind each owner's port (T052).
 */
export function createAccountPasswordVerifier(
  customers: CustomerPasswordVerificationPort,
  admins: AdminPasswordVerificationPort,
): (
  subjectType: 'customer' | 'admin',
  subjectId: string,
  password: string,
) => Promise<boolean> {
  return async (subjectType, subjectId, password) =>
    subjectType === 'admin'
      ? admins.verifyPassword(subjectId, password)
      : customers.verifyPassword(subjectId, password);
}

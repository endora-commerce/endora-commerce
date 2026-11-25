import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { Organization } from './package-entities.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * Issue #1893 — a self-registered Organization stays `pending_verification` under the default
 * `manual` moderation until an operator approves it; verifying the first user's e-mail no longer
 * activates it. A test that needs a buyer who can trade approves it the way the operator does,
 * through moderation.
 *
 * Under a system scope: the approval is the `organization.approved` Command
 * (`specs/186-aggregate-ports/` T026), and the Command Bus refuses to run with no
 * ambient actor.
 */
export async function approveRegisteredOrganization(
  h: BackendServerHandle,
  organizationId: string,
): Promise<void> {
  const organization = await h.em().findOneOrFail(Organization, { id: organizationId });
  await withSystemScope('test: approve a self-registered organization', () =>
    h.organizations.moderationService.approve(organizationId, { expectedVersion: organization.version }),
  );
}

/** The Organization id out of a `POST /api/v1/organizations/register` response body. */
export function registeredOrganizationId(register: { json(): unknown }): string {
  return (register.json() as { data: { organization: { id: string } } }).data.organization.id;
}

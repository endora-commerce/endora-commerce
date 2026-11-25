import type { MembershipChangeInput, MembershipPort } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  makeChangeOrganizationCommand,
  toMembershipChangeResult,
  type ChangeOrganizationCommandDeps,
} from '../commands/customer-account-change-organization.command.js';

/**
 * `membershipPort` (`specs/191-membership-join-requests/contracts/membership-port.md`
 * §2), as far as `specs/192-organization-merge/` T069 publishes it: the move
 * and its Command, in the modes `move` and `merge`. 191 WP-1 (#1831) adds
 * `detachToPersonal` here. No permission is checked: the caller is the gate.
 */
export function createMembershipPort(
  deps: ChangeOrganizationCommandDeps & { readonly commandBus: () => Pick<CommandBus, 'run'> },
): MembershipPort {
  const command = (input: MembershipChangeInput) => makeChangeOrganizationCommand(deps, input);
  return {
    async changeOrganization(input) {
      return toMembershipChangeResult(await deps.commandBus().run(command(input)));
    },
    changeCommand: command,
  };
}

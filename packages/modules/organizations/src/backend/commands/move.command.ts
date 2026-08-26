import type { Command } from '@endora-commerce/platform/commands';
import type { Organization } from '../entities/organization.entity.js';
import {
  makeReparentCommand,
  type ReparentCommandDeps,
  type ReparentCommandInput,
} from './set-parent.command.js';

/**
 * `organization.move` (feature 056 US1) — re-parent an existing child. A
 * distinct action from `organization.set_parent` so the audit trail carries a
 * clean "moved" label; the cycle + path-rewrite mechanism is shared (Principle
 * XIII). Reversible — see `set-parent.command.ts`.
 */
export function makeMoveCommand(
  deps: ReparentCommandDeps,
  input: ReparentCommandInput,
): Command<Organization> {
  return makeReparentCommand('organization.move', deps, input);
}

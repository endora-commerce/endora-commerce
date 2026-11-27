import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { OrganizationCreateHookData } from '@endora-commerce/contracts';
import { CommandHookRefusal, type Command, type CommandHookContext } from '@endora-commerce/platform/commands';
import { z } from 'zod';

import { ExampleErpOrganizationKey } from '../entities/example-erp-organization-key.entity.js';
import { EXAMPLE_ERP_KEYS_ERROR_CODES } from '../manifest.js';
import { ERP_KEY_PATTERN, normalizeErpKey } from '../ports.js';

/** What a caller hands `organizationCommandPort.create` as `extensions.example_erp_keys`. */
const ErpKeyInputSchema = z.object({ erpKey: z.string() }).strict();

/** The audited action of the module's one write. */
export const SET_ERP_KEY_ACTION = 'example_erp_keys.key.set';

/**
 * The module's one write, as its own Command (Principle XIII): the side row,
 * on the transaction of whichever Command runs it. Its audit entry names the
 * field, never the key — the key is the tenant's own
 * (`specs/conventions/audit-state.md`).
 *
 * The Organization row is already flushed when a hook runs, so the side row's
 * foreign key has its target; flushing here is what turns a key another
 * Organization holds into this module's own `409` rather than a failure at
 * commit.
 */
export function setErpKeyCommand(organizationId: string, erpKey: string): Command<null> {
  return {
    action: SET_ERP_KEY_ACTION,
    objectType: 'organization',
    objectId: organizationId,
    async run({ em }) {
      em.create(ExampleErpOrganizationKey, { organizationId, erpKey });
      try {
        await em.flush();
      } catch (error) {
        if (error instanceof UniqueConstraintViolationException) {
          throw new CommandHookRefusal(
            409,
            EXAMPLE_ERP_KEYS_ERROR_CODES.KEY_TAKEN,
            'Another organization already holds this ERP key.',
          );
        }
        throw error;
      }
      return { result: null, before: null, after: { changedFields: ['erpKey'] } };
    },
  };
}

/**
 * The `beforeCommit` hook on `organization.create`
 * (`specs/176-command-hooks-outbox/` P2): stores the new Organization's ERP key
 * by running {@link setErpKeyCommand} on the create's own transaction, so the
 * key commits with the Organization or not at all.
 *
 * It acts only when the create carries `extensions.example_erp_keys` — which
 * only a server-side caller can send (no HTTP body carries `extensions`) — so
 * every other create, an administrator's included, passes through untouched.
 * A malformed key is refused before anything is written. Any refusal rolls the
 * whole create back. It names the field it wrote in the create's own entry too.
 */
export async function fillErpKeyOnCreate(ctx: CommandHookContext<OrganizationCreateHookData>): Promise<void> {
  if (ctx.extension === undefined) return;
  const parsed = ErpKeyInputSchema.safeParse(ctx.extension);
  const erpKey = parsed.success ? normalizeErpKey(parsed.data.erpKey) : '';
  if (!ERP_KEY_PATTERN.test(erpKey)) {
    throw new CommandHookRefusal(
      422,
      EXAMPLE_ERP_KEYS_ERROR_CODES.KEY_INVALID,
      'An ERP key is 1–40 letters, digits and hyphens, starting with a letter or a digit.',
    );
  }
  await ctx.run(setErpKeyCommand(ctx.data.organization.id, erpKey));
  ctx.noteAuditChanges(['erpKey']);
}

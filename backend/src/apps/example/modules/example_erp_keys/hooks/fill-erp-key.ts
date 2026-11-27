import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { OrganizationCreateHookData } from '@endora-commerce/contracts';
import { CommandHookRefusal, type CommandHookContext } from '@endora-commerce/platform/commands';
import { z } from 'zod';

import { ExampleErpOrganizationKey } from '../entities/example-erp-organization-key.entity.js';
import { EXAMPLE_ERP_KEYS_ERROR_CODES } from '../manifest.js';
import { ERP_KEY_PATTERN, normalizeErpKey } from '../ports.js';

/** What a caller hands `organizationCommandPort.create` as `extensions.example_erp_keys`. */
const ErpKeyInputSchema = z.object({ erpKey: z.string() }).strict();

/**
 * The `beforeCommit` hook on `organization.create`
 * (`specs/176-command-hooks-outbox/` P2): writes the new Organization's ERP key
 * into this module's side table, on the Command's own transaction.
 *
 * It acts only when the create carries `extensions.example_erp_keys` — which
 * only a server-side caller can send (no HTTP body carries `extensions`) — so
 * every other create, an administrator's included, passes through untouched.
 * The Organization row is already flushed when a hook runs, so the side row's
 * foreign key has its target; flushing here is what turns a key another
 * Organization holds into this module's own refusal rather than a failure at
 * commit. Any refusal rolls the whole create back.
 *
 * It notes the field it wrote, never the value: the key is the tenant's own
 * (`specs/conventions/audit-state.md`).
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
  ctx.em.create(ExampleErpOrganizationKey, { organizationId: ctx.data.organization.id, erpKey });
  try {
    await ctx.em.flush();
  } catch (error) {
    if (error instanceof UniqueConstraintViolationException) {
      throw new CommandHookRefusal(
        409,
        EXAMPLE_ERP_KEYS_ERROR_CODES.KEY_TAKEN,
        'Another Organization already holds this ERP key.',
      );
    }
    throw error;
  }
  ctx.noteAuditChanges(['erpKey']);
}

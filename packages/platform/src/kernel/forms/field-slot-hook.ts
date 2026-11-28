import { ERROR_CODES, type FieldSlotInputInvalidDetail, type FieldWriteForbiddenDetail, type HookableActionRef } from '@endora-commerce/contracts';
import type { z } from 'zod';
import type { CommandHookContext, CommandHookEntry } from '../../commands/hooks/types.js';
import { HttpError } from '../../http/error-envelope.js';
import { forbiddenDetail } from './field-rule-check.js';
import { FIELD_RULE_ERROR_MESSAGES } from './messages.js';
import { ambientPermissionChecker, forbiddenReason } from './permissions.js';

/**
 * The write half of a slot field (`specs/193-admin-form-extensions/` FR-014,
 * `contracts/field-slots.md` §4): a module's value travels in the host
 * Command's `extensions.<moduleId>`, and this builds the `beforeCommit` hooks
 * that validate it, write it to the module's own storage and note the change
 * on the owner's one audit entry. Hand the result to `ctx.commandHooks`.
 *
 * - An absent slice is a no-op: the host write did not touch the module's fields.
 * - An invalid slice is `422 FIELD_SLOT_INPUT_INVALID`, each issue at
 *   `extensions.<moduleId>.<key>` so the form puts it on the field.
 * - `write` returns the names of the fields it changed. A changed key whose
 *   `writePermissions` code the actor lacks is `403 FIELD_WRITE_FORBIDDEN` —
 *   asked after the write, so a key the write left as it was costs no
 *   permission, and thrown, so the whole Command rolls back.
 * - The changed names go to `noteAuditChanges`.
 *
 * ```ts
 * ctx.commandHooks(fieldSlotHook({
 *   id: 'erp-code',
 *   on: [ORGANIZATION_HOOKABLE_ACTIONS.create, ORGANIZATION_HOOKABLE_ACTIONS.adminPatch],
 *   schema: z.strictObject({ code: z.string().max(16).optional() }),
 *   write: async ({ em, objectId }, slice) => { … upsert the side row … return ['code']; },
 * }));
 * ```
 */
export interface FieldSlotHookSpec<S extends z.ZodType> {
  /** Kebab-case. With one writer it is the hook id; with several, each id is suffixed with the action. */
  readonly id: string;
  /** The field set's writers this slot extends; slot fields attach to hookable writers only. */
  // A ref's data types are the owner's; `any` is the bound that lets any ref through.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly on: readonly HookableActionRef<any, any>[];
  /** The slice: `{ <localKey>: value }`, every key optional (a partial write). */
  readonly schema: S;
  /** Local key → the permission code a change to it needs. */
  readonly writePermissions?: Readonly<Record<string, string>>;
  /** Write the slice to the module's own storage on `ctx.em`; answer the names of the fields it changed. */
  readonly write: (ctx: CommandHookContext<unknown>, slice: z.infer<S>) => Promise<readonly string[]>;
}

const slug = (action: string): string => action.replace(/[._]+/gu, '-');

function invalid(moduleId: string, issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string; readonly keys?: readonly string[] }[]): HttpError {
  const details: FieldSlotInputInvalidDetail[] = issues.map((issue) => {
    const path = issue.path.map(String);
    return { path: ['extensions', moduleId, ...path].join('.'), issue: issue.message };
  });
  return new HttpError(422, ERROR_CODES.FIELD_SLOT_INPUT_INVALID, FIELD_RULE_ERROR_MESSAGES.FIELD_SLOT_INPUT_INVALID, details);
}

export function fieldSlotHook<S extends z.ZodType>(spec: FieldSlotHookSpec<S>): CommandHookEntry[] {
  const handler = async (ctx: CommandHookContext<unknown>): Promise<void> => {
    if (ctx.extension === undefined) return;
    const moduleId = ctx.module.id;
    const parsed = spec.schema.safeParse(ctx.extension);
    if (!parsed.success) throw invalid(moduleId, parsed.error.issues);
    const changed = await spec.write(ctx, parsed.data as z.infer<S>);
    const forbidden: FieldWriteForbiddenDetail[] = [];
    for (const key of [...new Set(changed)].sort()) {
      const permission = spec.writePermissions?.[key];
      if (permission === undefined) continue;
      const reason = await forbiddenReason(ctx.actor, permission, ambientPermissionChecker);
      if (reason !== null) forbidden.push(forbiddenDetail(`extensions.${moduleId}.${key}`, permission, reason));
    }
    if (forbidden.length > 0) {
      throw new HttpError(403, ERROR_CODES.FIELD_WRITE_FORBIDDEN, FIELD_RULE_ERROR_MESSAGES.FIELD_WRITE_FORBIDDEN, forbidden as unknown as Record<string, unknown>);
    }
    if (changed.length > 0) ctx.noteAuditChanges(changed);
  };
  return spec.on.map(
    (ref): CommandHookEntry => ({
      id: spec.on.length === 1 ? spec.id : `${spec.id}-${slug(ref.action)}`,
      on: ref,
      phase: 'beforeCommit',
      handler,
    }),
  );
}

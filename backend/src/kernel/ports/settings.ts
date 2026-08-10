import type { z } from 'zod';

/**
 * Kernel port — settings read (feature 072, D-32).
 *
 * The settings **store** (entities, resolver, cache, secret codec and the
 * manifest reconciler) is kernel-owned: boot and lifecycle gating both need it.
 * The admin service, its routes and the storefront resolvers stay in the
 * `settings` module.
 *
 * **Why this port is read-only, against `tasks.md` T014's "read/write".** There
 * are exactly two writers of a setting value in the tree and neither belongs
 * behind a kernel port:
 *
 *  - `settings/services/settings-admin.service.ts` — the audited, optimistically
 *    locked, channel-subset-aware admin write. It carries an `AdminAuditContext`
 *    and the module-activation policy, so it is module-owned by D-32 and stays
 *    on the module's own surface.
 *  - `kernel/settings/manifest-reconciler.ts` — kernel-internal since T018, and
 *    a component does not reach itself through a port.
 *
 * Inventing a third, portable write shape would be a speculative abstraction
 * with no caller. When a cross-module write appears, it goes here.
 */
export interface SettingsReadPort {
  /**
   * Read one setting for a sales channel and validate it against the caller's
   * schema.
   *
   * @throws `SettingNotRegistered` when no setting carries `code`.
   * @throws `SettingOutOfScopeForChannel` when the setting is scoped to other channels.
   * @throws `SettingValueShapeMismatch` when the stored value fails `schema`.
   */
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;

  /**
   * Batch read. Every code resolves independently, so one missing code does not
   * poison the batch — per-code failures come back as `{ ok: false, error }`.
   */
  getMany(
    codes: string[],
    salesChannelId: string,
  ): Promise<Map<string, SettingsReadResult<unknown>>>;
}

/** One entry of a {@link SettingsReadPort.getMany} result. */
export type SettingsReadResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: 'not_registered' | 'out_of_scope' | 'shape_mismatch';
      details?: unknown;
    };

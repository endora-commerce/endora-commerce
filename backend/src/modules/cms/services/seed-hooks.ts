// Seeded base Hook codes — feature 014 / R8 / T030.
//
// The 23 codes here are recognised natively by the storefront's named
// insertion points. The reconciler is idempotent: re-running it preserves
// admin-edited names + descriptions and re-creates a system Hook only if
// it is somehow missing. Runs at composition time before HTTP routes
// start serving (called from composition.ts), and inside the migration
// (035_cms_init.ts) so first boot doesn't race.

import type { EntityManager } from '@mikro-orm/postgresql';
import { CmsHook } from '../entities/cms-hook.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

export interface SeededHook {
  code: string;
  name: string;
  description?: string;
}

export const SEEDED_HOOKS: ReadonlyArray<SeededHook> = [
  {
    code: 'header.top',
    name: 'Header Top',
    description: 'Top-of-page strip — phone number, free-shipping notice, etc.',
  },
  { code: 'homepage.top', name: 'Homepage Top', description: 'Above the homepage content.' },
  { code: 'homepage.bottom', name: 'Homepage Bottom', description: 'Below the homepage content.' },
  { code: 'footer.before', name: 'Footer Before' },
  { code: 'footer.top', name: 'Footer Top' },
  { code: 'footer.bottom', name: 'Footer Bottom' },
  { code: 'footer.after', name: 'Footer After' },
  { code: 'footer.copyright', name: 'Footer Copyright' },
  { code: 'category.top', name: 'Category Page Top' },
  { code: 'category.bottom', name: 'Category Page Bottom' },
  { code: 'product.top', name: 'Product Page Top' },
  { code: 'product.bottom', name: 'Product Page Bottom' },
  { code: 'product.buttons.after', name: 'Product Page After Buttons Set' },
  { code: 'search.top', name: 'Search Page Top' },
  { code: 'search.bottom', name: 'Search Page Bottom' },
  { code: 'page.top', name: 'Every Page Top' },
  { code: 'page.bottom', name: 'Every Page Bottom' },
  { code: 'cms.page.top', name: 'Every CMS Page Top' },
  { code: 'cms.page.bottom', name: 'Every CMS Page Bottom' },
  { code: 'login.top', name: 'Login Page Top' },
  { code: 'login.bottom', name: 'Login Page Bottom' },
  { code: 'register.top', name: 'Register Page Top' },
  { code: 'register.bottom', name: 'Register Page Bottom' },
];

export interface SeedHooksReconcileResult {
  inserted: number;
  preservedExisting: number;
}

/**
 * Idempotent reconciler. Existing rows (matched by code) are preserved
 * untouched — admin-edited names + descriptions survive every run.
 * Missing seeded codes are inserted with `is_system=true`. Every seeded
 * hook is also (re-)bound to every existing sales channel via
 * `cms_hook_sales_channels` so the storefront's per-channel resolution
 * sees the hook even after `sales_channels` was truncated (e.g. between
 * test runs — the bindings cascade-deleted with the channels).
 */
export async function reconcileSeededHooks(
  emFactory: () => EntityManager,
): Promise<SeedHooksReconcileResult> {
  // command-coverage-ignore: idempotent boot seed/reconcile of module-declared CMS
  // hooks — a system-invariant repair, not an operator-initiated audited write.
  const em = emFactory();
  const existing = await em.find(CmsHook, { isSystem: true });
  const existingByCode = new Map(existing.map((h) => [h.code, h]));
  let inserted = 0;
  for (const seed of SEEDED_HOOKS) {
    if (existingByCode.has(seed.code)) continue;
    const hook = em.create(CmsHook, {
      name: seed.name,
      code: seed.code,
      active: true,
      description: seed.description ?? null,
      isSystem: true,
    });
    em.persist(hook);
    inserted += 1;
  }
  if (inserted > 0) await em.flush();

  /**
   * The channel ids come from the kernel's own entity, not from a
   * `cross join "sales_channels"` (feature 075, D-87). `sales_channels` is the
   * kernel's table since feature 072 moved the resolution machinery there, and
   * a module relating into the kernel by ORM is the sanctioned access. The
   * binding insert stays one set-based statement over this module's own two
   * tables, with one ordinary binding per channel id.
   */
  const channelIds = (await em.find(SalesChannel, {}, { fields: ['id'] })).map((c) => c.id);
  if (channelIds.length > 0) {
    const channelValues = channelIds.map(() => '(?::uuid)').join(', ');
    await em.execute(
      `insert into "cms_hook_sales_channels" ("hook_id", "sales_channel_id")
       select h."id", c."id"
       from "cms_hooks" h
       cross join (values ${channelValues}) as c("id")
       where h."is_system" = true
         and not exists (
           select 1 from "cms_hook_sales_channels" x
           where x."hook_id" = h."id" and x."sales_channel_id" = c."id"
         )`,
      channelIds,
    );
  }

  return { inserted, preservedExisting: existing.length };
}

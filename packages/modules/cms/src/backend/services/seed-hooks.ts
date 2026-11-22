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
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { LANGUAGE_FALLBACK, type SupportedLanguage } from '@endora-commerce/contracts';

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

const SEEDED_BY_CODE = new Map(SEEDED_HOOKS.map((hook) => [hook.code, hook]));

/** The `cms` bundle key holding a seeded hook's name or description. */
export function seededHookKey(code: string, field: 'name' | 'description'): string {
  return `seededHooks.${code}.${field}`;
}

/** Looks a key up in this module's bundle; answers `cms.<key>` (or the key) when it has none. */
export type CmsBundleTranslate = (key: string, language: SupportedLanguage) => Promise<string>;

/**
 * A hook as the admin reads it, in the reader's language (issue #1809).
 *
 * A seeded hook's name and description are **platform prose** while they are
 * the text this file seeded, and **operator content** once an operator has
 * changed them (`specs/conventions/module-i18n.md`, the four kinds). The
 * column is one string, so the seeded English is what it holds; a response the
 * backend can resolve a language for translates that value from this module's
 * bundle and passes anything else — an edited value, a custom hook — through as
 * stored. English is the stored text itself, and a missing key or a failed
 * lookup answers it too: a hook list must never render a key.
 */
export async function localizeSeededHook<
  T extends { code: string; name: string; description: string | null; isSystem: boolean },
>(hook: T, language: SupportedLanguage, translate: CmsBundleTranslate): Promise<T> {
  const seed = hook.isSystem ? SEEDED_BY_CODE.get(hook.code) : undefined;
  if (!seed || language === LANGUAGE_FALLBACK) return hook;
  const translated = async (field: 'name' | 'description', stored: string): Promise<string> => {
    const key = seededHookKey(hook.code, field);
    try {
      const text = await translate(key, language);
      return text === key || text === `cms.${key}` || text === '' ? stored : text;
    } catch {
      return stored;
    }
  };
  const name = hook.name === seed.name ? await translated('name', hook.name) : hook.name;
  const description =
    seed.description !== undefined && hook.description === seed.description
      ? await translated('description', hook.description)
      : hook.description;
  return { ...hook, name, description };
}

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

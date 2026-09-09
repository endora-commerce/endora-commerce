/**
 * The demo rows that have not reached their own modules yet (feature 113,
 * T211/T213 — `specs/113-module-owned-demo-data/` §2 and §3).
 *
 * After T224 that is **one block: the demo's two sales channels**, and it is
 * worth saying plainly why it is still here rather than gone with the rest.
 *
 * `sales_channels` is the **kernel's** table — it moved there with the channel
 * resolution machinery in feature 072 — so there is no module to declare it as
 * demo data (§2.1), and the kernel has no `demo` manifest field and no
 * activation control to gate one on. That leaves the instance composition,
 * which is where every other ownerless demo write in this feature went. It
 * cannot go there either, and the reason is **order** rather than ownership:
 * `runDemo` applies the composition *after* every module's `seed` (§5.5), and
 * `inventory`'s body assigns the demo warehouse to every channel it finds. A
 * channel created after that runs is a channel with no warehouse behind it, and
 * `pl_b2b_vip` would silently drop out of `warehouse_channel_assignments`.
 *
 * So the last block needs a seam that runs **before** the modules, and the only
 * one an instance has is this file — `cli.ts` calls it in a module's place, on
 * the way in before the composition is applied. Giving the platform such a seam
 * is a change to `@endora-commerce/platform`'s runner and is what T226 is
 * blocked on; it is recorded in that task rather than worked around here.
 *
 * Everything else has gone: the identities, the delivery and payment methods,
 * the second warehouse, the Polish VAT rate and the whole catalogue (T220,
 * T222, T223, T224). It is not a home, it is a queue, and it is one item long.
 *
 * It is a **module** rather than a script so that both entry points can run it:
 * `dev-catalog-seed.ts` (the developer bootstrap) and `endora demo seed`, which
 * runs it where a module's own `seed` would run. Two callers, one corpus; a
 * residue that only one of them could reach would make the two seeds different
 * shops, which is exactly what `test/integration/demo/demo-parity.test.ts`
 * refuses.
 *
 * Nothing here opens a database, opens a scope or checks the guard. All three
 * are the entry point's (§3.3, §3.4), which is what lets this file be called
 * from a composed CLI and from a bare script without either of them deciding
 * something the other has already decided.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '../kernel/sales-channels/sales-channel.entity.js';

/** What the caller prints. Counted here because only this file knows. */
export interface HostResidueSummary {
  readonly salesChannels: number;
}

/**
 * Withdraw the residue's rows (T213).
 *
 * This is the `truncate table ... cascade` that used to open the seed, moved
 * to where a withdrawal belongs. It stays one statement over one list while
 * the rows it removes are one file's; every module that takes its block back
 * in Phase 2 takes its tables out of this list with it, and the list is empty
 * on the day the file is deleted.
 *
 * **Moving it is a repair and not only a tidy-up.** At the head of `seed` it
 * ran on a freshly migrated database and destroyed rows four migrations had
 * seeded — 15 payment methods, 4 delivery methods and 15 adapter rule rows,
 * measured — so a developer's `seed:dev` silently took the platform's own
 * data away. A withdrawal that an operator asks for by name may do that; a
 * seed may not.
 *
 * **T220 took `taxes`, `delivery_methods` and `payment_methods` off the list**,
 * and that is the second half of the same repair. Each of those modules now
 * withdraws its own demo rows by the fixed codes its `seed` assigns (contract
 * §2.5), so the reset stops taking the rows this file never created: the five
 * gateway modules' migration-seeded methods, their adapter rules, and whatever
 * the operator added. A truncate cannot tell a demo row from an operator's, and
 * that is exactly why it may not be the withdrawal for a table this file has
 * stopped writing.
 *
 * **T222 took four more off it, and one of them is the sharpest case in the
 * whole list.** `admin_roles`, `admin_users` and `organizations` are their own
 * modules' now, and `customer_accounts` goes with them because the buyer has
 * been the composition's since Phase 1 and this file has not written that table
 * since. `organizations` is the one worth naming: an organisation is the tenant
 * every buyer, address, cart, quote request and order hangs off (Principle XI),
 * so `truncate organizations cascade` took a developer's entire test tenancy
 * with it, silently, on every `seed:dev` — and the `credit_limits` rows it
 * removed through the same cascade are withdrawn by the composition's own step
 * now. `admin_roles` is the second: `blog` and `cms` seed a role apiece from
 * their boot hooks and share that table, and the cascade from it reached
 * `admin_users`.
 */
export async function resetHostModuleResidue(em: EntityManager): Promise<void> {
  const conn = em.getConnection();
  // In dependency order. Everything `catalog`, `custom_fields` and
  // `assets_library` own left this statement with T224 — 14 tables and the two
  // `custom_field_*` deletes — because the block that wrote them left too, and
  // the withdrawal for a table this file no longer writes may not be a
  // truncate. What each of those rows is withdrawn by now is written where it
  // is created: `catalog`'s `reset`, or the composition step that paired the
  // rows in the first place, and every one of them is filtered.
  await conn.execute(`
    truncate table
      sales_channel_products,
      product_categories,
      megamenu_bindings,
      megamenu_items,
      megamenus,
      sales_channels,
      price_list_assignments,
      price_list_items,
      price_lists
    cascade
  `);
}

/**
 * Create the residue's rows.
 *
 * The caller has opened the database, entered a system scope and passed the
 * production guard. Runs before the composition, which is where a module's own
 * `seed` runs (§5.5).
 */
export async function seedHostModuleResidue(em: EntityManager): Promise<HostResidueSummary> {
  // --- Sales Channels --------------------------------------------------
  //
  // The retail channel **adopts the instance's system-default channel if there
  // already is one**, and creates it otherwise. Both branches are reached in
  // practice and the difference is the entry point, not the database:
  // `endora demo seed` composes the platform first, and one of the boot
  // reconcilers inserts a `default` system-default channel into an empty table
  // (D-47…D-51 — exactly one always exists, and the platform is what
  // guarantees it). `seed:dev` boots nothing, so it finds none.
  //
  // Creating a second one is not an option: `sales_channels_one_system_default`
  // is a real unique index and the insert fails outright — measured, on the
  // first composed run of this file. Nor is leaving the platform's placeholder
  // beside the demo's own channel: `sales_channel_id` is what every
  // channel-scoped setting, warehouse assignment and product binding is keyed
  // on, so a demo that ignores the incumbent leaves the instance's *actual*
  // default channel selling nothing.
  //
  // The public channel doubles as the system default so header-less requests
  // (anonymous storefront, direct API hits) resolve here instead of tripping
  // the resolver's "registry empty" guard. Without it the reconciler would
  // promote the lexically-first channel — `pl_b2b_vip`, logged-in only, the
  // wrong default for a storefront.
  const incumbent = await em.findOne(SalesChannel, { systemDefault: true });
  const retail =
    incumbent ??
    em.create(SalesChannel, {
      code: 'pl_retail',
      systemDefault: true,
      defaultLanguage: 'pl-PL',
      defaultCurrency: 'PLN',
    });
  retail.code = 'pl_retail';
  retail.name = { 'en-US': 'PL Retail', 'pl-PL': 'PL Retail' };
  retail.isPublic = true;
  retail.languages = ['pl-PL', 'en-US'];
  retail.defaultLanguage = 'pl-PL';
  retail.currencies = ['PLN', 'EUR'];
  retail.defaultCurrency = 'PLN';
  retail.active = true;
  retail.status = 'active';
  em.persist(retail);
  // Probed rather than created outright, which is contract §2.4's idempotence
  // applied to the one block that is not a module's. Until T224 this line was
  // the *only* thing in a demo seed that a second run could not survive — every
  // module body and every composition step probes its own natural key — so a
  // second `endora demo seed` died here on `sales_channels_code_unique` and
  // SC-007 could not be asserted at the command level at all.
  const existingVip = await em.findOne(SalesChannel, { code: 'pl_b2b_vip' });
  const b2bVip =
    existingVip ??
    em.create(SalesChannel, {
      code: 'pl_b2b_vip',
      name: { 'en-US': 'PL B2B VIP', 'pl-PL': 'PL B2B VIP' },
      isPublic: false,
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN', 'EUR'],
      defaultCurrency: 'PLN',
    });
  await em.persistAndFlush([retail, b2bVip]);

  // The category tree, the 200 products, the three composites and their own
  // structure are `catalog`'s demo data now (feature 113, T224): that module
  // declares them in its `manifest.ts` and creates them from its own
  // `src/backend/demo/`.
  //
  // Three blocks that sat between them went to the **composition** instead,
  // each because it writes two modules' rows in one statement (§5.1): the
  // product attributes, which pair a `custom_fields` definition to a `catalog`
  // extension row and to the Default attribute set; the placeholder images,
  // which mint an `assets_library` asset per gallery position; and the sample
  // attachments, which mint two more.

  // The demo administrators, the two roles they hold, the demo organisation and
  // the credit limit granted to it are their own modules' demo data now
  // (feature 113, T222).
  //
  // `admin_roles`, `admin_users` and `organizations` each declare theirs in
  // their own `manifest.ts` and create them from their own `src/backend/demo/`.
  // The two **links** the block used to write in the same statements are the
  // instance composition's, because each is two modules' rows at once: which
  // account holds which role is step 6 of `demo-composition.ts`, and the grant
  // against the demo organisation is step 7.
  //
  // The demo buyer's account was already the composition's, since Phase 1:
  // `customer_accounts.organization_id` is `NOT NULL` (Principle XI), so there
  // is no "create the account, then join it" to lift — see step 5.

  // `inventory`'s second warehouse and its channel assignments are that
  // module's own demo data now (T223).

  // `taxes`' Polish VAT rule is that module's own demo data now (T220).

  return { salesChannels: 2 };
}

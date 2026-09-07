/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent — *"the `./migrations` export of
 * @endora-commerce/mod-blog exports no 'migrations' array"*. Until D-168's
 * merge request this file published only `export *`, so an installed `blog`
 * did not merely lose its schema, it stopped the platform from booting; the
 * defect was invisible because a workspace member is not an installed package
 * and the committed host registry names the class directly. That is the same
 * silence D-168 found on `./backend`, one subpath along.
 *
 * The **named** export stays, and the asymmetry with `./backend` is deliberate.
 * `db/migrations-registry.generated.ts` imports each class by name from this
 * specifier and hands it to `migration('blog', …)`, and a migration class name
 * is contract in a way an entity class name is not: `mikro_orm_migrations`
 * persists it, so it is a string every already-migrated database holds. It also
 * carries none of the hazard D-168 removes — no module has a reason to name
 * another module's migration, and doing so buys nothing an entity import buys.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom is
 * a query against a table nobody created. The composer refuses a migration file
 * no declared subpath covers for exactly that reason, but it cannot see whether
 * the barrel behind the subpath actually carries the class — that is this
 * file's job.
 */

import { Migration20260506T081055BlogInit } from './20260506T081055_blog_init.js';
import { Migration20260903T101744BlogNamespaceBlockNames } from './20260903T101744_blog_namespace_block_names.js';

export const migrations = [
  Migration20260506T081055BlogInit,
  Migration20260903T101744BlogNamespaceBlockNames,
];

export {
  Migration20260506T081055BlogInit,
  Migration20260903T101744BlogNamespaceBlockNames,
};

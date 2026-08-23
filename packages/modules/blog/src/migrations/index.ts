/**
 * The `./migrations` subpath — every migration class this module owns.
 *
 * `db/migrations-registry.generated.ts` imports each class by name from this
 * specifier and hands it to `migration('blog', …)`, so a class that is not
 * re-exported here is a migration that does not run: `migration:pending`
 * reports nothing pending and the first symptom is a query against a table
 * nobody created. The composer refuses a migration file no declared subpath
 * covers for exactly that reason, but it cannot see whether the barrel behind
 * the subpath actually carries the class — that is this file's job.
 */
export * from './20260506T081055_blog_init.js';

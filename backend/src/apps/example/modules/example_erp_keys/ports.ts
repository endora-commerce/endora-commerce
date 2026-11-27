import { z } from 'zod';

/**
 * `example_erp_keys`' published surface — the one file a sibling overlay module
 * may import, and only with `import type`
 * (`specs/190-overlay-full-modules/contracts/overlay-ports.md` §2). Promoted to
 * a package, it becomes the package's `./ports` subpath (`overlay-module-layout.md` §5).
 *
 * Two things are published, and both are this module's contract rather than
 * core's — no core contract names a third-party extension
 * (`specs/187-side-table-extensions/contracts/extension-attributes-read-ports.md` §1):
 *
 *  - the value `organizationDetailsPort` attaches under
 *    `extensions.example_erp_keys` when a read names the module in `include`;
 *  - `exampleErpKeysPort`, for a caller that starts from a key — an ERP import
 *    matching an inbound record to an Organization.
 *
 * The schema and the normaliser below are values: the module's own code uses
 * them, and a consumer in another package would import them from the package's
 * runtime export once promoted. Between overlay modules only the types cross.
 */

/** An ERP key as stored: upper-case letters, digits and hyphens, 1–40 characters. */
export const ERP_KEY_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,39}$/;

/**
 * What a typed or imported key becomes before it is judged (Postel): surrounding
 * whitespace dropped, letters upper-cased. Everything else is the caller's.
 */
export function normalizeErpKey(input: string): string {
  return input.trim().toUpperCase();
}

/** The extension attribute's value on an Organization record. */
export const ExampleErpKeyExtensionSchema = z.object({ erpKey: z.string().regex(ERP_KEY_PATTERN) }).strict();
export type ExampleErpKeyExtension = z.infer<typeof ExampleErpKeyExtensionSchema>;

/** One row of the admin list. */
export interface ExampleErpKeyRow {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly erpKey: string;
}

/**
 * Registered as `exampleErpKeysPort` with `ctx.di.providePort`, so it fails
 * closed (503 `MODULE_DISABLED`) while the module is off. Every method reads in
 * the caller's tenant context: an Organization the caller may not see has no
 * key, and a key held by one has no Organization.
 */
export interface ExampleErpKeysPort {
  /** The Organization's ERP key, or `null` when it has none or the caller may not see it. */
  keyOf(organizationId: string): Promise<string | null>;
  /** The Organization holding `erpKey` (normalised first), or `null`. */
  organizationIdOf(erpKey: string): Promise<string | null>;
}

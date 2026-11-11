import { z } from 'zod';
import { CUSTOM_FIELD_HOST_BINDINGS } from './custom-fields.js';

/**
 * Declared extension columns on core tables (`specs/178-extensible-columns/`)
 * — the wire half (FR-050, data-model §7).
 *
 * An installed module package may declare additive `x_<moduleId>_*` columns on
 * a custom-field host table. The declaration API, the generated DDL and the
 * accessor are `@endora-commerce/platform/kernel`'s; what lives here is what a
 * consumer of an admin read sees: the `?extensions=` query parameter and the
 * `extensions` attribute a host record gains when it names a module.
 */

/** A table an extension may declare columns on — derived from {@link CUSTOM_FIELD_HOST_BINDINGS}. */
export type ExtensibleHostTable =
  (typeof CUSTOM_FIELD_HOST_BINDINGS)[keyof typeof CUSTOM_FIELD_HOST_BINDINGS]['table'];

/**
 * Every extensible host table, derived and never listed (OD-15): every
 * custom-field host table is extensible. Which of them the platform has rolled
 * out is the platform's, not this package's.
 */
export const EXTENSIBLE_HOST_TABLES: readonly ExtensibleHostTable[] = [
  ...new Set(Object.values(CUSTOM_FIELD_HOST_BINDINGS).map((binding) => binding.table)),
];

/** A module id as an extension names it — the manifest id grammar without a leading underscore. */
const extensionModuleIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

/**
 * `?extensions=<moduleId>[,<moduleId>…]`, at most eight, merged into an
 * extensible host's admin detail and list query schemas (FR-051).
 */
export const ExtensionsQuerySchema = z.object({
  extensions: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(,[a-z][a-z0-9_]*){0,7}$/)
    .optional(),
});
export type ExtensionsQuery = z.infer<typeof ExtensionsQuerySchema>;

/**
 * `extensions` on a host record: per requested module, its declared keys and
 * their values. Present only when the request named the module and the module
 * exposes the host on admin reads (FR-052).
 */
export const ExtensionAttributesSchema = z.record(
  extensionModuleIdSchema,
  z.record(z.string(), z.json()),
);
export type ExtensionAttributes = z.infer<typeof ExtensionAttributesSchema>;

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

/** At most this many module keys in one write's `extensions` (FR-013). */
export const ENTITY_EXTENSIONS_INPUT_MAX = 8;

/**
 * `extensions` on an adopting host's admin create and update bodies
 * (`specs/193-admin-form-extensions/` FR-013, `contracts/field-slots.md` §4):
 * per module id, that module's slice — its slot fields' values keyed by local
 * key — forwarded unchanged to the host Command's `extensions`. Each slice is
 * validated by its own module's hook (`fieldSlotHook`); a key no present hook
 * module on the action claims is refused `422 COMMAND_EXTENSION_UNCLAIMED`
 * before anything is written. At most {@link ENTITY_EXTENSIONS_INPUT_MAX} keys.
 */
export const EntityExtensionsInputSchema = z
  .record(extensionModuleIdSchema, z.unknown())
  .refine((extensions) => Object.keys(extensions).length <= ENTITY_EXTENSIONS_INPUT_MAX, {
    message: `At most ${ENTITY_EXTENSIONS_INPUT_MAX} module keys.`,
  });
export type EntityExtensionsInput = z.infer<typeof EntityExtensionsInputSchema>;

/**
 * `extensions` on a host record: per requested module, its declared columns'
 * keys and their values, or its side-table loader's object keyed by field
 * (`specs/193-admin-form-extensions/` FR-015, D-300.24) — `null` when the
 * module is served but the record has no value (D-300.25). Present only when
 * the request named the module and the module exposes the host on admin reads
 * (FR-052); an absent key means the module is not served there.
 */
export const ExtensionAttributesSchema = z.record(
  extensionModuleIdSchema,
  z.record(z.string(), z.json()).nullable(),
);
export type ExtensionAttributes = z.infer<typeof ExtensionAttributesSchema>;

/**
 * Owner: `pim_connector` — the PIM locale mapping contract shared by every PIM connector and by
 * `import_export`'s import profiles. Feature 168 (`specs/168-product-editor-scope-switcher/
 * contracts/pim-locale-mapping.md`; research R13; FR-040…FR-047).
 *
 * A connector (or a CSV profile) states which source locale — optionally from which source
 * channel — feeds which Endora (channel, language) scopes, and which source locale writes Global.
 * The planner turns per-locale source values into scoped writes; values of a locale nothing maps
 * are written nowhere (FR-041). The connectors themselves live outside this repository and
 * configure the mapping in their own screens (FR-045).
 */

import { z } from 'zod';
import { uuidSchema } from './common.js';
import type { PimFieldPath } from './pim-connector.js';
import { fieldScopeSpec, type FieldPath, type ScopeLevel, type ScopeRef } from './product-scope-model.js';
import type { ScopedWriteOp } from './scoped-write-encoding.js';

/** A source locale tag in a PIM's or BCP-47 spelling: `pl_PL`, `pl-PL`, `pl`. */
export const pimLocaleTagSchema = z.string().regex(/^[a-z]{2,3}([_-][A-Za-z]{2})?$/, 'locale tag');

/** An Endora channel content language as a target names it (BCP-47, case-insensitive). */
export const pimTargetLanguageSchema = z.string().max(16).regex(/^[a-z]{2,3}(-[a-z]{2})?$/i, 'BCP-47 language tag');

/** Whether two source locale tags are the same locale: case-insensitive, `_` ≡ `-`. */
export function sameSourceLocale(a: string, b: string): boolean {
  return a.replace('_', '-').toLowerCase() === b.replace('_', '-').toLowerCase();
}

export const pimLocaleMappingTargetSchema = z.object({ channelId: uuidSchema, languageCode: pimTargetLanguageSchema }).strict();

export const pimLocaleMappingEntrySchema = z
  .object({
    sourceLocale: pimLocaleTagSchema,
    /** The PIM's channel / scope code; `null` = any source channel. */
    sourceChannel: z.string().min(1).max(100).nullable(),
    targets: z.array(pimLocaleMappingTargetSchema).min(1).max(64),
  })
  .strict();
export type PimLocaleMappingEntry = z.infer<typeof pimLocaleMappingEntrySchema>;

function hasNoDuplicateEntry(entries: readonly PimLocaleMappingEntry[]): boolean {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.sourceLocale.replace('_', '-').toLowerCase()}|${entry.sourceChannel ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export const pimLocaleMappingEntriesSchema = z
  .array(pimLocaleMappingEntrySchema)
  .max(500)
  .refine(hasNoDuplicateEntry, { message: 'Two entries map the same source locale and source channel.' });

export const pimLocaleMappingSchema = z
  .object({
    /** The source locale whose localizable values are written to Global (FR-047); `null` = none. */
    sourceLanguageForGlobal: pimLocaleTagSchema.nullable(),
    entries: pimLocaleMappingEntriesSchema,
  })
  .strict();
export type PimLocaleMapping = z.infer<typeof pimLocaleMappingSchema>;

/** A source value: a plain value (= set) or an already decoded op. */
export type PimSourceValue = unknown;

export interface PimSourceValues {
  /** Non-localizable attributes and fields — always written to Global (FR-047). */
  global: Partial<Record<FieldPath, PimSourceValue>>;
  /** Localizable values per source locale (and optional source channel). */
  perLocale: Array<{ locale: string; sourceChannel: string | null; values: Partial<Record<FieldPath, PimSourceValue>> }>;
}

export interface PlannedWrite {
  scope: ScopeRef;
  field: FieldPath;
  op: ScopedWriteOp<unknown>;
}

export interface LocaleWritePlan {
  writes: PlannedWrite[];
  /** Run warning (FR-041): source groups nothing maps, written nowhere. */
  unmapped: Array<{ locale: string; sourceChannel: string | null }>;
  /** Per product (FR-042): mapped targets the product is not valid for. */
  skipped: Array<{ scope: ScopeRef; reason: 'not_a_member' | 'language_not_offered' }>;
}

function isOp(raw: unknown): raw is ScopedWriteOp<unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const op = (raw as { op?: unknown }).op;
  if (op === 'set') return 'value' in raw && Object.keys(raw).length === 2;
  return (op === 'empty' || op === 'inherit') && Object.keys(raw).length === 1;
}

function toOp(raw: PimSourceValue): ScopedWriteOp<unknown> {
  return isOp(raw) ? raw : { op: 'set', value: raw };
}

function baseOf(tag: string): string {
  return tag.toLowerCase().split('-')[0]!;
}

/**
 * The channel's own spelling of `languageCode`: an exact case-insensitive match, else the one
 * channel language sharing its base language (`pl` → `pl-PL`); `null` when the channel does not
 * offer it (or the base is ambiguous).
 */
function channelSpelling(languages: readonly string[], languageCode: string): string | null {
  const exact = languages.find((language) => language.toLowerCase() === languageCode.toLowerCase());
  if (exact !== undefined) return exact;
  const sameBase = languages.filter((language) => baseOf(language) === baseOf(languageCode));
  return sameBase.length === 1 ? sameBase[0]! : null;
}

function scopeKey(field: string, scope: ScopeRef): string {
  if (scope.level === 'global') return `${field}@G`;
  if (scope.level === 'channel') return `${field}@${scope.channelId}`;
  return `${field}@${scope.channelId}/${scope.languageCode.toLowerCase()}`;
}

/**
 * Plan the scoped writes of one product's source values (`pim-locale-mapping.md` §2):
 *
 * 1. `global` → Global.
 * 2. The group of `sourceLanguageForGlobal` → Global, **and** its mapped targets if any.
 * 3. A group matched by an entry → each target as C×L. An entry with a source channel matches only
 *    that source channel and wins over an entry with `null` for the same locale.
 * 4. A group nothing matches (and not the Global source) → `unmapped`, written nowhere.
 * 5. A target outside `validScopes` → `skipped`; the other targets are still written.
 * 6. A field whose scope set lacks C×L is written at the target's channel, never at C×L.
 * 7. Two groups on one (field, scope): the one matched by a specific entry wins, then the one whose
 *    entry comes first in mapping order. `global` wins over every group at Global.
 *
 * `fieldLevels` answers a field's scope set; attributes need it (their set is the definition's).
 * When it answers `undefined`, the family's row of `PRODUCT_FIELD_SCOPE_SETS` applies, else every
 * level (the writer then refuses the cell, `FIELD_NOT_AT_SCOPE`).
 */
export function planLocaleWrites(input: {
  source: PimSourceValues;
  mapping: PimLocaleMapping;
  validScopes: { channels: ReadonlyArray<{ channelId: string; languages: readonly string[] }> };
  fieldLevels?: (field: FieldPath) => readonly ScopeLevel[] | undefined;
}): LocaleWritePlan {
  const { source, mapping, validScopes } = input;
  const levelsOf = (field: FieldPath): readonly ScopeLevel[] =>
    input.fieldLevels?.(field) ?? fieldScopeSpec(field)?.levels ?? ['G', 'C', 'CL'];

  // Winner per (field, scope): rank = [specific ? 0 : 1, entry index]; lower wins.
  const chosen = new Map<string, { write: PlannedWrite; rank: [number, number]; order: number }>();
  let order = 0;
  const offer = (write: PlannedWrite, rank: [number, number]) => {
    const key = scopeKey(write.field, write.scope);
    const current = chosen.get(key);
    if (current === undefined) {
      chosen.set(key, { write, rank, order: order++ });
      return;
    }
    const better = rank[0] < current.rank[0] || (rank[0] === current.rank[0] && rank[1] < current.rank[1]);
    if (better) chosen.set(key, { write, rank, order: current.order });
  };

  for (const [field, raw] of Object.entries(source.global) as Array<[FieldPath, PimSourceValue]>) {
    if (raw === undefined) continue;
    offer({ scope: { level: 'global' }, field, op: toOp(raw) }, [-1, -1]);
  }

  const unmapped: LocaleWritePlan['unmapped'] = [];
  const skipped: LocaleWritePlan['skipped'] = [];
  const skippedKeys = new Set<string>();

  for (const group of source.perLocale) {
    const isGlobalSource =
      mapping.sourceLanguageForGlobal !== null && sameSourceLocale(mapping.sourceLanguageForGlobal, group.locale);
    const candidates = mapping.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => sameSourceLocale(entry.sourceLocale, group.locale))
      .filter(({ entry }) => entry.sourceChannel === null || entry.sourceChannel === group.sourceChannel);
    const specific = candidates.find(({ entry }) => entry.sourceChannel !== null);
    const match = specific ?? candidates[0];

    if (isGlobalSource) {
      for (const [field, raw] of Object.entries(group.values) as Array<[FieldPath, PimSourceValue]>) {
        if (raw === undefined) continue;
        offer({ scope: { level: 'global' }, field, op: toOp(raw) }, [0, -1]);
      }
    }
    if (match === undefined) {
      if (!isGlobalSource) unmapped.push({ locale: group.locale, sourceChannel: group.sourceChannel });
      continue;
    }

    const rank: [number, number] = [match.entry.sourceChannel !== null ? 0 : 1, match.index];
    for (const target of match.entry.targets) {
      const channel = validScopes.channels.find((c) => c.channelId === target.channelId);
      const spelled = channel === undefined ? null : channelSpelling(channel.languages, target.languageCode);
      if (channel === undefined || spelled === null) {
        const scope: ScopeRef = { level: 'channel_language', channelId: target.channelId, languageCode: target.languageCode };
        const key = scopeKey('', scope);
        if (!skippedKeys.has(key)) {
          skippedKeys.add(key);
          skipped.push({ scope, reason: channel === undefined ? 'not_a_member' : 'language_not_offered' });
        }
        continue;
      }
      for (const [field, raw] of Object.entries(group.values) as Array<[FieldPath, PimSourceValue]>) {
        if (raw === undefined) continue;
        const scope: ScopeRef = levelsOf(field).includes('CL')
          ? { level: 'channel_language', channelId: channel.channelId, languageCode: spelled }
          : { level: 'channel', channelId: channel.channelId };
        offer({ scope, field, op: toOp(raw) }, rank);
      }
    }
  }

  const writes = [...chosen.values()].sort((a, b) => a.order - b.order).map((entry) => entry.write);
  return { writes, unmapped, skipped };
}

/** The protection path a scoped field path is protected by, or `null` when no path addresses it. */
export function protectionPathOf(field: string): PimFieldPath | null {
  if (field === 'name' || field === 'description') return field;
  if (field.startsWith('attribute:')) return `attribute.${field.slice('attribute:'.length)}`;
  return null;
}

/**
 * Drop every write whose field a protected path names (FR-046): protection is whole-field, so
 * every scope of the field goes. `toPath` maps a field to its protection path (default
 * {@link protectionPathOf}; a connector that addresses gallery or attachment fields by its own
 * identifiers passes its own).
 */
export function filterProtectedWrites<W extends { field: string }>(
  writes: readonly W[],
  protectedPaths: readonly PimFieldPath[],
  toPath: (field: string) => string | null = protectionPathOf,
): { kept: W[]; protected: number } {
  const blocked = new Set(protectedPaths);
  const kept: W[] = [];
  let count = 0;
  for (const write of writes) {
    const path = toPath(write.field);
    if (path !== null && blocked.has(path)) count += 1;
    else kept.push(write);
  }
  return { kept, protected: count };
}

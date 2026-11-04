import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PRODUCT_SCOPED_WRITE_CELLS_MAX,
  integrationWritableField,
  scopedValueChangesSchema,
  type CatalogAttributeView,
  type ProductScopedWriteCell,
  type ProductScopedWriteRefusalCode,
  type ProductScopedWriteResult,
  type ProductVisibility,
  type ScopeRef,
  type ScopedValueChanges,
  type ScopedWriteOp,
  type UrlKeyWriteOutcome,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';

import { auditStates, ownValues, planScopedSave, withoutUnchangedCells, writeScopedSave, type ScopedSavePlan } from './scoped-values-save.service.js';
import { bumpScopeVersion, loadScopedState, resolveRequestScope, type ScopedProductState } from './scoped-values-state.js';
import type { UrlKeyService, UrlKeyWrite } from './url-key.service.js';

/**
 * Feature 172, US4 (T083, T084; `contracts/pim-locale-mapping.md` §4, R13a, R21) — the integration
 * write of scoped values: a PIM connector through `catalogProductScopeWritePort`, a products
 * import through `catalogBulkImportPort`. One Command `product.scoped_values.import` per product.
 *
 * Every cell goes through the **save's** planner (`planScopedSave`), one cell at a time, so an
 * integration takes exactly the editor's refusals — the field's own value schema
 * (`scopedValueChangesSchema`: lengths, types), `FIELD_NOT_AT_SCOPE`, `validateScopedWrite`
 * (`required_empty`, `not_emptyable`, `inherit_at_global`) and the subject binding — but each
 * refusal is reported for its cell and the rest applied (per-cell tolerant, unlike the save).
 * The accepted cells are then planned per scope and written by the save's writers. On top: the
 * integration allowlist (`integrationWritableField`, else `not_supported`), no completeness gate
 * (A-6), URL keys in the URL-key service's `integration` mode (a held key is reported, a redirect
 * never taken over, FR-093).
 */

export interface ScopedImportDeps {
  membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'>;
  listAttributes: () => Promise<CatalogAttributeView[]>;
  urlKeys: () => Pick<UrlKeyService, 'lockAndCheck'>;
}

/** What one product's integration write applies beside its cells (the products file's Global columns). */
export interface ScopedImportExtras {
  /** The products file's `visibility` column: the Global audience's visibility, its organisation list kept. */
  visibility?: ProductVisibility;
}

export type ScopedImportResult = ProductScopedWriteResult & { changedFields: string[] };

const SOURCE_SHAPE = /^[a-z][a-z0-9_]{1,63}$/;

const scopeKey = (scope: ScopeRef): string =>
  scope.level === 'global'
    ? 'G'
    : scope.level === 'channel'
      ? `C:${scope.channelId}`
      : `CL:${scope.channelId}/${scope.languageCode.toLowerCase()}`;

/**
 * The call-level checks of the connector port (R13a, R21): a registered source module, at most
 * {@link PRODUCT_SCOPED_WRITE_CELLS_MAX} cells, no (field, scope) twice. Throws
 * `422 VALIDATION_FAILED` naming `source` or `cells`; nothing is written.
 */
export function assertIntegrationCall(
  cells: readonly ProductScopedWriteCell[],
  source: string,
  isRegisteredModule: (moduleId: string) => boolean,
): void {
  if (!SOURCE_SHAPE.test(source) || !isRegisteredModule(source)) {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The source is not a registered module.', { field: 'source' });
  }
  if (cells.length > PRODUCT_SCOPED_WRITE_CELLS_MAX) {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, `At most ${PRODUCT_SCOPED_WRITE_CELLS_MAX} cells per call.`, {
      field: 'cells',
    });
  }
  // C2/C3 security review warn 2 — the op's shape, at runtime: an untyped caller's malformed op
  // is refused here and never read as an inherit (which would delete an override).
  const malformed = cells.findIndex((cell) => !isWriteOp(cell.op));
  if (malformed !== -1) {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A cell carries no valid write operation.', {
      field: 'cells',
      index: malformed,
    });
  }
  const duplicate = firstDuplicateCell(cells);
  if (duplicate !== null) {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The same (field, scope) cell appears twice.', {
      field: 'cells',
      index: duplicate,
    });
  }
}

/** Exactly `{ op: 'set', value }`, `{ op: 'empty' }` or `{ op: 'inherit' }` — no other keys. */
function isWriteOp(op: unknown): op is ScopedWriteOp<unknown> {
  if (typeof op !== 'object' || op === null || Array.isArray(op)) return false;
  const keys = Object.keys(op).sort().join(',');
  const kind = (op as { op?: unknown }).op;
  if (kind === 'set') return keys === 'op,value' && (op as { value?: unknown }).value !== undefined;
  return (kind === 'empty' || kind === 'inherit') && keys === 'op';
}

/** The index of the first cell whose (field, scope) an earlier cell already named, else `null`. */
export function firstDuplicateCell(cells: readonly ProductScopedWriteCell[]): number | null {
  const seen = new Set<string>();
  for (const [index, cell] of cells.entries()) {
    const key = `${cell.field}@${scopeKey(cell.scope)}`;
    if (seen.has(key)) return index;
    seen.add(key);
  }
  return null;
}

const raw = (op: ScopedWriteOp<unknown>): unknown => {
  if (op.op === 'set') return op.value;
  if (op.op === 'empty') return null;
  if (op.op === 'inherit') return { inherit: true };
  // Fail closed: an op that is none of the three never becomes an inherit.
  throw new Error(`scoped import: not a write operation: ${String((op as { op?: unknown }).op)}`);
};

/** One allowlisted cell as the save's `changes` body, or `null` when the path names no such field. */
export function cellChanges(field: string, op: ScopedWriteOp<unknown>): Record<string, unknown> | null {
  const value = raw(op);
  if (
    field === 'name' ||
    field === 'description' ||
    field === 'status' ||
    field === 'window' ||
    field === 'urlKey' ||
    field === 'minOrderQuantity' ||
    field === 'returnable'
  ) {
    return { [field]: value };
  }
  const attribute = /^attribute:([a-z0-9_]{1,64})$/.exec(field);
  if (attribute) return { attributes: { [attribute[1]!]: value } };
  const gallery = /^gallery:([0-9a-f-]{36}):altText$/.exec(field);
  if (gallery) return { gallery: { items: { [gallery[1]!]: { altText: value } } } };
  const attachment = /^attachment:([0-9a-f-]{36}):(name|description)$/.exec(field);
  if (attachment) return { attachments: { [attachment[1]!]: { [attachment[2]!]: value } } };
  const unit = /^packagingUnit:([0-9a-f-]{36}):name$/.exec(field);
  if (unit) return { packagingUnits: { [unit[1]!]: { name: value } } };
  return null;
}

/** Deep-merges one cell's `changes` into a scope's body (the paths never collide: duplicates are refused first). */
function mergeChanges(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    const isObject = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v) && !Object.hasOwn(v, 'inherit');
    if (isObject(existing) && isObject(value) && !['window', 'audience'].includes(key)) mergeChanges(existing, value);
    else target[key] = value;
  }
}

/** A refusal of the save's planner, as the cell's code. */
function refusalOf(error: unknown): ProductScopedWriteRefusalCode {
  if (error instanceof HttpError) {
    if (error.code === ERROR_CODES.FIELD_NOT_AT_SCOPE) return 'FIELD_NOT_AT_SCOPE';
    if (error.code === ERROR_CODES.SCOPE_INVALID) return 'SCOPE_INVALID';
    if (error.code === ERROR_CODES.GLOBAL_ONLY_FIELD) return 'not_supported';
    if (error.code === ERROR_CODES.SCOPED_VALUE_INVALID) {
      const reason = (error.details as { fields?: Array<{ reason?: string }> } | undefined)?.fields?.[0]?.reason;
      if (
        reason === 'required_empty' ||
        reason === 'not_emptyable' ||
        reason === 'inherit_at_global' ||
        reason === 'subject_not_found' ||
        reason === 'not_supported'
      ) {
        return reason;
      }
      return 'invalid';
    }
    if (error.code === ERROR_CODES.VALIDATION_FAILED) return 'invalid';
  }
  throw error;
}

export interface PlannedIntegration {
  /** One plan per scope with accepted cells, in the order the scopes first appear. */
  plans: ScopedSavePlan[];
  /** The `urlKey` cells among the accepted ones, in input order, with their scope. */
  urlKeyCells: Array<{ index: number; scope: ScopeRef; op: ScopedWriteOp<unknown> }>;
  refused: ProductScopedWriteResult['refused'];
  /** Accepted cells that are not URL keys. */
  accepted: number;
}

/**
 * Pure over the product's state: each cell checked alone (allowlist, scope, the save's planner),
 * the accepted ones planned per scope. `trustedChanges` (the products file's Global columns)
 * are added to the Global plan without the allowlist.
 */
export function planIntegrationCells(
  state: ScopedProductState,
  cells: readonly ProductScopedWriteCell[],
  trustedGlobal?: ScopedValueChanges,
  /**
   * `connector` — the PIM port's allowlist (R13a); `import` — the products file, which also writes
   * `minOrderQuantity` and `returnable` (coordinator decision, S1 block 2: the CSV grammar covers
   * every scoped product value; the connector exclusions apply to the PIM port only).
   */
  path: 'connector' | 'import' = 'connector',
): PlannedIntegration {
  const refused: ProductScopedWriteResult['refused'] = [];
  const byScope = new Map<string, { scope: ScopeRef; changes: Record<string, unknown> }>();
  const urlKeyCells: PlannedIntegration['urlKeyCells'] = [];
  let accepted = 0;
  const bodyAt = (scope: ScopeRef) => {
    const key = scopeKey(scope);
    let entry = byScope.get(key);
    if (!entry) {
      entry = { scope, changes: {} };
      byScope.set(key, entry);
    }
    return entry;
  };
  if (trustedGlobal && Object.keys(trustedGlobal).length > 0) mergeChanges(bodyAt({ level: 'global' }).changes, trustedGlobal);

  for (const [index, cell] of cells.entries()) {
    const refuse = (code: ProductScopedWriteRefusalCode) => refused.push({ index, scope: cell.scope, field: cell.field, code });
    const writable =
      integrationWritableField(cell.field) || (path === 'import' && (cell.field === 'minOrderQuantity' || cell.field === 'returnable'));
    const changes = writable ? cellChanges(cell.field, cell.op) : null;
    if (changes === null) {
      refuse('not_supported');
      continue;
    }
    let scope: ScopeRef;
    try {
      scope = resolveRequestScope(
        state.members,
        cell.scope.level === 'global'
          ? {}
          : cell.scope.level === 'channel'
            ? { channelId: cell.scope.channelId }
            : { channelId: cell.scope.channelId, languageCode: cell.scope.languageCode },
      );
    } catch (error) {
      refuse(refusalOf(error));
      continue;
    }
    const parsed = scopedValueChangesSchema.safeParse(changes);
    if (!parsed.success) {
      refuse('invalid');
      continue;
    }
    try {
      // `""` is "no change" in the write encoding: such a cell plans nothing and counts nowhere.
      if (planScopedSave(state, scope, parsed.data).cells.length === 0) continue;
      // A stored `''` Global description is "no description" (S2 block 2 review): re-importing
      // `NULL` there writes nothing.
      if (cell.field === 'description' && scope.level === 'global' && cell.op.op === 'empty' && (state.product.description ?? '') === '') {
        continue;
      }
    } catch (error) {
      refuse(refusalOf(error));
      continue;
    }
    if (cell.field === 'urlKey') {
      urlKeyCells.push({ index, scope, op: cell.op });
      continue;
    }
    mergeChanges(bodyAt(scope).changes, parsed.data as Record<string, unknown>);
    accepted += 1;
  }
  const plans = [...byScope.values()]
    .map(({ scope, changes }) => planScopedSave(state, scope, scopedValueChangesSchema.parse(changes)))
    .filter((plan) => plan.cells.length > 0);
  return { plans, urlKeyCells, refused, accepted };
}

/** Thrown inside the Command when nothing applies, so the version bump rolls back with it. */
class NothingApplied extends Error {
  constructor(readonly result: ScopedImportResult) {
    super('nothing applied');
  }
}

/**
 * The Command `product.scoped_values.import` for one product: the version bump first (R7, an
 * unconditional `+ 1` — an integration holds no version), then the plan, the save's writers per
 * scope, the URL keys in `integration` mode, and one audit entry (`source` and every written cell
 * keyed `field@scope`). A call where nothing applies writes, audits and bumps nothing.
 */
export async function runScopedImport(
  commandBus: { run<T>(command: Command<T>): Promise<T> },
  deps: ScopedImportDeps,
  productId: string,
  cells: readonly ProductScopedWriteCell[],
  options: { source: string; extras?: ScopedImportExtras; path?: 'connector' | 'import' },
): Promise<ScopedImportResult> {
  const command: Command<ScopedImportResult> = {
    action: 'product.scoped_values.import',
    objectType: 'product',
    objectId: productId,
    run: async ({ em }) => {
      await bumpScopeVersion(em, productId);
      const state = await loadScopedState(em, productId, deps);
      const planned = planIntegrationCells(state, cells, trustedChangesOf(state, options.extras), options.path ?? 'connector');
      // FR-114 — a cell that writes what the scope already holds is not a change.
      planned.plans = planned.plans.map((plan) => withoutUnchangedCells(state, plan)).filter((plan) => plan.cells.length > 0);
      const audit: { before: Record<string, unknown>; after: Record<string, unknown> } = { before: {}, after: {} };
      for (const plan of planned.plans) {
        const states = auditStates(plan, ownValues(state, plan));
        Object.assign(audit.before, states.before['cells'] as object);
        Object.assign(audit.after, states.after['cells'] as object);
        await writeScopedSave(em, state, plan);
      }

      const urlKeys: UrlKeyWriteOutcome[] = [];
      let urlKeysWritten = 0;
      let urlKeyEffects: { before: unknown; after: unknown } | undefined;
      if (planned.urlKeyCells.length > 0) {
        const writes: UrlKeyWrite[] = planned.urlKeyCells.map((cell) => ({
          scope: cell.scope,
          op: cell.op.op === 'set' ? { op: 'set', key: String(cell.op.value) } : { op: 'inherit' },
        }));
        const effects = await deps.urlKeys().lockAndCheck(em, productId, writes, { mode: 'integration' });
        for (const write of writes) {
          const key = write.op.op === 'set' ? write.op.key.normalize('NFC').toLowerCase() : null;
          const issue = key === null ? undefined : effects.issues.find((candidate) => candidate.key === key);
          urlKeys.push(issue ? { written: false, issue } : { written: true });
          if (!issue && effects.changed) urlKeysWritten += 1;
        }
        if (effects.changed) urlKeyEffects = { before: effects.before, after: effects.after };
      }

      const changedFields = [...new Set([...planned.plans.flatMap((plan) => plan.changedFields), ...(urlKeysWritten > 0 ? ['urlKeys'] : [])])];
      const result: ScopedImportResult = {
        applied: planned.accepted + urlKeysWritten,
        refused: planned.refused,
        urlKeys,
        changedFields,
      };
      // Nothing written (every cell refused, or each already what the scope holds): roll back.
      if (planned.plans.length === 0 && urlKeysWritten === 0) throw new NothingApplied(result);
      return {
        result,
        before: { source: options.source, cells: audit.before, ...(urlKeyEffects ? { urlKey: urlKeyEffects.before } : {}) },
        after: {
          source: options.source,
          cells: audit.after,
          changedFields,
          ...(planned.refused.length > 0 ? { refused: planned.refused.length } : {}),
          ...(urlKeyEffects ? { urlKey: urlKeyEffects.after } : {}),
        },
      };
    },
    event: ({ changedFields }) =>
      changedFields.length === 0
        ? undefined
        : {
            eventName: 'product.updated.v1',
            payload: { eventId: randomUUID(), occurredAt: new Date().toISOString(), productId, changedFields },
          },
  };
  try {
    return await commandBus.run(command);
  } catch (error) {
    if (error instanceof NothingApplied) return error.result;
    throw error;
  }
}

/** The plan of an import without writing (the products import's dry run). */
export async function planScopedImport(
  em: EntityManager,
  deps: Pick<ScopedImportDeps, 'membership' | 'listAttributes'>,
  productId: string,
  cells: readonly ProductScopedWriteCell[],
  extras?: ScopedImportExtras,
): Promise<ProductScopedWriteResult> {
  const state = await loadScopedState(em, productId, deps);
  const planned = planIntegrationCells(state, cells, trustedChangesOf(state, extras), 'import');
  return {
    applied: planned.accepted + planned.urlKeyCells.length,
    refused: planned.refused,
    urlKeys: planned.urlKeyCells.map(() => ({ written: true })),
  };
}

function trustedChangesOf(state: ScopedProductState, extras: ScopedImportExtras | undefined): ScopedValueChanges | undefined {
  if (extras?.visibility === undefined) return undefined;
  return scopedValueChangesSchema.parse({
    audience: { visibility: extras.visibility, allowedOrganizationIds: [...state.product.allowedOrganizationIds] },
  });
}

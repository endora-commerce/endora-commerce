import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogAttributeView,
  CopyScopedValueRequest,
  CopyScopedValueResponse,
  SaveScopedValuesRequest,
  ScopeCompletenessGateMode,
  ScopeRef,
  ScopeSnapshot,
  ScopeWarning,
} from '@endora-commerce/contracts';
import { ERROR_CODES, scopedValueChangesSchema, type OrganizationDetailsPort, type ScopedWriteOp } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';

import { globalScopeFields } from '../services/product-availability.service.js';
import { toChannelRecord, toLanguageRecord } from '../services/product-scopes.service.js';
import type { ScopeCompletenessGate } from '../services/scope-completeness.js';
import {
  auditStates,
  bumpScopeVersion,
  isRemovalOnly,
  ownValues,
  planScopedSave,
  writeScopedSave,
  type PlannedCell,
  type ScopedSavePlan,
  type WriteProbe,
} from '../services/scoped-values-save.service.js';
import { cellChanges } from '../services/scoped-values-import.js';
import { assertGlobalOnlyFields, useTargetAttributeSet } from '../services/scoped-values-global-only.js';
import type { LinkableAssetReader } from '../services/linkable-asset.js';
import { loadScopedState, resolveRequestScope, type ScopedProductState } from '../services/scoped-values-state.js';

/**
 * Feature 170 (T038; `contracts/scoped-values-api.md` §3) — the Command `product.scoped_values.save`:
 * one save of one scope, one audit entry whose `before` / `after` list every written cell as
 * `field@scope` and carry the re-applicable `changes` body (FR-072, FR-074), and
 * `product.updated.v1` with the union of the changed fields after commit.
 *
 * Order inside the transaction (R7, T105): the version compare-and-set is the **first** statement;
 * then load, scope, plan and validate (nothing written yet); then the writes in their fixed order;
 * then the completeness gate over the state the writes leave (a refusal rolls everything back, so
 * nothing is written, audited or announced).
 */

export interface ScopedValuesCommandDeps {
  membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'>;
  listAttributes: () => Promise<CatalogAttributeView[]>;
  gate?: ScopeCompletenessGate | undefined;
  /**
   * The URL-key step (T039): writes the key at the scope under the URL-key service's locks and
   * answers its audit side effects. Absent = a `urlKey` cell is refused.
   */
  writeUrlKey?: (
    em: EntityManager,
    input: { productId: string; scope: ScopeRef; cell: PlannedCell; confirmTakeover: readonly string[] },
  ) => Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
  /** Step 3a (R21) — the organisations an audience names must exist. */
  organizations?: Pick<OrganizationDetailsPort, 'findByIds'> | undefined;
  /** Step 3a (code review 1) — a download file must be one the library shows. Absent = refused. */
  assets?: LinkableAssetReader | undefined;
  /** Test seam (T104): called before each family writer; throwing simulates its failure. */
  probe?: WriteProbe | undefined;
}

export interface ScopedValuesSaveResult {
  state: ScopedProductState;
  scope: ScopeRef;
  changedFields: string[];
  warnings: ScopeWarning[];
}

function snapshot(state: ScopedProductState): ScopeSnapshot {
  return {
    global: { ...globalScopeFields(state.product), window: { ...globalScopeFields(state.product).window } },
    channelRows: state.channelRows.map(toChannelRecord),
    languageRows: state.languageRows.map(toLanguageRecord),
  };
}

export function scopedValuesSaveCommand(
  deps: ScopedValuesCommandDeps,
  productId: string,
  body: SaveScopedValuesRequest,
  completeness: ScopeCompletenessGateMode | undefined,
): Command<ScopedValuesSaveResult> {
  return {
    action: 'product.scoped_values.save',
    objectType: 'product',
    objectId: productId,
    run: async ({ em }) => {
      // Step 0 — the version compare-and-set, before any read (R7).
      await bumpScopeVersion(em, productId, body.version);
      const state = await loadScopedState(em, productId, deps);
      const removalOnly = isRemovalOnly(body.changes);
      const scope = resolveRequestScope(state.members, body.scope, { removalOnly });
      // Step 3a (code review 1) — a set change plans the attribute cells against the new set.
      if (scope.level === 'global') await useTargetAttributeSet(em, deps, state, body.changes.product?.attributeSetId);
      const plan = planScopedSave(state, scope, body.changes);
      if (plan.cells.length === 0) {
        return { result: { state, scope, changedFields: [], warnings: [] }, skipAudit: true };
      }
      await assertOrganizationsExist(deps, plan.cells, scope);
      await assertGlobalOnlyFields(em, deps, state, plan);
      const before = ownValues(state, plan);
      const scopesBefore = snapshot(state);

      const urlKeyCell = plan.cells.find((cell) => cell.family === 'urlKey');
      let urlKeySideEffects: { before: Record<string, unknown>; after: Record<string, unknown> } | undefined;
      await writeScopedSave(em, state, plan, deps.probe);
      if (urlKeyCell) {
        deps.probe?.('urlKey');
        if (!deps.writeUrlKey) throw new Error('scoped-values save: no URL-key writer composed');
        urlKeySideEffects = await deps.writeUrlKey(em, {
          productId,
          scope,
          cell: urlKeyCell,
          confirmTakeover: body.changes.confirmTakeover ?? [],
        });
      }

      const warnings =
        completeness && deps.gate && plan.cells.some((cell) => cell.family === 'status')
          ? await deps.gate.enforce(em, state.product, scopesBefore, snapshot(state), state.members, completeness)
          : [];

      const audit = auditStates(plan, before);
      if (urlKeySideEffects) {
        audit.before['urlKey'] = urlKeySideEffects.before;
        audit.after['urlKey'] = urlKeySideEffects.after;
      }
      return {
        result: { state, scope, changedFields: plan.changedFields, warnings },
        before: audit.before,
        after: audit.after,
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
}

/** Step 3a (R21) — every organisation id an audience cell names exists; else `invalid`, nothing written. */
async function assertOrganizationsExist(
  deps: ScopedValuesCommandDeps,
  cells: readonly PlannedCell[],
  scope: ScopeRef,
): Promise<void> {
  const audience = cells.find((cell) => cell.field === 'audience' && cell.op.op === 'set');
  if (!audience || audience.op.op !== 'set' || !deps.organizations) return;
  const ids = [...new Set((audience.op.value as { allowedOrganizationIds: string[] }).allowedOrganizationIds)];
  if (ids.length === 0) return;
  const found = new Set((await deps.organizations.findByIds(ids)).map((record) => record.id));
  if (ids.every((id) => found.has(id))) return;
  throw new HttpError(422, ERROR_CODES.SCOPED_VALUE_INVALID, 'An audience names an organisation that does not exist.', {
    fields: [{ field: 'audience', scope, reason: 'invalid' }],
  });
}

// --- Copy to other channels (T115; `contracts/scoped-values-api.md` §4, FR-086, R21) ------------

/** The fields a copy takes: the {G, C, C×L} text fields of the product and its subjects (R21). */
function copyable(state: ScopedProductState, field: string): boolean {
  if (field === 'name' || field === 'description') return true;
  if (/^(gallery:[0-9a-f-]{36}:altText|attachment:[0-9a-f-]{36}:(name|description)|packagingUnit:[0-9a-f-]{36}:name)$/.test(field)) return true;
  const attribute = /^attribute:([a-z0-9_]{1,64})$/.exec(field);
  if (!attribute) return false;
  const view = state.attributes.get(attribute[1]!);
  return view !== undefined && view.valueType === 'string' && view.scopeLevels.includes('CL');
}

export interface CopyPlan {
  field: string;
  from: Extract<ScopeRef, { level: 'channel_language' }>;
  /** One plan per target (C_target, L). */
  plans: Array<{ channelId: string; plan: ScopedSavePlan }>;
  overwrites: CopyScopedValueResponse['data']['overwrites'];
}

/**
 * The copy, planned and validated before anything is written (R21): a copyable field
 * (`not_supported` otherwise), a valid source scope, the source's **own** value (`set` or `empty`,
 * else `source_inherits`), every target a member channel offering the language (`SCOPE_INVALID`,
 * all-or-nothing), each target's write accepted by the save's planner (`required_empty` for an
 * empty value of a required field). `toChannelIds` deduplicated; the source channel skipped.
 */
export function planCopy(state: ScopedProductState, body: CopyScopedValueRequest): CopyPlan {
  const resolved = resolveRequestScope(state.members, body.from);
  // The body names a channel and a language, so the scope is a C×L one.
  const from = resolved as Extract<ScopeRef, { level: 'channel_language' }>;
  const refuse = (reason: 'not_supported' | 'source_inherits') =>
    new HttpError(422, ERROR_CODES.SCOPED_VALUE_INVALID, 'This value cannot be copied.', { fields: [{ field: body.field, scope: from, reason }] });
  const probe = cellChanges(body.field, { op: 'inherit' });
  if (!copyable(state, body.field) || probe === null) throw refuse('not_supported');
  const own = ownValues(state, planScopedSave(state, from, scopedValueChangesSchema.parse(probe))).get(body.field);
  if (own !== null && typeof own !== 'string') throw refuse('source_inherits');
  const op: ScopedWriteOp<unknown> = own === null ? { op: 'empty' } : { op: 'set', value: own };
  const changes = scopedValueChangesSchema.parse(cellChanges(body.field, op));

  const targets = [...new Set(body.toChannelIds)].filter((channelId) => channelId !== from.channelId);
  const plans = targets.map((channelId) => {
    const scope = resolveRequestScope(state.members, { channelId, languageCode: body.from.languageCode });
    return { channelId, plan: planScopedSave(state, scope, changes) };
  });
  const overwrites: CopyPlan['overwrites'] = [];
  for (const { channelId, plan } of plans) {
    const current = ownValues(state, plan).get(body.field);
    if (current === null) overwrites.push({ channelId, currentValue: { empty: true } });
    else if (typeof current === 'string') overwrites.push({ channelId, currentValue: current });
  }
  return { field: body.field, from, plans, overwrites };
}

export interface ScopedValuesCopyResult {
  overwrites: CopyPlan['overwrites'];
  applied: number;
  version: string;
  changedFields: string[];
}

/** The Command `product.scoped_values.copy_to_channels`: the version compare-and-set first, one audit entry. */
export function scopedValuesCopyCommand(
  deps: Pick<ScopedValuesCommandDeps, 'membership' | 'listAttributes'>,
  productId: string,
  body: CopyScopedValueRequest,
): Command<ScopedValuesCopyResult> {
  return {
    action: 'product.scoped_values.copy_to_channels',
    objectType: 'product',
    objectId: productId,
    run: async ({ em }) => {
      const version = await bumpScopeVersion(em, productId, body.version);
      const state = await loadScopedState(em, productId, deps);
      const copy = planCopy(state, body);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const { plan } of copy.plans) {
        const states = auditStates(plan, ownValues(state, plan));
        Object.assign(before, states.before['cells'] as object);
        Object.assign(after, states.after['cells'] as object);
        await writeScopedSave(em, state, plan);
      }
      const changedFields = [...new Set(copy.plans.flatMap(({ plan }) => plan.changedFields))];
      const scope = { channelId: copy.from.channelId, languageCode: copy.from.languageCode };
      return {
        result: { overwrites: copy.overwrites, applied: copy.plans.length, version, changedFields },
        before: { field: body.field, from: scope, cells: before },
        after: { field: body.field, from: scope, cells: after, changedFields },
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
}

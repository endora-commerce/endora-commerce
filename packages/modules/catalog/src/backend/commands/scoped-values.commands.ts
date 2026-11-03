import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogAttributeView,
  SaveScopedValuesRequest,
  ScopeCompletenessGateMode,
  ScopeRef,
  ScopeSnapshot,
  ScopeWarning,
} from '@endora-commerce/contracts';
import { ERROR_CODES, type OrganizationDetailsPort } from '@endora-commerce/contracts';
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
  type WriteProbe,
} from '../services/scoped-values-save.service.js';
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
      const plan = planScopedSave(state, scope, body.changes);
      if (plan.cells.length === 0) {
        return { result: { state, scope, changedFields: [], warnings: [] }, skipAudit: true };
      }
      await assertOrganizationsExist(deps, plan.cells, scope);
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

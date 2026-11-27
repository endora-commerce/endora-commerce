import {
  ERROR_CODES,
  type AggregateCommandOptions,
  type CatalogAttributeCommandPort,
  type CatalogProductCommandPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { assertCallerSource, type CallerOptions } from '../commands/caller-options.js';
import type { CatalogAdminService } from './catalog-admin.service.js';
import { toCatalogProductRecord, toCatalogProductVariantRecord } from './catalog-product-read.service.js';
import { assertIntegrationCells, runScopedImport, type ScopedImportDeps } from './scoped-values-import.js';

/**
 * `catalogProductCommandPort` and `catalogAttributeCommandPort`
 * (`specs/186-aggregate-ports/` US6, issue #1825) — the Product aggregate's
 * write port and the attribute-definition port. The contracts, the refusals and
 * the options are `CatalogProductCommandPort` and `CatalogAttributeCommandPort`
 * in `@endora-commerce/contracts`.
 *
 * **They check no permission.** The caller is the gate. Each method validates
 * `source` before it reads anything (issue #1922) and calls the service method
 * the admin route for the same operation calls — every one of them already runs
 * its Command on the bus, with whatever the route does beside the write (the
 * events, the default channel binding, the definitions cache, the reindex of a
 * searchable flip). The caller's `source` and `extensions` reach that Command
 * through the method's `caller` argument, which the service hands to
 * `withCallerOptions`; nothing is a second factory.
 *
 * The services are the container's `catalogAdminService`, resolved per call:
 * the instance without the completeness gate, which is the admin routes' alone
 * (feature 163, A-6).
 */

/** The service methods the Product port runs — the admin routes' own. */
export type CatalogProductCommandAdmin = Pick<
  CatalogAdminService,
  | 'createProduct'
  | 'updateProductAudited'
  | 'archiveProduct'
  | 'restoreProduct'
  | 'deleteProduct'
  | 'createVariant'
  | 'updateVariant'
  | 'deleteVariant'
  | 'setAttributeValues'
>;

/** The service methods the attribute port runs — the attribute routes' own. */
export type CatalogAttributeCommandAdmin = Pick<
  CatalogAdminService,
  | 'createAttribute'
  | 'updateAttributeByIdOrKey'
  | 'deleteAttribute'
  | 'addAttributeOption'
  | 'patchAttributeOption'
  | 'removeAttributeOption'
>;

export interface CatalogProductCommandPortDeps {
  readonly admin: () => CatalogProductCommandAdmin;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
  /** The scoped save's planner and writers, as the deprecated scope port and the products import use them. */
  readonly importDeps: () => ScopedImportDeps;
}

export function createCatalogProductCommandPort(deps: CatalogProductCommandPortDeps): CatalogProductCommandPort {
  return {
    async create(req, options = {}) {
      const caller = callerOf(options);
      return toCatalogProductRecord(await deps.admin().createProduct(req, undefined, caller));
    },
    async update(id, req, options = {}) {
      const caller = callerOf(options);
      const version = versionTokenOf(options);
      // No gate: the completeness gate is the operator's (A-6), as on the deprecated port.
      const product = await deps
        .admin()
        .updateProductAudited(id, version === undefined ? req : { ...req, version }, undefined, caller);
      return toCatalogProductRecord(product);
    },
    async archive(id, options = {}) {
      const caller = callerOf(options);
      return toCatalogProductRecord((await deps.admin().archiveProduct(id, caller)).product);
    },
    async restore(id, options = {}) {
      const caller = callerOf(options);
      return toCatalogProductRecord((await deps.admin().restoreProduct(id, caller)).product);
    },
    async delete(id, options = {}) {
      const caller = callerOf(options);
      await deps.admin().deleteProduct(id, undefined, caller);
    },
    async createVariant(productId, req, options = {}) {
      const caller = callerOf(options);
      return toCatalogProductVariantRecord(await deps.admin().createVariant(productId, req, caller));
    },
    async updateVariant(productId, variantId, req, options = {}) {
      const caller = callerOf(options);
      return toCatalogProductVariantRecord(await deps.admin().updateVariant(productId, variantId, req, caller));
    },
    async deleteVariant(productId, variantId, options = {}) {
      const caller = callerOf(options);
      await deps.admin().deleteVariant(productId, variantId, caller);
    },
    async setCustomFieldValues(id, merge, options = {}) {
      const caller = callerOf(options);
      const version = versionTokenOf(options);
      return toCatalogProductRecord(await deps.admin().setAttributeValues(id, merge, version, caller));
    },
    async applyScopedValues(id, input, options = {}) {
      const caller = callerOf(options);
      assertIntegrationCells(input.cells);
      const { changedFields: _changed, ...result } = await runScopedImport(
        deps.commandBus(),
        deps.importDeps(),
        id,
        input.cells,
        { source: caller.source ?? null, ...(caller.extensions !== undefined ? { extensions: caller.extensions } : {}) },
      );
      return result;
    },
  };
}

export function createCatalogAttributeCommandPort(deps: {
  readonly admin: () => CatalogAttributeCommandAdmin;
}): CatalogAttributeCommandPort {
  return {
    async create(req, options = {}) {
      const caller = callerOf(options);
      return deps.admin().createAttribute(req, caller);
    },
    async update(idOrKey, req, options = {}) {
      const caller = callerOf(options);
      // The reindex a searchable flip queues names the ambient administrator as its requester.
      const actorAdminUserId = ambientAdminUserId();
      return deps
        .admin()
        .updateAttributeByIdOrKey(idOrKey, req, actorAdminUserId ? { actorAdminUserId } : undefined, caller);
    },
    async delete(idOrKey, options = {}) {
      const caller = callerOf(options);
      await deps.admin().deleteAttribute(idOrKey, caller);
    },
    async addOption(attributeIdOrKey, input, options = {}) {
      const caller = callerOf(options);
      return deps.admin().addAttributeOption(attributeIdOrKey, input, caller);
    },
    async updateOption(optionId, input, options = {}) {
      const caller = callerOf(options);
      return deps.admin().patchAttributeOption(optionId, input, caller);
    },
    async deleteOption(optionId, options = {}) {
      const caller = callerOf(options);
      await deps.admin().removeAttributeOption(optionId, caller);
    },
  };
}

/**
 * The caller's options as the Commands take them. `source` is refused here,
 * first, so nothing is read or written for a malformed one (issue #1922).
 */
function callerOf(options: AggregateCommandOptions): CallerOptions {
  assertCallerSource(options);
  return { source: options.source, extensions: options.extensions };
}

/**
 * `expectedVersion` as the product's editor version token (`products.scope_version`,
 * the admin `PATCH`'s `version`): a non-negative safe integer, else
 * `422 VALIDATION_FAILED` before anything is read.
 */
function versionTokenOf(options: AggregateCommandOptions): string | undefined {
  const { expectedVersion } = options;
  if (expectedVersion === undefined) return undefined;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'expectedVersion must be a non-negative integer.', [
      { path: 'expectedVersion', issue: 'invalid_type' },
    ]);
  }
  return String(expectedVersion);
}

/**
 * The administrator the ambient context names — the route's actor for a
 * request, the queuing administrator under `withSystemScopeActingFor` — else
 * none (the system actor).
 */
function ambientAdminUserId(): string | null {
  const ctx = getTenantContext();
  if (ctx?.impersonation) return ctx.impersonation.realAdminUserId;
  return ctx?.actor.kind === 'admin' ? (ctx.actor.id ?? null) : null;
}

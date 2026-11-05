import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CopyScopedValueRequest,
  CopyScopedValueResponse,
  SaveScopedValuesRequest,
  SaveScopedValuesResponse,
  ScopedValuesData,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';

import {
  planCopy,
  scopedValuesCopyCommand,
  scopedValuesSaveCommand,
  ScopedSaveNothingChanged,
  type ScopedValuesCommandDeps,
  type ScopedValuesSaveResult,
} from '../commands/scoped-values.commands.js';
import { ScopedValuesReadService, type ScopedValuesReadDeps } from './scoped-values-read.service.js';
import { ERROR_CODES, toScopeChannel, type ScopeRef } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Product } from '../entities/product.entity.js';
import { assertProductId, loadScopedState, readScopeVersion, resolveRequestScope } from './scoped-values-state.js';

/**
 * Feature 174 (T036–T038) — the editor's one read and one save (`contracts/scoped-values-api.md`
 * §2–§3). The save runs as one `CommandBus.run`; its answer is the product re-read at the same
 * scope after commit, with the completeness gate's warn-mode warnings.
 */
export class ScopedValuesService {
  readonly #read: ScopedValuesReadService;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly deps: ScopedValuesReadDeps & ScopedValuesCommandDeps,
    private readonly commandBus?: CommandBus,
  ) {
    this.#read = new ScopedValuesReadService(emFactory, deps);
  }

  /** The request's scope resolved against the product's channels (§1) — 404 / 422 as the read answers. */
  async resolveScope(productId: string, request: { channelId?: string | undefined; languageCode?: string | undefined }): Promise<ScopeRef> {
    assertProductId(productId);
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: productId, deletedAt: null }, { fields: ['id'] });
    if (!product) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    const members = (await this.deps.membership.listChannelsForEntity('product', productId)).map((channel) => toScopeChannel(channel));
    return resolveRequestScope(members, request);
  }

  completenessMode() {
    return this.deps.gate?.mode();
  }

  read(productId: string, request: { channelId?: string | undefined; languageCode?: string | undefined }): Promise<ScopedValuesData> {
    return this.#read.read(productId, request);
  }

  async save(productId: string, body: SaveScopedValuesRequest): Promise<SaveScopedValuesResponse> {
    const touchesStatus = body.changes.status !== undefined;
    const completeness = touchesStatus ? await this.deps.gate?.mode() : undefined;
    const command = scopedValuesSaveCommand(this.deps, productId, body, completeness);
    // Constitution XIII — the editor's main write is audited or refused, never run bare.
    if (!this.commandBus) throw new Error('ScopedValuesService: the save needs the command bus.');
    let result: ScopedValuesSaveResult;
    try {
      result = await this.commandBus.run(command);
    } catch (error) {
      // `seo` off while the save names SEO fields: the port's 503 passes through unchanged.
      rethrowIfModuleDisabled(error);
      if (error instanceof ScopedSaveNothingChanged) {
        result = error.result;
      } else if (error instanceof UniqueConstraintViolationException && body.changes.product?.sku !== undefined) {
        // A SKU taken between the step-3a check and the write (code review 1): the same answer.
        throw new HttpError(409, ERROR_CODES.SKU_ALREADY_EXISTS, 'This SKU already exists.', { field: 'product.sku' });
      } else {
        throw error;
      }
    }
    const em = this.emFactory().fork();
    const state = await loadScopedState(em, productId, this.deps);
    return { data: await this.#read.project(state, result.scope), warnings: result.warnings };
  }

  /**
   * Feature 174 (T115; §4, FR-086) — "Copy to other channels". A dry run plans the copy on a read
   * (the version compared, never bumped) and lists the overwrites; a copy is one Command
   * `product.scoped_values.copy_to_channels`.
   */
  async copy(productId: string, body: CopyScopedValueRequest): Promise<CopyScopedValueResponse> {
    assertProductId(productId);
    if (body.dryRun === true) {
      const em = this.emFactory().fork();
      const state = await loadScopedState(em, productId, this.deps);
      const version = await readScopeVersion(em, productId);
      if (version !== body.version) {
        throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The product changed since it was read.', { currentVersion: version });
      }
      return { data: { overwrites: planCopy(state, body).overwrites, applied: 0, version } };
    }
    if (!this.commandBus) throw new Error('ScopedValuesService: the copy needs the command bus.');
    const result = await this.commandBus.run(scopedValuesCopyCommand(this.deps, productId, body));
    return { data: { overwrites: result.overwrites, applied: result.applied, version: result.version } };
  }
}

import type { EntityManager } from '@mikro-orm/postgresql';
import type { SaveScopedValuesRequest, SaveScopedValuesResponse, ScopedValuesData } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';

import { scopedValuesSaveCommand, type ScopedValuesCommandDeps, type ScopedValuesSaveResult } from '../commands/scoped-values.commands.js';
import { ScopedValuesReadService, type ScopedValuesReadDeps } from './scoped-values-read.service.js';
import { ERROR_CODES, toScopeChannel, type ScopeRef } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Product } from '../entities/product.entity.js';
import { assertProductId, loadScopedState, resolveRequestScope } from './scoped-values-state.js';

/**
 * Feature 170 (T036–T038) — the editor's one read and one save (`contracts/scoped-values-api.md`
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
    let result: ScopedValuesSaveResult;
    if (this.commandBus) {
      result = await this.commandBus.run(command);
    } else {
      result = await this.emFactory().transactional(async (em) => {
        const outcome = await command.run({
          em,
          actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' },
        });
        return outcome.result;
      });
    }
    const em = this.emFactory().fork();
    const state = await loadScopedState(em, productId, this.deps);
    return { data: await this.#read.project(state, result.scope), warnings: result.warnings };
  }
}

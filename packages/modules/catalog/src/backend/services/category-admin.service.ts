import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  isCustomFieldValidationFailure,
  type CategoryContentEnvelope,
  type CategoryInventoryThresholdPatch,
  type CreateCategoryRequest,
  type CustomFieldMerge,
  type CustomFieldValuePort,
  type UpdateCategoryInput,
  isUuidShape,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { Category } from '../entities/category.entity.js';
import { withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import {
  makeCreateCategoryCommand,
  makeDeleteCategoryCommand,
  makeSetCategoryContentCommand,
  makeSetCategoryInventoryThresholdsCommand,
  makeUpdateCategoryCommand,
  type CategoryCustomFieldPatchMerge,
} from '../commands/category.commands.js';
import type { LinkableAssetReader } from './linkable-asset.js';

/**
 * Feature 068 — events this service publishes.
 *
 * `category.updated.v1` carries the changed category id. The search module
 * subscribes to it and re-indexes every product in the affected subtree,
 * because a category's slug and its activation state are both projected onto
 * the product documents (`categorySlugs`) that back the storefront PLP.
 */
export interface CategoryEvents extends Record<string, EventBase> {
  'category.updated.v1': EventBase & { categoryId: string };
  /**
   * The category's page content changed and nothing else did.
   *
   * A separate event rather than a second cause of `category.updated.v1`,
   * because that one is what `search` re-projects a whole subtree of products
   * on — the slug and the activation state are on the product documents, and
   * the page content is on none of them. Saving a paragraph should flush the
   * storefront's category cache and should not re-index a branch.
   */
  'category.content.updated.v1': EventBase & { categoryId: string };
}

export type CategoryEventBus = EventBus<CategoryEvents>;

/**
 * CategoryAdminService (T090). Backs the admin Categories tree editor.
 *
 * Two invariants:
 *   - parent must exist (or be null for a root)
 *   - moving a category MUST NOT create a cycle — when reparenting, walk
 *     up the new parent's chain and refuse if the moved id appears.
 *
 * Both are enforced by the Commands in `../commands/category.commands.ts`,
 * which this service runs for the admin routes and for
 * `catalogCategoryCommandPort` alike (`specs/186-aggregate-ports/` US8).
 *
 * Soft delete (`deletedAt`) is used so categorised products keep their
 * historical reference; the public catalog filters them out.
 */

/**
 * The patch this service's `update` accepts.
 *
 * Published in `@endora-commerce/contracts` in feature 075's Phase P — the category write
 * port takes it — and aliased back here so the two cannot drift.
 */
export type { UpdateCategoryInput };

export class CategoryAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Feature 005 / T027b — when injected, every newly-created Category
     * that does not declare explicit channel membership lands in the
     * system-default Sales Channel automatically (FR-011). Optional so
     * existing tests that construct this service without sales-channels
     * keep compiling; production composition.ts always provides it.
     */
    private readonly salesChannelMembership?: SalesChannelMembershipPort,
    /** Feature 054 — audits category writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
    /** Feature 055 — validates + merges custom-field values on category write. */
    private readonly customFieldValues?: CustomFieldValuePort,
    /**
     * Feature 068 — publishes `category.updated.v1`. Only consulted on the
     * bus-less fallback path: when a Command Bus is injected it dispatches the
     * command's event itself, on commit.
     */
    private readonly events?: CategoryEventBus,
    /**
     * Feature 166 (FR-006) — `assets_library`'s read port, asked before a main
     * image is linked. A write that names a new image without it fails closed.
     */
    private readonly assets?: LinkableAssetReader,
  ) {}

  #requireAssets(): LinkableAssetReader {
    if (!this.assets) {
      throw new Error('CategoryAdminService: the asset read port is not wired — a main image cannot be linked.');
    }
    return this.assets;
  }

  /** Validate + merge a custom-field patch, mapping validation errors to HTTP 422. */
  readonly #mergeCustomFields: CategoryCustomFieldPatchMerge = async (current, patch) => {
    if (!this.customFieldValues) return current;
    try {
      return await this.customFieldValues.validateAndMerge('category', current ?? {}, patch);
    } catch (err) {
      // Feature 075 — narrowed structurally, not by `instanceof` on
      // `custom_fields`' class. The guard tests `name` and the `errors`
      // array, which is what still works once each module is its own npm
      // package; and the re-throw below stays unconditional, so a
      // `ModuleDisabledError` from the port leaves through it.
      if (isCustomFieldValidationFailure(err)) {
        throw new HttpError(
          422,
          ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
          'One or more custom fields are invalid.',
          err.errors.map((e) => ({ path: e.field, issue: e.message })),
        );
      }
      throw err;
    }
  };

  /**
   * Runs one of the Category Commands (`../commands/category.commands.ts`)
   * through the Command Bus — co-transactional audit, the event on commit —
   * with the port caller's `source` and `extensions` added when there are any
   * (`specs/186-aggregate-ports/` US8). Without a bus (narrow unit tests) the
   * Command's `run` executes on a plain forked em and its event is emitted
   * directly; nothing is audited then.
   */
  async #run<T>(command: Command<T>, caller: CallerOptions = {}): Promise<T> {
    if (this.commandBus) return this.commandBus.run(withCallerOptions(command, caller));
    const em = this.emFactory();
    const outcome = await command.run({ em, actor: NO_BUS_ACTOR });
    await em.flush(); // no-op when the Command already flushed
    const event = command.event?.(outcome.result);
    if (event) {
      this.events?.emit(
        event.eventName as keyof CategoryEvents & string,
        event.payload as CategoryEvents[keyof CategoryEvents & string],
      );
    }
    return outcome.result;
  }

  async listAll(): Promise<Category[]> {
    const em = this.emFactory();
    return em.find(
      Category,
      { deletedAt: null },
      { orderBy: { sortOrder: 'asc', slug: 'asc' } },
    );
  }

  /** `category.create` (`POST …/categories`, `catalogCategoryCommandPort.create`). */
  async create(input: CreateCategoryRequest, caller?: CallerOptions): Promise<Category> {
    const cat = await this.#run(makeCreateCategoryCommand({ mergeCustomFields: this.#mergeCustomFields }, input), caller);
    // Feature 005 / FR-011 — bind to Default unless this category was
    // already given memberships through some other path. After the commit, as
    // it has always been: the kernel writer runs on its own transaction here.
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.bindToDefaultIfEmpty('category', cat.id);
    }
    return cat;
  }

  /**
   * `category.update` (`PATCH …/categories/:id`, and the port's `update` and
   * `move`). `customFieldValues` is a patch validated with the administrator's
   * rules.
   */
  async update(id: string, input: UpdateCategoryInput, caller?: CallerOptions): Promise<Category> {
    const { customFieldValues, ...patch } = input;
    return this.#run(
      makeUpdateCategoryCommand(
        { linkableAssets: () => this.#requireAssets() },
        {
          categoryId: id,
          patch,
          ...(customFieldValues !== undefined
            ? { customFields: (current: Record<string, unknown>) => this.#mergeCustomFields(current, customFieldValues) }
            : {}),
        },
      ),
      caller,
    );
  }

  /**
   * `category.update` with the custom-field bag only, the caller's merge in
   * place of the admin's validated patch (`catalogCategoryCommandPort.setCustomFieldValues`,
   * research R-20.2). The caller validates inside `merge`.
   */
  async setCustomFieldValues(id: string, merge: CustomFieldMerge, caller?: CallerOptions): Promise<Category> {
    return this.#run(
      makeUpdateCategoryCommand({ linkableAssets: () => this.#requireAssets() }, { categoryId: id, patch: {}, customFields: merge }),
      caller,
    );
  }

  /** `category.delete` (`DELETE …/categories/:id`, `catalogCategoryCommandPort.delete`). */
  async softDelete(id: string, caller?: CallerOptions): Promise<void> {
    await this.#run(makeDeleteCategoryCommand({ categoryId: id }), caller);
  }

  /**
   * The category's page content — the whole per-language envelope, or `null`
   * when none was authored. 404 for an unknown or soft-deleted category.
   *
   * `populate: ['content']` is what loads it: the property is lazy, so every
   * other read of this entity leaves the document in the database.
   */
  async getContent(id: string): Promise<CategoryContentEnvelope> {
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Category not found.');
    const cat = await this.emFactory().findOne(
      Category,
      { id, deletedAt: null },
      { populate: ['content'] },
    );
    if (!cat) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Category not found.');
    return cat.content ?? null;
  }

  /**
   * Replace the category's page content. `null` clears it.
   *
   * Its own Command (`category.content.update`) and its own event, rather
   * than one more key on {@link update}: the document is authored on its own
   * screen, saved on its own button, and may weigh a megabyte — so the audit
   * row records **which languages** the envelope carried before and after,
   * never the documents, and the event is the one that does not re-index the
   * category's products (see {@link CategoryEvents}).
   */
  async setContent(
    id: string,
    content: CategoryContentEnvelope,
  ): Promise<CategoryContentEnvelope> {
    const cat = await this.#run(makeSetCategoryContentCommand({ contentAssets: this.assets }, { categoryId: id, content }));
    return cat.content ?? null;
  }

  /**
   * Set the inventory display-band thresholds on a category — the Command
   * `category.inventory_thresholds.set` (`specs/186-aggregate-ports/` US8,
   * research R-20.3), run by `catalogCategoryCommandPort.setInventoryThresholds`
   * for `inventory`'s threshold admin.
   *
   * `inventory` owns the meaning of these three columns and stored them here
   * because the storefront resolver reads them alongside the category row.
   * Deliberately not {@link update}: no `category.updated.v1` (nothing on a
   * product document changes) and no `category.update` entry, whose state
   * would read as a rename. The entry is this action's own, with the three
   * columns before and after; `inventory`'s `low_stock_threshold.update`
   * summary no longer counts the category half.
   */
  async setInventoryThresholds(
    id: string,
    patch: CategoryInventoryThresholdPatch,
    caller?: CallerOptions,
  ): Promise<Category> {
    return this.#run(makeSetCategoryInventoryThresholdsCommand({ categoryId: id, patch }), caller);
  }
}

/** The actor a no-bus run hands its Command; nothing is audited on that path. */
const NO_BUS_ACTOR = {
  actorAdminUserId: null,
  impersonatedCustomerAccountId: null,
  kind: 'system',
} as const;

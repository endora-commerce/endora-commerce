import { LockMode } from '@mikro-orm/core';
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PRICE_MATRIX_MAX_ENTRIES_PER_LIST,
  priceMatrixSelectionKind,
  type CatalogAttributeView,
  type PriceMatrixAttributeTarget,
  type PriceMatrixEntry,
  type PriceMatrixEntryInput,
  type PriceMatrixEntryPatch,
  type PriceMatrixEntryShape,
  type PriceMatrixInactiveReason,
  type PriceMatrixListQuery,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { isOrgInScope, orgConstraintFor, ruleVisibleForScope } from '@endora-commerce/platform/tenancy';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListMatrixEntry } from '../entities/price-list-matrix-entry.entity.js';
import {
  entryShapeFromRow,
  findOverlappingEntry,
  isAtMatrixLimit,
  mergeEntryPatch,
  rowFieldsFromShape,
  validateEntryShape,
} from './matrix-entry-rules.js';
import {
  attributeInactiveReason,
  matrixEntrySpecificity,
  type MatrixEntryRow,
} from './matrix-price-resolver.js';
import type { PriceListTargetReads } from './price-list-service.js';
import { extractRuleOrgTargets } from './rule-org-targets.js';

/**
 * The admin side of the price matrix (feature 148,
 * `specs/148-price-list-matrix-rules/contracts/admin-price-matrix-api.md`).
 *
 * Every write runs in `PriceListService`, through its audited runner — one
 * Command Bus path for the whole module (Constitution XIII), with `objectType:
 * 'price_list'` and the list as the object, so the audit reference resolver
 * already links a matrix write to its list. The pricing cache is invalidated
 * inside the same run, as for a bracket write. This service reads, and
 * prepares each write on the run's `EntityManager`.
 *
 * **Tenant scope** (Constitution XI, spec FR-024). The parent list's
 * visibility is the list routes' own rule; an entry's organization coordinate
 * is filtered *in the query* for reads, so `total` never counts an entry the
 * caller cannot see, and an out-of-scope entry answers exactly like a missing
 * one. A write naming an out-of-scope organization answers exactly like an
 * unknown organization.
 */

export interface PriceMatrixServiceDeps {
  emFactory: () => EntityManager;
  targets: () => PriceListTargetReads;
}

/** `details.reason` of `PRICE_MATRIX_ATTRIBUTE_NOT_ELIGIBLE`. */
type AttributeRefusal =
  | 'not_found'
  | 'not_flagged'
  | 'language_scoped'
  | 'channel_scoped'
  | 'value_type'
  | 'unknown_value';

const REFUSAL_FOR: Record<PriceMatrixInactiveReason, AttributeRefusal> = {
  attribute_not_found: 'not_found',
  attribute_not_flagged: 'not_flagged',
  attribute_language_scoped: 'language_scoped',
  attribute_channel_scoped: 'channel_scoped',
  attribute_value_type: 'value_type',
};

const SELECTION_WHERE: Record<PriceMatrixEntry['selectionKind'], FilterQuery<PriceListMatrixEntry>> = {
  product: { productId: { $ne: null } },
  category_attribute: { categoryId: { $ne: null }, attributeKey: { $ne: null } },
  attribute: { productId: null, categoryId: null, attributeKey: { $ne: null } },
  category: { categoryId: { $ne: null }, attributeKey: null },
  all: { productId: null, categoryId: null, attributeKey: null },
};

/**
 * A label in the admin's language: the exact tag, else a tag of the same
 * language (`pl` ↔ `pl-PL`), else the fallback.
 */
export function pickLabel(
  labels: Record<string, string> | null | undefined,
  fallback: string,
  language: string | null,
): string {
  if (!labels) return fallback;
  if (language) {
    if (labels[language]) return labels[language];
    const prefix = language.split('-')[0]!.toLowerCase();
    for (const [tag, value] of Object.entries(labels)) {
      if (value && tag.split('-')[0]!.toLowerCase() === prefix) return value;
    }
  }
  if (fallback) return fallback;
  return Object.values(labels).find((v) => v.length > 0) ?? '';
}

function toRow(entity: PriceListMatrixEntry): MatrixEntryRow {
  return {
    id: entity.id,
    priceListId: entity.priceListId,
    productId: entity.productId ?? null,
    categoryId: entity.categoryId ?? null,
    attributeKey: entity.attributeKey ?? null,
    attributeValue: entity.attributeValue ?? null,
    organizationId: entity.organizationId ?? null,
    minQuantity: entity.minQuantity,
    maxQuantity: entity.maxQuantity ?? null,
    // Feature 160 — the old engine's matrix holds its own two price types; a
    // price-book row is never read here (its book carries no rule).
    priceType: entity.priceType as MatrixEntryRow['priceType'],
    amount: entity.amount ?? null,
    currencyCode: entity.currencyCode ?? null,
    discountPercent: entity.discountPercent ?? null,
  };
}

function sameShape(a: PriceMatrixEntryShape, b: PriceMatrixEntryShape): boolean {
  return JSON.stringify(rowFieldsFromShape(a)) === JSON.stringify(rowFieldsFromShape(b));
}

interface LabelContext {
  products: Map<string, { sku: string; name: string }>;
  categories: Map<string, string>;
  organizations: Map<string, string>;
  attributes: Map<string, CatalogAttributeView>;
  language: string | null;
}

export class PriceMatrixService {
  constructor(private readonly deps: PriceMatrixServiceDeps) {}

  // ---- reads ----------------------------------------------------------------

  /** `GET …/matrix` — contract §1. */
  async list(
    priceListId: string,
    query: PriceMatrixListQuery,
    language: string | null = null,
  ): Promise<{ items: PriceMatrixEntry[]; total: number; page: number; pageSize: number; limit: number }> {
    const em = this.deps.emFactory();
    await this.#visibleList(em, priceListId);
    const and: Array<FilterQuery<PriceListMatrixEntry>> = [{ priceListId }, this.#scopeWhere()];
    if (query.selectionKind) and.push(SELECTION_WHERE[query.selectionKind]);
    if (query.organizationId === 'none') and.push({ organizationId: null });
    else if (query.organizationId) and.push({ organizationId: query.organizationId });
    if (query.productId) and.push({ productId: query.productId });
    if (query.categoryId) and.push({ categoryId: query.categoryId });

    // A list holds at most PRICE_MATRIX_MAX_ENTRIES_PER_LIST rows, so the
    // ordering — organization-less first, then specificity, which is derived and
    // not a column — is applied in memory over the scoped, filtered set. Scope
    // is in the `where`, so `total` never counts an invisible entry.
    const rows = (await em.find(PriceListMatrixEntry, { $and: and })).map(toRow);
    rows.sort((a, b) => {
      if ((a.organizationId === null) !== (b.organizationId === null)) {
        return a.organizationId === null ? -1 : 1;
      }
      const bySpecificity = matrixEntrySpecificity(b) - matrixEntrySpecificity(a);
      if (bySpecificity !== 0) return bySpecificity;
      if (a.minQuantity !== b.minQuantity) return a.minQuantity - b.minQuantity;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const pageRows = rows.slice(query.page * query.pageSize, (query.page + 1) * query.pageSize);
    const entities = await this.#entitiesById(em, pageRows.map((r) => r.id));
    const labels = await this.#labelContext(pageRows, language);
    return {
      items: pageRows.map((row) => this.#toDto(row, entities.get(row.id)!, labels)),
      total: rows.length,
      page: query.page,
      pageSize: query.pageSize,
      limit: PRICE_MATRIX_MAX_ENTRIES_PER_LIST,
    };
  }

  /** `GET …/matrix/:entryId` — contract §2. */
  async get(priceListId: string, entryId: string, language: string | null = null): Promise<PriceMatrixEntry> {
    const em = this.deps.emFactory();
    await this.#visibleList(em, priceListId);
    const entity = await this.#visibleEntry(em, priceListId, entryId);
    const row = toRow(entity);
    return this.#toDto(row, entity, await this.#labelContext([row], language));
  }

  /**
   * `GET /api/v1/admin/pricing/rule-targets/attributes` — contract §6: the
   * attributes a matrix entry may select on, with their option values.
   * Boolean options carry their value as the label; the admin renders its own
   * Yes / No labels (`priceMatrix.attribute.boolean.true` and `.false`).
   */
  async attributeTargets(language: string | null = null): Promise<PriceMatrixAttributeTarget[]> {
    const views = await this.deps.targets().catalogAttributeRead.listByFlag('isPriceRule');
    return views
      .filter((view) => attributeInactiveReason(view) === null)
      .map((view) => ({
        key: view.key,
        label: pickLabel(view.label, view.labelDefault, language),
        valueType: view.valueType as PriceMatrixAttributeTarget['valueType'],
        options:
          view.valueType === 'boolean'
            ? [
                { value: 'true', label: 'true' },
                { value: 'false', label: 'false' },
              ]
            : [...view.options]
                .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
                .map((o) => ({ value: o.value, label: pickLabel(o.label, o.labelDefault, language) })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  // ---- write preparation ----------------------------------------------------
  //
  // The writes themselves live in `PriceListService` (`createMatrixEntry`,
  // `patchMatrixEntry`, `removeMatrixEntry`), inside its audited Command Bus
  // runner — one write path for the whole module (Constitution XIII). These
  // methods do everything that comes before the write, on the run's own
  // transactional `EntityManager`: lock the parent list, check scope, the limit,
  // the shape, the targets, eligibility and overlap.

  /** `POST …/matrix` — contract §3: the list (locked) and the validated columns. */
  async prepareCreate(
    em: EntityManager,
    priceListId: string,
    input: PriceMatrixEntryInput,
  ): Promise<{ list: PriceList; fields: Omit<MatrixEntryRow, 'id' | 'priceListId'> }> {
    const list = await this.#lockVisibleList(em, priceListId);
    const count = await em.count(PriceListMatrixEntry, { priceListId });
    if (isAtMatrixLimit(count)) {
      throw new HttpError(
        409,
        ERROR_CODES.PRICE_MATRIX_ENTRY_LIMIT,
        `A price list holds at most ${PRICE_MATRIX_MAX_ENTRIES_PER_LIST} matrix entries.`,
        { limit: PRICE_MATRIX_MAX_ENTRIES_PER_LIST },
      );
    }
    await this.#validate(em, priceListId, input, null);
    return { list, fields: rowFieldsFromShape(input) };
  }

  /**
   * `PATCH …/matrix/:entryId` — contract §4: the stored entry, its DTO before the
   * change, and the merged columns — `null` when the patch changes nothing.
   */
  async preparePatch(
    em: EntityManager,
    priceListId: string,
    entryId: string,
    patch: PriceMatrixEntryPatch,
  ): Promise<{
    list: PriceList;
    entity: PriceListMatrixEntry;
    before: PriceMatrixEntry;
    fields: Omit<MatrixEntryRow, 'id' | 'priceListId'> | null;
  }> {
    const list = await this.#lockVisibleList(em, priceListId);
    const entity = await this.#visibleEntry(em, priceListId, entryId);
    const current = entryShapeFromRow(toRow(entity));
    const merged = mergeEntryPatch(current, patch);
    const before = await this.dtoFor(entity);
    if (sameShape(current, merged)) return { list, entity, before, fields: null };
    await this.#validate(em, priceListId, merged, current, entryId);
    return { list, entity, before, fields: rowFieldsFromShape(merged) };
  }

  /** `DELETE …/matrix/:entryId` — contract §5: the entry and its DTO. */
  async prepareRemove(
    em: EntityManager,
    priceListId: string,
    entryId: string,
  ): Promise<{ list: PriceList; entity: PriceListMatrixEntry; before: PriceMatrixEntry }> {
    const list = await this.#lockVisibleList(em, priceListId);
    const entity = await this.#visibleEntry(em, priceListId, entryId);
    return { list, entity, before: await this.dtoFor(entity) };
  }

  /** The columns of every entry on a list, for the duplicate path (contract §7). */
  static async entryFieldsOf(
    em: EntityManager,
    priceListId: string,
  ): Promise<Array<Omit<MatrixEntryRow, 'id' | 'priceListId'>>> {
    const entries = await em.find(PriceListMatrixEntry, { priceListId });
    return entries.map((entry) => {
      const { id: _id, priceListId: _list, ...fields } = toRow(entry);
      void _id;
      void _list;
      return fields;
    });
  }

  /** The DTO of one entry, labels resolved. */
  async dtoFor(entity: PriceListMatrixEntry): Promise<PriceMatrixEntry> {
    const row = toRow(entity);
    return this.#toDto(row, entity, await this.#labelContext([row], null));
  }

  // ---- internals ------------------------------------------------------------

  /** The list, or `PRICE_LIST_NOT_FOUND` when it is missing or outside the caller's scope. */
  async #visibleList(em: EntityManager, priceListId: string, lock = false): Promise<PriceList> {
    const list = await em.findOne(
      PriceList,
      { id: priceListId },
      lock && em.isInTransaction() ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {},
    );
    if (!list || !ruleVisibleForScope(extractRuleOrgTargets(list.applicationRule))) {
      throw new HttpError(404, ERROR_CODES.PRICE_LIST_NOT_FOUND, `Price list ${priceListId} not found.`);
    }
    return list;
  }

  /**
   * Writes lock the parent list row first, so two concurrent writes to one list
   * serialise and the overlap and limit checks read a settled set.
   */
  #lockVisibleList(em: EntityManager, priceListId: string): Promise<PriceList> {
    return this.#visibleList(em, priceListId, true);
  }

  async #visibleEntry(em: EntityManager, priceListId: string, entryId: string): Promise<PriceListMatrixEntry> {
    const entity = UUID.test(entryId)
      ? await em.findOne(PriceListMatrixEntry, { id: entryId, priceListId })
      : null;
    if (!entity || !this.#entryInScope(entity.organizationId ?? null)) {
      throw new HttpError(
        404,
        ERROR_CODES.PRICE_MATRIX_ENTRY_NOT_FOUND,
        'This price matrix entry does not exist or is not available to you.',
      );
    }
    return entity;
  }

  #entryInScope(organizationId: string | null): boolean {
    return organizationId === null || isOrgInScope(organizationId);
  }

  #scopeWhere(): FilterQuery<PriceListMatrixEntry> {
    const constraint = orgConstraintFor();
    switch (constraint.kind) {
      case 'all':
        return {};
      case 'single':
        return constraint.organizationId === null
          ? { organizationId: null }
          : { $or: [{ organizationId: null }, { organizationId: constraint.organizationId }] };
      case 'set':
        return { $or: [{ organizationId: null }, { organizationId: { $in: [...constraint.organizationIds] } }] };
    }
  }

  /**
   * Every create rule (data-model §1 *Validation rules*), on the full entry —
   * a PATCH runs them on the merged one. Targets are checked when they are new
   * or changed: an entry whose product was soft-deleted can still have its
   * window or price corrected, which is what the *deleted item* marker invites.
   */
  async #validate(
    em: EntityManager,
    priceListId: string,
    entry: PriceMatrixEntryShape,
    current: PriceMatrixEntryShape | null,
    exceptId?: string,
  ): Promise<void> {
    const issues = validateEntryShape(entry);
    if (issues.length > 0) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        issues.map((i) => i.message).join(' '),
        issues.map((i) => ({ path: i.path.join('.'), issue: i.message })),
      );
    }
    const targets = this.deps.targets();
    const changed = <K extends keyof PriceMatrixEntryShape>(key: K): boolean =>
      current === null || JSON.stringify(current[key]) !== JSON.stringify(entry[key]);

    if (entry.productId !== null && changed('productId')) {
      if (!(await targets.catalogProductRead.findById(entry.productId, { liveOnly: true }))) {
        throw validationFailed('productId', 'The product does not exist.');
      }
    }
    if (entry.categoryId !== null && changed('categoryId')) {
      if (!(await targets.catalogCategoryRead.findById(entry.categoryId, { liveOnly: true }))) {
        throw validationFailed('categoryId', 'The category does not exist.');
      }
    }
    if (entry.organizationId !== null && changed('organizationId')) {
      // Out of scope answers exactly like unknown (FR-024).
      if (
        !isOrgInScope(entry.organizationId) ||
        !(await targets.organizationDetails.findById(entry.organizationId))
      ) {
        throw validationFailed('organizationId', 'The organization does not exist.');
      }
    }
    if (entry.price.type === 'fixed' && changed('price')) {
      const currency = entry.price.currencyCode.toUpperCase();
      if (!(await this.#offeredCurrencies(em)).has(currency)) {
        throw validationFailed('price.currencyCode', `No sales channel offers the currency ${currency}.`);
      }
    }
    if (entry.attribute !== null && changed('attribute')) {
      const view = await targets.catalogAttributeRead.getByIdOrKey(entry.attribute.key);
      const reason = attributeInactiveReason(view && view.key === entry.attribute.key ? view : null);
      let refusal: AttributeRefusal | null = reason ? REFUSAL_FOR[reason] : null;
      if (!refusal && view) {
        const known =
          view.valueType === 'boolean'
            ? entry.attribute.value === 'true' || entry.attribute.value === 'false'
            : view.options.some((o) => o.value === entry.attribute!.value);
        if (!known) refusal = 'unknown_value';
      }
      if (refusal) {
        throw new HttpError(
          400,
          ERROR_CODES.PRICE_MATRIX_ATTRIBUTE_NOT_ELIGIBLE,
          `The attribute "${entry.attribute.key}" cannot select prices (${refusal}).`,
          { field: 'attribute', reason: refusal },
        );
      }
    }

    const siblings = (await em.find(PriceListMatrixEntry, { priceListId })).map(toRow);
    const conflict = findOverlappingEntry(entry, siblings, exceptId);
    if (conflict) {
      const visible = this.#entryInScope(conflict.organizationId);
      throw new HttpError(
        409,
        ERROR_CODES.PRICE_MATRIX_ENTRY_OVERLAP,
        'Another entry with the same selection, organization and currency already covers part of this quantity range.',
        visible ? { conflictingEntryId: conflict.id } : {},
      );
    }
  }

  async #offeredCurrencies(em: EntityManager): Promise<Set<string>> {
    const out = new Set<string>();
    for (const channel of await em.find(SalesChannel, {})) {
      for (const currency of channel.currencies ?? []) {
        if (typeof currency === 'string') out.add(currency.toUpperCase());
      }
      if (channel.defaultCurrency) out.add(channel.defaultCurrency.toUpperCase());
    }
    return out;
  }

  async #entitiesById(em: EntityManager, ids: readonly string[]): Promise<Map<string, PriceListMatrixEntry>> {
    if (ids.length === 0) return new Map();
    const rows = await em.find(PriceListMatrixEntry, { id: { $in: [...ids] } });
    return new Map(rows.map((r) => [r.id, r]));
  }

  /**
   * Labels for a page of entries, one batched read per kind and only for the
   * kinds the page names (data-model §5). Live rows only: a soft-deleted target
   * is absent, which is what `targetDeleted` reports.
   */
  async #labelContext(rows: readonly MatrixEntryRow[], language: string | null): Promise<LabelContext> {
    const targets = this.deps.targets();
    const productIds = [...new Set(rows.flatMap((r) => (r.productId ? [r.productId] : [])))];
    const categoryIds = [...new Set(rows.flatMap((r) => (r.categoryId ? [r.categoryId] : [])))];
    const organizationIds = [...new Set(rows.flatMap((r) => (r.organizationId ? [r.organizationId] : [])))];
    const context: LabelContext = {
      products: new Map(),
      categories: new Map(),
      organizations: new Map(),
      attributes: new Map(),
      language,
    };
    if (productIds.length > 0) {
      for (const p of await targets.catalogProductRead.findByIds(productIds, { liveOnly: true })) {
        context.products.set(p.id, { sku: p.sku, name: pickLabel(p.name, p.sku, language) });
      }
    }
    if (categoryIds.length > 0) {
      for (const c of await targets.catalogCategoryRead.findByIds(categoryIds, { liveOnly: true })) {
        context.categories.set(c.id, pickLabel(c.name, c.slug, language));
      }
    }
    if (organizationIds.length > 0) {
      for (const o of await targets.organizationDetails.findByIds(organizationIds)) {
        context.organizations.set(o.id, o.name);
      }
    }
    if (rows.some((r) => r.attributeKey !== null)) {
      for (const view of await targets.catalogAttributeRead.listAll()) context.attributes.set(view.key, view);
    }
    return context;
  }

  #toDto(row: MatrixEntryRow, entity: PriceListMatrixEntry, labels: LabelContext): PriceMatrixEntry {
    const shape = entryShapeFromRow(row);
    const view = row.attributeKey !== null ? (labels.attributes.get(row.attributeKey) ?? null) : null;
    const inactiveReason = row.attributeKey !== null ? attributeInactiveReason(view) : null;
    const product = row.productId ? (labels.products.get(row.productId) ?? null) : null;
    const category = row.categoryId ? (labels.categories.get(row.categoryId) ?? null) : null;
    const organization = row.organizationId ? (labels.organizations.get(row.organizationId) ?? null) : null;
    const option =
      view && row.attributeValue !== null
        ? view.options.find((o) => o.value === row.attributeValue)
        : undefined;
    return {
      id: row.id,
      priceListId: row.priceListId,
      selectionKind: priceMatrixSelectionKind(shape),
      productId: shape.productId,
      categoryId: shape.categoryId,
      attribute: shape.attribute,
      organizationId: shape.organizationId,
      minQuantity: shape.minQuantity,
      maxQuantity: shape.maxQuantity,
      price: shape.price,
      active: inactiveReason === null,
      inactiveReason,
      targetDeleted:
        (row.productId !== null && product === null) ||
        (row.categoryId !== null && category === null) ||
        (row.organizationId !== null && organization === null),
      labels: {
        product,
        category,
        attribute:
          row.attributeKey !== null && row.attributeValue !== null
            ? {
                label: view ? pickLabel(view.label, view.labelDefault, labels.language) : row.attributeKey,
                valueLabel: option
                  ? pickLabel(option.label, option.labelDefault, labels.language)
                  : row.attributeValue,
              }
            : null,
        organization,
      },
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validationFailed(field: string, message: string): HttpError {
  return new HttpError(400, ERROR_CODES.VALIDATION_FAILED, message, { field });
}

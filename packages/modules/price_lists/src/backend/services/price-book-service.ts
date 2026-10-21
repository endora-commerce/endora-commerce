import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  priceBookRowShapeIssues,
  type BasePricesWrite,
  type PriceBookAudience,
  type PriceBookCreate,
  type PriceBookRowBatch,
  type PriceBookRowInput,
  PRICE_BOOK_MAX_ROWS,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel, type SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListAudienceMember } from '../entities/price-list-audience-member.entity.js';
import { PriceListMatrixEntry } from '../entities/price-list-matrix-entry.entity.js';
import { attributeInactiveReason } from './attribute-eligibility.js';
import {
  baseBookRowIssues,
  planBasePriceRows,
  plannedRowOf,
  rowOverlaps,
  type PlannedRow,
  type RuleIssue,
} from './price-book-rules.js';
import type { PriceListTargetReads } from './price-list-service.js';

/**
 * The price-book write service — feature 160 (D-287 P1,
 * `specs/160-pricing-model-v2/contracts/admin-price-books-api.md`).
 *
 * **Every write is one Command Bus command** (Principle XIII): one audit row on
 * `objectType: 'price_list'` with the state before and after, committed with
 * the write, and the pricing generation bumped **after** commit (P0's seam, so
 * every process drops its cached prices only once the new ones are readable).
 *
 * **Channel sets go through `SalesChannelMembershipService`** (Principle XII):
 * the bridge `sales_channel_price_lists` is registered by this module and
 * written only by the membership accessor, inside the command's transaction.
 *
 * What is here is what the resolver stories need — base prices, books with
 * their audience and channel sets, rows, activation. The book patch, draftify,
 * delete, duplicate and the HTTP routes are the admin story's (US7).
 */

export interface PriceBookServiceDeps {
  emFactory: () => EntityManager;
  /** Required for every write; a composition without one gets a refusal, not an unaudited write. */
  commandBus?: CommandBus;
  /** `PricingGeneration` in a composition: bumped after every committed write. */
  pricingGeneration: { invalidateAll(): void | Promise<void> };
  /** The kernel's membership accessor; every channel-set read and write refuses without it. */
  channelMembership?: Pick<
    SalesChannelMembershipPort,
    'replaceChannelsForEntity' | 'listChannelsForEntity'
  >;
  targetReads: Pick<
    PriceListTargetReads,
    'organizationDetails' | 'customerGroupRead' | 'catalogAttributeRead' | 'catalogProductRead' | 'catalogCategoryRead'
  >;
}

/** The platform default currency's base book keeps the id the old `Default` list had. */
export const DEFAULT_BASE_BOOK_ID = '00000000-0000-4000-8000-00000000d51b';

export interface PriceBookView {
  id: string;
  name: string;
  type: 'regular' | 'sale';
  status: 'draft' | 'scheduled' | 'active' | 'expired';
  currencyCode: string;
  audience: { kind: PriceBookAudience['kind']; memberIds: string[] };
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  isSystem: boolean;
}

export interface PriceBookChannelSet {
  channels: Array<{ channelId: string; dormant: boolean }>;
}

export interface PriceBookRowView extends PlannedRow {
  id: string;
}

const refuse = (issues: readonly RuleIssue[], message = 'The price book write was refused.'): never => {
  throw new HttpError(
    400,
    ERROR_CODES.VALIDATION_FAILED,
    `${message} ${issues.map((i) => i.message).join(' ')}`.trim(),
    issues.map((i) => ({ path: i.path.join('.'), issue: i.message })),
  );
};

export class PriceBookService {
  constructor(private readonly deps: PriceBookServiceDeps) {}

  /** The membership accessor, or a refusal (Principle XII: no hand-rolled bridge access). */
  #membership(): NonNullable<PriceBookServiceDeps['channelMembership']> {
    if (!this.deps.channelMembership) {
      throw new Error(
        "PriceBookService: a price book's channel set is the registered `price-list` bridge, and this " +
          'composition constructed the service without the membership accessor.',
      );
    }
    return this.deps.channelMembership;
  }

  /** Run one audited command, then bump the pricing generation after it committed. */
  async #command<T>(
    action: string,
    objectId: string,
    write: (em: EntityManager) => Promise<{ result: T; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>,
  ): Promise<T> {
    if (!this.deps.commandBus) {
      throw new Error(
        'PriceBookService: price-book writes run through the Command Bus (Principle XIII), and this ' +
          'composition constructed the service without one.',
      );
    }
    const result = await this.deps.commandBus.run({
      action,
      objectType: 'price_list',
      objectId,
      run: async ({ em }) => write(em),
    });
    await this.deps.pricingGeneration.invalidateAll();
    return result;
  }

  // ---- Base prices (FR-009) ---------------------------------------------------

  /**
   * Replace one product's base price — its tiers and its variants' rows — in
   * every currency the write names, as **one** command. A currency's base book
   * is created on first use: the platform default currency's with the id the
   * old `Default` list had, any other with a new one.
   */
  async setBasePrices(productId: string, write: BasePricesWrite): Promise<{ bookIds: Record<string, string> }> {
    const currencies = Object.keys(write.byCurrency).sort();
    if (currencies.length === 0) return { bookIds: {} };
    const product = await this.deps.targetReads.catalogProductRead.findById(productId);
    if (!product) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Product ${productId} not found.`);
    }
    const variantIds = new Set(
      (await this.deps.targetReads.catalogProductRead.listVariantsByProductIds([productId])).map((v) => v.id),
    );
    const planned = new Map<string, PlannedRow[]>();
    const issues: RuleIssue[] = [];
    for (const currencyCode of currencies) {
      const plan = planBasePriceRows({
        productId,
        currencyCode,
        prices: write.byCurrency[currencyCode]!,
        variantIdsOfProduct: variantIds,
      });
      issues.push(...plan.issues);
      planned.set(currencyCode, plan.rows);
    }
    if (issues.length > 0) refuse(issues, 'The base prices were refused.');

    const em = this.deps.emFactory();
    const existing = await em.find(PriceList, { isSystem: true, currency: { $in: currencies } });
    const bookIds: Record<string, string> = {};
    const toCreate: string[] = [];
    for (const code of currencies) {
      const held = existing.find((b) => b.currency.toUpperCase() === code);
      if (held) bookIds[code] = held.id;
      else toCreate.push(code);
    }
    if (toCreate.length > 0) {
      const defaultCurrency = (await em.findOne(SalesChannel, { systemDefault: true }))?.defaultCurrency ?? null;
      const defaultIdTaken = (await em.count(PriceList, { id: DEFAULT_BASE_BOOK_ID })) > 0;
      for (const code of toCreate) {
        bookIds[code] = code === defaultCurrency && !defaultIdTaken ? DEFAULT_BASE_BOOK_ID : randomUUID();
      }
    }

    return this.#command('price_list.base_prices_set', bookIds[currencies[0]!]!, async (txEm) => {
      for (const code of toCreate) {
        const book = txEm.create(PriceList, {
            id: bookIds[code]!,
            code: `base-${code.toLowerCase()}`,
            name: `Base prices ${code}`,
            currency: code,
            isDefault: false,
            priority: 0,
            type: 'regular',
            status: 'active',
            audienceKind: 'everyone',
            applicationRule: null,
            isSystem: true,
            modifiedAt: new Date(),
        });
        // See `createBook`: a book carries no rule, and `em.create` drops the null.
        book.applicationRule = null;
        txEm.persist(book);
      }
      await txEm.flush();
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const code of currencies) {
        const bookId = bookIds[code]!;
        const old = await txEm.find(PriceListMatrixEntry, { priceListId: bookId, productId });
        before[code] = old.map(rowState);
        await txEm.nativeDelete(PriceListMatrixEntry, { priceListId: bookId, productId });
        const rows = planned.get(code)!;
        for (const row of rows) txEm.persist(txEm.create(PriceListMatrixEntry, { priceListId: bookId, ...row }));
        after[code] = rows.map(rowState);
      }
      return {
        result: { bookIds },
        before: { productId, byCurrency: before },
        after: { productId, byCurrency: after, createdBaseBooks: toCreate },
      };
    });
  }

  // ---- Books -----------------------------------------------------------------

  /**
   * Create a price book as a draft (FR-001): one currency, an audience set of
   * one kind whose members exist (FR-002, A4), and a channel set whose every
   * channel offers the currency (FR-003, K2).
   */
  async createBook(input: PriceBookCreate): Promise<PriceBookView> {
    const currencyCode = input.currencyCode.toUpperCase();
    await this.#assertAudience(input.audience);
    const em = this.deps.emFactory();
    await this.#assertChannelsOffer(em, currencyCode, input.channelIds);
    const id = randomUUID();
    return this.#command('price_list.create', id, async (txEm) => {
      const book = txEm.create(PriceList, {
        id,
        code: `pb-${id}`,
        name: input.name,
        currency: currencyCode,
        isDefault: false,
        priority: input.priority,
        type: input.type,
        status: 'draft',
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        audienceKind: input.audience.kind,
        applicationRule: null,
        isSystem: false,
        modifiedAt: new Date(),
      });
      // `em.create` drops a `null` JSON value and the column default (an old-model
      // rule) would apply; a price book carries no rule, so it is set here.
      book.applicationRule = null;
      txEm.persist(book);
      // No ORM relation orders the inserts, so the header goes first.
      await txEm.flush();
      for (const memberId of input.audience.memberIds) {
        txEm.persist(
          txEm.create(PriceListAudienceMember, {
            priceListId: id,
            organizationId: input.audience.kind === 'organizations' ? memberId : null,
            customerGroupId: input.audience.kind === 'customer_groups' ? memberId : null,
          }),
        );
      }
      await txEm.flush();
      if (input.channelIds.length > 0) {
        await this.#membership().replaceChannelsForEntity(
          'price-list',
          id,
          input.channelIds as [string, ...string[]],
          { em: txEm },
        );
      }
      const view = viewOf(book, [...input.audience.memberIds]);
      return { result: view, before: null, after: { ...view, channelIds: [...input.channelIds] } };
    });
  }

  /**
   * Replace a book's channel set through the membership accessor (FR-003). Every
   * channel must offer the book's currency now; a binding whose channel later
   * stops offering it stays and is **dormant** (FR-011), which
   * {@link channelSet} reports.
   */
  async replaceChannels(bookId: string, channelIds: readonly string[]): Promise<PriceBookChannelSet> {
    const em = this.deps.emFactory();
    const book = await this.#book(em, bookId);
    if (book.isSystem) {
      refuse([{ path: ['channelIds'], message: 'A base book is channel-independent and has no channel set.' }]);
    }
    if (channelIds.length === 0) {
      refuse([{ path: ['channelIds'], message: 'A price book needs at least one sales channel.' }]);
    }
    await this.#assertChannelsOffer(em, book.currency, channelIds);
    const before = (await this.#membership().listChannelsForEntity('price-list', bookId)).map((c) => c.id);
    await this.#command('price_list.channels_replace', bookId, async (txEm) => {
      await this.#membership().replaceChannelsForEntity(
        'price-list',
        bookId,
        channelIds as [string, ...string[]],
        { em: txEm },
      );
      return { result: undefined, before: { channelIds: before.sort() }, after: { channelIds: [...channelIds].sort() } };
    });
    return this.channelSet(bookId);
  }

  /** A book's channel set, each binding marked dormant while its channel does not offer the currency. */
  async channelSet(bookId: string): Promise<PriceBookChannelSet> {
    const em = this.deps.emFactory();
    const book = await this.#book(em, bookId);
    const channels = await this.#membership().listChannelsForEntity('price-list', bookId);
    return {
      channels: channels
        .map((c) => ({
          channelId: c.id,
          dormant: !c.currencies.map((x) => x.toUpperCase()).includes(book.currency.toUpperCase()),
        }))
        .sort((a, b) => (a.channelId < b.channelId ? -1 : 1)),
    };
  }

  /**
   * Upsert and delete a book's rows as **one** command (FR-035). Shape rules
   * (FR-005, FR-006), the base book's rules (FR-009), attribute eligibility at
   * write (FR-007), no overlapping windows on one selection (FR-006) and the
   * per-book limit are checked before anything is written.
   */
  async replaceRows(bookId: string, batch: PriceBookRowBatch): Promise<{ rows: PriceBookRowView[] }> {
    const em = this.deps.emFactory();
    const book = await this.#book(em, bookId);
    const issues: RuleIssue[] = [];
    const planned: Array<PlannedRow & { id: string }> = [];
    for (const [i, row] of batch.upsert.entries()) {
      const at = (issue: RuleIssue): RuleIssue => ({ ...issue, path: ['upsert', String(i), ...issue.path] });
      issues.push(...priceBookRowShapeIssues(row).map(at));
      if (book.isSystem) issues.push(...baseBookRowIssues(row).map(at));
      issues.push(...(await this.#selectionIssues(row)).map(at));
      planned.push({ id: row.id ?? randomUUID(), ...plannedRowOf(row, row.selection.productId ?? null) });
    }
    if (issues.length > 0) refuse(issues);

    const kept = (await em.find(PriceListMatrixEntry, { priceListId: bookId })).filter(
      (e) => !batch.delete.includes(e.id) && !planned.some((p) => p.id === e.id),
    );
    const all = [...kept.map(plannedOfEntity), ...planned];
    if (all.length > PRICE_BOOK_MAX_ROWS) {
      refuse([{ path: ['upsert'], message: `A price book holds at most ${PRICE_BOOK_MAX_ROWS} rows.` }]);
    }
    const overlaps = rowOverlaps(all);
    if (overlaps.length > 0) {
      refuse(
        overlaps.map(([, b]) => ({
          path: ['upsert'],
          message: `Row ${all[b]!.id} overlaps another row of the same selection in its quantity window.`,
        })),
      );
    }

    return this.#command('price_list.rows_replace', bookId, async (txEm) => {
      const ids = [...batch.delete, ...planned.map((p) => p.id)];
      const before = ids.length === 0 ? [] : await txEm.find(PriceListMatrixEntry, { priceListId: bookId, id: { $in: ids } });
      if (ids.length > 0) await txEm.nativeDelete(PriceListMatrixEntry, { priceListId: bookId, id: { $in: ids } });
      for (const row of planned) txEm.persist(txEm.create(PriceListMatrixEntry, { priceListId: bookId, ...row }));
      return {
        result: { rows: planned },
        before: { rows: before.map(rowState) },
        after: { rows: planned.map(rowState), deleted: [...batch.delete] },
      };
    });
  }

  /**
   * Activate a draft (or re-evaluate a scheduled) book: `scheduled` when it
   * starts in the future, `expired` when it already ended, `active` otherwise.
   * Refused when it would apply to no one or nowhere: a non-system book needs
   * a channel binding that is not dormant, and a non-everyone book a member.
   */
  async activate(bookId: string): Promise<PriceBookView> {
    const em = this.deps.emFactory();
    const book = await this.#book(em, bookId);
    if (book.isSystem) return viewOf(book, []);
    const issues: RuleIssue[] = [];
    const { channels } = await this.channelSet(bookId);
    if (!channels.some((c) => !c.dormant)) {
      issues.push({
        path: ['channelIds'],
        message: `The book is bound to no sales channel that offers ${book.currency}; it would apply nowhere.`,
      });
    }
    const members = await em.find(PriceListAudienceMember, { priceListId: bookId });
    if (book.audienceKind !== 'everyone' && members.length === 0) {
      issues.push({ path: ['audience', 'memberIds'], message: 'The book has no audience member; it would apply to no one.' });
    }
    if (issues.length > 0) refuse(issues, 'The price book cannot be activated.');
    const now = Date.now();
    const next: PriceList['status'] =
      book.endsAt && book.endsAt.getTime() <= now
        ? 'expired'
        : book.startsAt && book.startsAt.getTime() > now
          ? 'scheduled'
          : 'active';
    const action = next === 'expired' ? 'price_list.expire' : 'price_list.activate';
    return this.#command(action, bookId, async (txEm) => {
      const row = await txEm.findOneOrFail(PriceList, { id: bookId });
      const before = { status: row.status };
      row.status = next;
      row.modifiedAt = new Date();
      await txEm.flush();
      return { result: viewOf(row, members.map(memberIdOf)), before, after: { status: next } };
    });
  }

  // ---- Internals ------------------------------------------------------------

  async #book(em: EntityManager, bookId: string): Promise<PriceList> {
    const book = await em.findOne(PriceList, { id: bookId });
    // A list of the old engine is not a price book: it answers as missing here.
    // `!= null`: the ORM hydrates a SQL null as `undefined` (`forceUndefined`).
    if (!book || (book.applicationRule != null && !book.isSystem)) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Price book ${bookId} not found.`);
    }
    return book;
  }

  /** FR-002, A4 — every member exists and is of the set's kind. */
  async #assertAudience(audience: PriceBookAudience): Promise<void> {
    if (audience.kind === 'everyone' || audience.memberIds.length === 0) return;
    const ids = audience.memberIds;
    const orgs = new Set((await this.deps.targetReads.organizationDetails.findByIds(ids)).map((o) => o.id));
    const groups = new Set((await this.deps.targetReads.customerGroupRead.findByIds(ids)).map((g) => g.id));
    const issues: RuleIssue[] = [];
    ids.forEach((id, i) => {
      const ofKind = audience.kind === 'organizations' ? orgs.has(id) : groups.has(id);
      if (ofKind) return;
      const ofOther = audience.kind === 'organizations' ? groups.has(id) : orgs.has(id);
      issues.push({
        path: ['audience', 'memberIds', String(i)],
        message: ofOther
          ? 'An audience set is of one kind: organizations and customer groups cannot be mixed.'
          : `Audience member ${id} does not exist.`,
      });
    });
    if (issues.length > 0) refuse(issues, 'The audience set was refused.');
  }

  /** FR-003, K2 — every channel exists and offers the currency, naming the ones that do not. */
  async #assertChannelsOffer(em: EntityManager, currencyCode: string, channelIds: readonly string[]): Promise<void> {
    if (channelIds.length === 0) return;
    const channels = await em.find(SalesChannel, { id: { $in: [...channelIds] } });
    const issues: RuleIssue[] = [];
    channelIds.forEach((id, i) => {
      const channel = channels.find((c) => c.id === id);
      if (!channel) {
        issues.push({ path: ['channelIds', String(i)], message: `Sales channel ${id} does not exist.` });
        return;
      }
      if (!channel.currencies.map((c) => c.toUpperCase()).includes(currencyCode.toUpperCase())) {
        issues.push({
          path: ['channelIds', String(i)],
          message: `Sales channel ${channel.code} does not offer ${currencyCode.toUpperCase()}.`,
        });
      }
    });
    if (issues.length > 0) refuse(issues, 'The channel set was refused.');
  }

  /** What a row's selection names exists, and an attribute selection is eligible (FR-007). */
  async #selectionIssues(row: PriceBookRowInput): Promise<RuleIssue[]> {
    const { selection } = row;
    const reads = this.deps.targetReads;
    const issues: RuleIssue[] = [];
    if (selection.variantId) {
      if (!selection.productId) {
        issues.push({ path: ['selection', 'productId'], message: 'A variant row names its product.' });
      } else if (!(await reads.catalogProductRead.findVariantInProduct(selection.productId, selection.variantId))) {
        issues.push({ path: ['selection', 'variantId'], message: 'This variant does not belong to the product.' });
      }
    } else if (selection.productId && (await reads.catalogProductRead.countByIds([selection.productId])) === 0) {
      issues.push({ path: ['selection', 'productId'], message: `Product ${selection.productId} does not exist.` });
    }
    if (selection.categoryId && (await reads.catalogCategoryRead.countByIds([selection.categoryId])) === 0) {
      issues.push({ path: ['selection', 'categoryId'], message: `Category ${selection.categoryId} does not exist.` });
    }
    if (selection.attribute) {
      const reason = attributeInactiveReason(await reads.catalogAttributeRead.getByIdOrKey(selection.attribute.key));
      if (reason !== null) {
        issues.push({
          path: ['selection', 'attribute'],
          message: `Attribute ${selection.attribute.key} cannot select prices (${reason}).`,
        });
      }
    }
    return issues;
  }
}

function memberIdOf(m: PriceListAudienceMember): string {
  return (m.organizationId ?? m.customerGroupId)!;
}

function viewOf(book: PriceList, memberIds: string[]): PriceBookView {
  return {
    id: book.id,
    name: book.name,
    type: book.type === 'sale' ? 'sale' : 'regular',
    status: book.status,
    currencyCode: book.currency,
    audience: { kind: book.audienceKind, memberIds },
    priority: book.priority,
    startsAt: book.startsAt ? book.startsAt.toISOString() : null,
    endsAt: book.endsAt ? book.endsAt.toISOString() : null,
    isSystem: book.isSystem,
  };
}

function plannedOfEntity(e: PriceListMatrixEntry): PlannedRow & { id: string } {
  return {
    id: e.id,
    variantId: e.variantId,
    productId: e.productId,
    categoryId: e.categoryId,
    attributeKey: e.attributeKey,
    attributeValue: e.attributeValue,
    minQuantity: e.minQuantity,
    maxQuantity: e.maxQuantity,
    priceType: e.priceType === 'discount_percent' ? 'percent' : e.priceType,
    amount: e.amount,
    percent: e.percent,
  };
}

function rowState(row: PlannedRow | PriceListMatrixEntry): Record<string, unknown> {
  return {
    ...('id' in row ? { id: row.id } : {}),
    variantId: row.variantId,
    productId: row.productId,
    categoryId: row.categoryId,
    attributeKey: row.attributeKey,
    attributeValue: row.attributeValue,
    minQuantity: row.minQuantity,
    maxQuantity: row.maxQuantity,
    priceType: row.priceType,
    amount: row.amount,
    percent: row.percent,
  };
}

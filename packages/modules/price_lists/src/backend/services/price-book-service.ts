import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  priceBookRowsWriteSchema,
  priceBookSelectionKind,
  type BasePricesWrite,
  type PriceBook,
  type PriceBookAudience,
  type PriceBookCreate,
  type PriceBookDuplicate,
  type PriceBookPatchRequest,
  type PriceBookRowBatch,
  type PriceBookRowError,
  type PriceBookRowsDryRun,
  type PriceBookRowsWriteResult,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel, type SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListAudienceMember } from '../entities/price-list-audience-member.entity.js';
import { PriceListMatrixEntry } from '../entities/price-list-matrix-entry.entity.js';
import { multiplySignedAmount } from './matrix-decimal.js';
import { planBasePriceRows, type PlannedRow, type RuleIssue } from './price-book-rules.js';
import {
  batchNeeds,
  diffRowOf,
  normaliseCategoryPath,
  parseBatchRows,
  planBatch,
  type BatchLookups,
  type StoredRow,
} from './price-book-batch.js';
import type { PriceBookReads } from './price-book-reads.js';
import {
  audienceKindWritable,
  bookVisible,
  bookWritable,
  organizationInScope,
  type PriceBookScope,
} from './price-book-scope.js';
import type { PriceListTargetReads } from './price-list-service.js';

/**
 * The price-book write service — feature 160 (D-287 P1,
 * `specs/160-pricing-model-v2/contracts/admin-price-books-api.md`).
 *
 * **Every write is one Command Bus command** (Principle XIII): one audit row on
 * `objectType: 'price_list'` with the state before and after, committed with
 * the write, and the pricing generation bumped **after** commit (P0's seam, so
 * every process drops its cached prices only once the new ones are readable).
 * Every write to a book moves its `version` in the same transaction; a write
 * that names an older version is refused `409 PRICE_BOOK_STALE` and writes
 * nothing (G5).
 *
 * **Channel sets go through `SalesChannelMembershipService`** (Principle XII):
 * the bridge `sales_channel_price_lists` is registered by this module and
 * written only by the membership accessor, inside the command's transaction.
 *
 * **Scope** (FR-034) is the caller's: an admin route passes the request's
 * {@link PriceBookScope}; an internal caller (a worker, a fixture) reaches
 * every book.
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
  /** The admin reads, for the answers of a write (the book, the labelled rows). */
  reads?: PriceBookReads;
}

/** The platform default currency's base book keeps the id the old `Default` list had. */
export const DEFAULT_BASE_BOOK_ID = '00000000-0000-4000-8000-00000000d51b';

/** Every book: what an internal caller (worker, fixture) acts with. */
export const ALL_BOOKS_SCOPE: PriceBookScope = { all: true, organizationIds: new Set() };

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

const validation = (
  issues: readonly RuleIssue[],
  message: string,
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES] = ERROR_CODES.VALIDATION_FAILED,
): never => {
  throw new HttpError(
    400,
    code,
    `${message} ${issues.map((i) => i.message).join(' ')}`.trim(),
    issues.map((i) => ({ path: i.path.join('.'), issue: i.message })),
  );
};

const notFound = (): never => {
  throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
};

const readOnly = (): never => {
  throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'This price book is read-only for you.');
};

const stale = (currentVersion: number): never => {
  throw new HttpError(409, ERROR_CODES.PRICE_BOOK_STALE, 'The price book changed since you opened it. Reload it and apply your changes again.', {
    currentVersion,
  });
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

  #reads(): PriceBookReads {
    if (!this.deps.reads) throw new Error('PriceBookService: the admin reads were not composed.');
    return this.deps.reads;
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

  /**
   * Move a book's version inside a command: conditionally on the version the
   * write was made against, when it names one, so two writes racing past the
   * early check cannot both commit (G5).
   */
  async #bumpVersion(em: EntityManager, bookId: string, expectedVersion: number | null): Promise<number> {
    const rows = (await em
      .getConnection()
      .execute(
        expectedVersion === null
          ? `update "price_lists" set "version" = "version" + 1, "updated_at" = now() where "id" = ? returning "version"`
          : `update "price_lists" set "version" = "version" + 1, "updated_at" = now() where "id" = ? and "version" = ? returning "version"`,
        expectedVersion === null ? [bookId] : [bookId, expectedVersion],
        'all',
        em.getTransactionContext(),
      )) as Array<{ version: number }>;
    if (rows.length === 0) {
      const current = await em.findOne(PriceList, { id: bookId }, { fields: ['version'] });
      stale(current?.version ?? 0);
    }
    return Number(rows[0]!.version);
  }

  // ---- Base prices (FR-009) ---------------------------------------------------

  /**
   * Replace one product's base price — its tiers and its variants' rows — in
   * every currency the write names, as **one** command. A currency's base book
   * is created on first use: the platform default currency's with the id the
   * old `Default` list had, any other with a new one.
   *
   * `keepVariantRows` (FR-049, `priceBookWritePort.replaceProductBaseTiers`)
   * replaces only the product-level rows and leaves the variants' base rows as
   * they are — `write.byCurrency[code].variants` must then be empty. A kept
   * percentage or amount adjustment still needs the product's own base price,
   * so clearing the product's tiers under one is refused, as it is here when
   * the adjustment is part of the write.
   */
  async setBasePrices(
    productId: string,
    write: BasePricesWrite,
    options: { keepVariantRows?: boolean } = {},
  ): Promise<{ bookIds: Record<string, string> }> {
    const keepVariantRows = options.keepVariantRows === true;
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
      if (keepVariantRows && Object.keys(write.byCurrency[currencyCode]!.variants ?? {}).length > 0) {
        issues.push({
          path: ['byCurrency', currencyCode, 'variants'],
          message: 'Variant rows are kept by this write and cannot be named in it.',
        });
      }
      const plan = planBasePriceRows({
        productId,
        currencyCode,
        prices: write.byCurrency[currencyCode]!,
        variantIdsOfProduct: variantIds,
      });
      issues.push(...plan.issues);
      planned.set(currencyCode, plan.rows);
    }
    if (issues.length > 0) validation(issues, 'The base prices were refused.');

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
          name: `Base prices ${code}`,
          currency: code,
          priority: 0,
          type: 'regular',
          status: 'active',
          audienceKind: 'everyone',
          isSystem: true,
          everActivated: true,
        });
        txEm.persist(book);
      }
      await txEm.flush();
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const code of currencies) {
        const bookId = bookIds[code]!;
        const replaced = keepVariantRows ? { priceListId: bookId, productId, variantId: null } : { priceListId: bookId, productId };
        const old = await txEm.find(PriceListMatrixEntry, replaced);
        before[code] = old.map(rowState);
        const rows = planned.get(code)!;
        if (keepVariantRows && rows.length === 0) {
          const adjusted = await txEm.count(PriceListMatrixEntry, {
            priceListId: bookId,
            productId,
            variantId: { $ne: null },
            priceType: { $in: ['percent', 'amount'] },
          });
          if (adjusted > 0) {
            validation(
              [
                {
                  path: ['byCurrency', code, 'product'],
                  message: "A variant's percentage or amount adjustment needs the product's own base price in this currency.",
                },
              ],
              'The base prices were refused.',
            );
          }
        }
        await txEm.nativeDelete(PriceListMatrixEntry, replaced);
        for (const row of rows) txEm.persist(txEm.create(PriceListMatrixEntry, { priceListId: bookId, ...row }));
        await txEm.flush();
        if (!toCreate.includes(code)) await this.#bumpVersion(txEm, bookId, null);
        after[code] = rows.map(rowState);
      }
      return {
        result: { bookIds },
        before: { productId, byCurrency: before },
        after: { productId, byCurrency: after, createdBaseBooks: toCreate, ...(keepVariantRows ? { variantRowsKept: true } : {}) },
      };
    });
  }

  /**
   * One product's base price per currency, with each variant's row (`null` =
   * inherits), and whether `scope` may write them (G11 of 161): base books are
   * everyone's prices, which only a caller reaching every book changes.
   */
  async basePrices(productId: string, scope: PriceBookScope = ALL_BOOKS_SCOPE): Promise<{
    productId: string;
    writable: boolean;
    byCurrency: Record<
      string,
      {
        bookId: string;
        product: Array<{ minQuantity: number; maxQuantity: number | null; amount: string }>;
        variants: Record<string, null | { type: 'fixed'; tiers: Array<{ minQuantity: number; maxQuantity: number | null; amount: string }> } | { type: 'percent'; percent: string } | { type: 'amount'; amount: string }>;
      }
    >;
  }> {
    const product = await this.deps.targetReads.catalogProductRead.findById(productId);
    if (!product) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Product ${productId} not found.`);
    const variants = await this.deps.targetReads.catalogProductRead.listVariantsByProductIds([productId]);
    const em = this.deps.emFactory();
    const books = await em.find(PriceList, { isSystem: true }, { orderBy: { currency: 'asc' } });
    const entries =
      books.length === 0
        ? []
        : await em.find(PriceListMatrixEntry, { priceListId: { $in: books.map((b) => b.id) }, productId }, { orderBy: { minQuantity: 'asc' } });
    const byCurrency: Awaited<ReturnType<PriceBookService['basePrices']>>['byCurrency'] = {};
    for (const book of books) {
      const own = entries.filter((e) => e.priceListId === book.id);
      const variantRows: Record<string, unknown> = {};
      for (const variant of variants) {
        const rows = own.filter((e) => e.variantId === variant.id);
        if (rows.length === 0) variantRows[variant.id] = null;
        else if (rows[0]!.priceType === 'percent') variantRows[variant.id] = { type: 'percent', percent: rows[0]!.percent };
        else if (rows[0]!.priceType === 'amount') variantRows[variant.id] = { type: 'amount', amount: rows[0]!.amount };
        else
          variantRows[variant.id] = {
            type: 'fixed',
            tiers: rows.map((r) => ({ minQuantity: r.minQuantity, maxQuantity: r.maxQuantity ?? null, amount: r.amount! })),
          };
      }
      byCurrency[book.currency.trim().toUpperCase()] = {
        bookId: book.id,
        product: own
          .filter((e) => e.variantId == null)
          .map((e) => ({ minQuantity: e.minQuantity, maxQuantity: e.maxQuantity ?? null, amount: e.amount! })),
        variants: variantRows as never,
      };
    }
    return {
      productId,
      byCurrency,
      writable: bookWritable(scope, { audienceKind: 'everyone', isSystem: true, organizationIds: [] }),
    };
  }

  // ---- Books -----------------------------------------------------------------

  /**
   * Create a price book as a draft (FR-001): one currency, an audience set of
   * one kind whose members exist (FR-002, A4), and a channel set whose every
   * channel offers the currency (FR-003, K2).
   */
  async createBook(input: PriceBookCreate, scope: PriceBookScope = ALL_BOOKS_SCOPE): Promise<PriceBookView> {
    if (!audienceKindWritable(scope, input.audience.kind)) readOnly();
    const currencyCode = input.currencyCode.toUpperCase();
    await this.#assertAudience(input.audience, scope);
    const em = this.deps.emFactory();
    await this.#assertChannelsOffer(em, currencyCode, input.channelIds);
    const id = randomUUID();
    return this.#command('price_list.create', id, async (txEm) => {
      const view = await this.#insertBook(txEm, id, {
        name: input.name,
        type: input.type,
        currencyCode,
        priority: input.priority,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        audience: input.audience,
        channelIds: input.channelIds,
      });
      return { result: view, before: null, after: { ...view, channelIds: [...input.channelIds] } };
    });
  }

  async #insertBook(
    txEm: EntityManager,
    id: string,
    input: {
      name: string;
      type: 'regular' | 'sale';
      currencyCode: string;
      priority: number;
      startsAt: string | null;
      endsAt: string | null;
      audience: PriceBookAudience;
      channelIds: readonly string[];
    },
  ): Promise<PriceBookView> {
    const book = txEm.create(PriceList, {
      id,
      name: input.name,
      currency: input.currencyCode,
      priority: input.priority,
      type: input.type,
      status: 'draft',
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      audienceKind: input.audience.kind,
      isSystem: false,
    });
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
      await this.#membership().replaceChannelsForEntity('price-list', id, input.channelIds as [string, ...string[]], { em: txEm });
    }
    return viewOf(book, [...input.audience.memberIds]);
  }

  /**
   * Patch a book's header, channel set and members (FR-004) against the
   * version the caller read (G5), as one command. The currency never changes;
   * the audience kind only while the book was never active; a base book takes
   * no patch.
   */
  async patchBook(
    bookId: string,
    patch: PriceBookPatchRequest,
    options: { expectedVersion: number; scope?: PriceBookScope },
  ): Promise<void> {
    const scope = options.scope ?? ALL_BOOKS_SCOPE;
    const em = this.deps.emFactory();
    const { book, members } = await this.#visibleBook(em, bookId, scope);
    if (!bookWritable(scope, scopedOf(book, members))) readOnly();
    if (book.isSystem) {
      throw new HttpError(409, ERROR_CODES.PRICE_BOOK_IMMUTABLE_FIELD, 'A base book takes no header change.');
    }
    if (book.version !== options.expectedVersion) stale(book.version);
    if (patch.audience && patch.audience.kind !== book.audienceKind && book.everActivated) {
      throw new HttpError(
        409,
        ERROR_CODES.PRICE_BOOK_IMMUTABLE_FIELD,
        'The audience kind of a book that has been active cannot change.',
      );
    }
    if (patch.audience) await this.#assertAudience(patch.audience, scope);
    if (patch.channelIds) {
      // The bridge holds no empty set (a membership is a binding, not a
      // restriction): a book leaves every channel by being drafted or deleted.
      if (patch.channelIds.length === 0) {
        validation([{ path: ['channelIds'], message: 'A price book keeps at least one sales channel once it has one.' }], 'The channel set was refused.');
      }
      await this.#assertChannelsOffer(em, book.currency, patch.channelIds);
    }
    const startsAt = patch.startsAt !== undefined ? patch.startsAt : book.startsAt?.toISOString() ?? null;
    const endsAt = patch.endsAt !== undefined ? patch.endsAt : book.endsAt?.toISOString() ?? null;
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      validation([{ path: ['endsAt'], message: 'endsAt must be after startsAt.' }], 'The price book was refused.');
    }
    const channelsBefore = patch.channelIds
      ? (await this.#membership().listChannelsForEntity('price-list', bookId)).map((c) => c.id).sort()
      : null;

    await this.#command('price_list.update', bookId, async (txEm) => {
      const row = await txEm.findOneOrFail(PriceList, { id: bookId });
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const set = <K extends 'name' | 'priority'>(key: K, value: PriceList[K] | undefined) => {
        if (value === undefined || row[key] === value) return;
        before[key] = row[key];
        after[key] = value;
        row[key] = value;
      };
      set('name', patch.name);
      set('priority', patch.priority);
      if (patch.startsAt !== undefined) {
        before['startsAt'] = row.startsAt?.toISOString() ?? null;
        after['startsAt'] = patch.startsAt;
        row.startsAt = patch.startsAt ? new Date(patch.startsAt) : null;
      }
      if (patch.endsAt !== undefined) {
        before['endsAt'] = row.endsAt?.toISOString() ?? null;
        after['endsAt'] = patch.endsAt;
        row.endsAt = patch.endsAt ? new Date(patch.endsAt) : null;
      }
      if (patch.audience) {
        before['audience'] = { kind: row.audienceKind, memberIds: members.map(memberIdOf).sort() };
        after['audience'] = { kind: patch.audience.kind, memberIds: [...patch.audience.memberIds].sort() };
        row.audienceKind = patch.audience.kind;
        await txEm.nativeDelete(PriceListAudienceMember, { priceListId: bookId });
        for (const memberId of patch.audience.memberIds) {
          txEm.persist(
            txEm.create(PriceListAudienceMember, {
              priceListId: bookId,
              organizationId: patch.audience.kind === 'organizations' ? memberId : null,
              customerGroupId: patch.audience.kind === 'customer_groups' ? memberId : null,
            }),
          );
        }
      }
      await txEm.flush();
      if (patch.channelIds) {
        before['channelIds'] = channelsBefore;
        after['channelIds'] = [...patch.channelIds].sort();
        await this.#membership().replaceChannelsForEntity('price-list', bookId, patch.channelIds as [string, ...string[]], { em: txEm });
      }
      after['version'] = await this.#bumpVersion(txEm, bookId, options.expectedVersion);
      before['version'] = options.expectedVersion;
      return { result: undefined, before, after };
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
      validation([{ path: ['channelIds'], message: 'A base book is channel-independent and has no channel set.' }], 'The channel set was refused.');
    }
    if (channelIds.length === 0) {
      validation([{ path: ['channelIds'], message: 'A price book needs at least one sales channel.' }], 'The channel set was refused.');
    }
    await this.#assertChannelsOffer(em, book.currency, channelIds);
    const before = (await this.#membership().listChannelsForEntity('price-list', bookId)).map((c) => c.id);
    await this.#command('price_list.channels_replace', bookId, async (txEm) => {
      await this.#membership().replaceChannelsForEntity('price-list', bookId, channelIds as [string, ...string[]], { em: txEm });
      await this.#bumpVersion(txEm, bookId, null);
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
          dormant: ![...c.currencies, c.defaultCurrency].map((x) => x.toUpperCase()).includes(book.currency.toUpperCase()),
        }))
        .sort((a, b) => (a.channelId < b.channelId ? -1 : 1)),
    };
  }

  /**
   * Upsert and delete a book's rows as **one** command (FR-035) — the internal
   * form of {@link writeRows}, without a version to check: a fixture or a
   * worker that writes rows owns the book for the moment.
   */
  async replaceRows(bookId: string, batch: PriceBookRowBatch): Promise<{ rows: PriceBookRowView[] }> {
    const plan = await this.writeRows(bookId, { mode: 'merge', upsert: batch.upsert, delete: batch.delete }, { dryRun: false });
    return { rows: (plan as PriceBookRowsWriteResult & { stored: StoredRow[] }).stored };
  }

  /**
   * The admin batch (G5, G6, G7, G10): the body of `PUT …/:id/rows`, written as
   * one command — or, with `dryRun`, planned and answered without writing.
   * A refusal names every failing row; a stale `expectedVersion` writes nothing.
   */
  async writeRows(
    bookId: string,
    rawBody: unknown,
    options: { dryRun: boolean; expectedVersion?: number | null; scope?: PriceBookScope; language?: string | null },
  ): Promise<PriceBookRowsDryRun | (PriceBookRowsWriteResult & { stored: StoredRow[] })> {
    const scope = options.scope ?? ALL_BOOKS_SCOPE;
    const parsedBody = priceBookRowsWriteSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        parsedBody.error.issues.map((i) => i.message).join(' '),
        parsedBody.error.issues.map((i) => ({ path: i.path.join('.'), issue: i.message })),
      );
    }
    const body = parsedBody.data;
    const expectedVersion = options.expectedVersion ?? body.expectedVersion ?? null;
    const em = this.deps.emFactory();
    const { book, members } = await this.#visibleBook(em, bookId, scope);
    if (!bookWritable(scope, scopedOf(book, members))) readOnly();
    if (expectedVersion !== null && book.version !== expectedVersion) stale(book.version);

    const { parsed, errors: parseErrors } = parseBatchRows(body.upsert);
    const lookups = await this.#lookups(batchNeeds(parsed));
    const stored = await this.#storedRows(em, bookId);
    const plan = planBatch({
      isBaseBook: book.isSystem,
      stored,
      mode: body.mode,
      parsed,
      parseErrors,
      deleteIds: body.delete,
      upsertCount: body.upsert.length,
      lookups,
      newId: () => randomUUID(),
    });

    const keyOf = await this.#naturalKeys([
      ...plan.final,
      ...plan.removed,
      ...plan.changed.map((c) => c.before),
    ]);
    if (options.dryRun) {
      return {
        version: book.version,
        resolved: plan.resolved.map((r) => (r ? diffRowOf(r, keyOf(r), false) : null)),
        diff: {
          added: plan.added.map((r) => diffRowOf(r, keyOf(r), false)),
          changed: plan.changed.map((c) => ({ before: diffRowOf(c.before, keyOf(c.before)), after: diffRowOf(c.after, keyOf(c.after)) })),
          removed: plan.removed.map((r) => diffRowOf(r, keyOf(r))),
          unchangedCount: plan.unchangedCount,
        },
        errors: plan.errors,
      };
    }
    if (plan.errors.length > 0) refuseRows(plan.errors);

    const toDelete = [...plan.removed.map((r) => r.id), ...plan.changed.map((c) => c.before.id)];
    const toInsert = [...plan.added, ...plan.changed.map((c) => c.after)];
    const result = await this.#command('price_list.rows_replace', bookId, async (txEm) => {
      if (toDelete.length > 0) await txEm.nativeDelete(PriceListMatrixEntry, { priceListId: bookId, id: { $in: toDelete } });
      for (const row of toInsert) txEm.persist(txEm.create(PriceListMatrixEntry, { priceListId: bookId, ...row }));
      await txEm.flush();
      const version = await this.#bumpVersion(txEm, bookId, expectedVersion);
      return {
        result: { version },
        before: { rows: [...plan.removed, ...plan.changed.map((c) => c.before)].map(rowState), version: book.version },
        after: { rows: toInsert.map(rowState), deleted: plan.removed.map((r) => r.id), version },
      };
    });
    const written = plan.resolved.filter((r): r is StoredRow => r !== null);
    return {
      version: result.version,
      rows: written.map((r) => diffRowOf(r, keyOf(r))),
      stored: written,
    };
  }

  /**
   * Activate a draft (or re-evaluate a scheduled) book: `scheduled` when it
   * starts in the future, `expired` when it already ended, `active` otherwise.
   * Refused `409 PRICE_BOOK_NOT_APPLICABLE` when it would apply to no one or
   * nowhere: a non-system book needs a channel binding that is not dormant, and
   * a non-everyone book a member.
   */
  async activate(bookId: string, scope: PriceBookScope = ALL_BOOKS_SCOPE): Promise<PriceBookView> {
    const em = this.deps.emFactory();
    const { book, members } = await this.#visibleBook(em, bookId, scope);
    if (!bookWritable(scope, scopedOf(book, members))) readOnly();
    if (book.isSystem) return viewOf(book, []);
    const issues: RuleIssue[] = [];
    const { channels } = await this.channelSet(bookId);
    if (!channels.some((c) => !c.dormant)) {
      issues.push({
        path: ['channelIds'],
        message: `The book is bound to no sales channel that offers ${book.currency}; it would apply nowhere.`,
      });
    }
    if (book.audienceKind !== 'everyone' && members.length === 0) {
      issues.push({ path: ['audience', 'memberIds'], message: 'The book has no audience member; it would apply to no one.' });
    }
    if (issues.length > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.PRICE_BOOK_NOT_APPLICABLE,
        `The price book cannot be activated. ${issues.map((i) => i.message).join(' ')}`,
        issues.map((i) => ({ path: i.path.join('.'), issue: i.message })),
      );
    }
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
      const before = { status: row.status, everActivated: row.everActivated };
      row.status = next;
      row.everActivated = true;
      await txEm.flush();
      await this.#bumpVersion(txEm, bookId, null);
      return { result: viewOf(row, members.map(memberIdOf)), before, after: { status: next, everActivated: true } };
    });
  }

  /** Move a book back to draft: it stops pricing at once; its audience kind stays fixed if it was ever active. */
  async draftify(bookId: string, scope: PriceBookScope = ALL_BOOKS_SCOPE): Promise<void> {
    const em = this.deps.emFactory();
    const { book, members } = await this.#visibleBook(em, bookId, scope);
    if (!bookWritable(scope, scopedOf(book, members))) readOnly();
    if (book.isSystem) {
      throw new HttpError(409, ERROR_CODES.PRICE_BOOK_IMMUTABLE_FIELD, 'A base book is always active.');
    }
    await this.#command('price_list.draftify', bookId, async (txEm) => {
      const row = await txEm.findOneOrFail(PriceList, { id: bookId });
      const before = { status: row.status };
      row.status = 'draft';
      await txEm.flush();
      await this.#bumpVersion(txEm, bookId, null);
      return { result: undefined, before, after: { status: 'draft' } };
    });
  }

  /** Delete a book with its rows, members and channel set; a base book is refused 403. */
  async deleteBook(bookId: string, scope: PriceBookScope = ALL_BOOKS_SCOPE): Promise<void> {
    const em = this.deps.emFactory();
    const { book, members } = await this.#visibleBook(em, bookId, scope);
    if (book.isSystem) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'A base book cannot be deleted.');
    }
    if (!bookWritable(scope, scopedOf(book, members))) readOnly();
    const rowCount = await em.count(PriceListMatrixEntry, { priceListId: bookId });
    const channelIds = (await this.#membership().listChannelsForEntity('price-list', bookId)).map((c) => c.id).sort();
    await this.#command('price_list.delete', bookId, async (txEm) => {
      // The channel set goes with the header: `sales_channel_price_lists`
      // cascades on the book's deletion (the bridge refuses an empty set).
      await txEm.nativeDelete(PriceListMatrixEntry, { priceListId: bookId });
      await txEm.nativeDelete(PriceListAudienceMember, { priceListId: bookId });
      await txEm.nativeDelete(PriceList, { id: bookId });
      return {
        result: undefined,
        before: { ...viewOf(book, members.map(memberIdOf)), rowCount, channelIds },
        after: null,
      };
    });
  }

  /**
   * Duplicate a book into a draft (FR-036): its own name, channel set, currency
   * and audience; fixed and amount rows × `amountMultiplier`, half-up to four
   * places; percentages verbatim. One command, audited on the copy.
   */
  async duplicate(bookId: string, input: PriceBookDuplicate, scope: PriceBookScope = ALL_BOOKS_SCOPE): Promise<PriceBookView> {
    const em = this.deps.emFactory();
    await this.#visibleBook(em, bookId, scope);
    if (!audienceKindWritable(scope, input.audience.kind)) readOnly();
    const currencyCode = input.currencyCode.toUpperCase();
    await this.#assertAudience(input.audience, scope);
    await this.#assertChannelsOffer(em, currencyCode, input.channelIds);
    const source = await this.#book(em, bookId);
    const rows = await this.#storedRows(em, bookId);
    const id = randomUUID();
    return this.#command('price_list.duplicate', id, async (txEm) => {
      const view = await this.#insertBook(txEm, id, {
        name: input.name,
        type: source.type === 'sale' ? 'sale' : 'regular',
        currencyCode,
        priority: source.priority,
        startsAt: source.startsAt?.toISOString() ?? null,
        endsAt: source.endsAt?.toISOString() ?? null,
        audience: input.audience,
        channelIds: input.channelIds,
      });
      for (const row of rows) {
        const { id: _sourceRowId, ...rest } = row;
        txEm.persist(
          txEm.create(PriceListMatrixEntry, {
            ...rest,
            priceListId: id,
            amount: row.priceType === 'percent' || row.amount === null ? row.amount : multiplySignedAmount(row.amount, input.amountMultiplier),
          }),
        );
      }
      await txEm.flush();
      return {
        result: view,
        before: null,
        after: { ...view, sourceBookId: bookId, amountMultiplier: input.amountMultiplier, rowCount: rows.length, channelIds: [...input.channelIds] },
      };
    });
  }

  /** A visible book, as the admin API answers it. */
  async read(bookId: string, scope: PriceBookScope): Promise<PriceBook> {
    return this.#reads().get(bookId, scope);
  }

  // ---- Internals ------------------------------------------------------------

  async #book(em: EntityManager, bookId: string): Promise<PriceList> {
    const book = await em.findOne(PriceList, { id: bookId });
    if (!book) notFound();
    return book!;
  }

  /** The book and its members, or the 404 of a missing one when it is out of scope (FR-034). */
  async #visibleBook(em: EntityManager, bookId: string, scope: PriceBookScope): Promise<{ book: PriceList; members: PriceListAudienceMember[] }> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookId)) notFound();
    const book = await this.#book(em, bookId);
    const members = await em.find(PriceListAudienceMember, { priceListId: bookId });
    if (!bookVisible(scope, scopedOf(book, members))) notFound();
    return { book, members };
  }

  async #storedRows(em: EntityManager, bookId: string): Promise<StoredRow[]> {
    const entries = await em.find(PriceListMatrixEntry, { priceListId: bookId });
    return entries.map(plannedOfEntity);
  }

  /** The batch's targets, in one read per kind (bounded statements for 5 000 rows). */
  async #lookups(needs: ReturnType<typeof batchNeeds>): Promise<BatchLookups> {
    const reads = this.deps.targetReads;
    const [byId, bySku, variantsBySku, categories, attributes] = await Promise.all([
      needs.productIds.size > 0 ? reads.catalogProductRead.findByIds([...needs.productIds]) : Promise.resolve([]),
      needs.productSkus.size > 0 ? reads.catalogProductRead.findBySkus([...needs.productSkus]) : Promise.resolve([]),
      needs.variantSkus.size > 0 ? reads.catalogProductRead.findVariantsBySkus([...needs.variantSkus]) : Promise.resolve([]),
      needs.categoryIds.size > 0 || needs.categoryPaths.size > 0 ? reads.catalogCategoryRead.listAll() : Promise.resolve([]),
      needs.attributeKeys.size > 0 ? reads.catalogAttributeRead.listAll() : Promise.resolve([]),
    ]);
    // A variant named by id is checked against its product's variants.
    const productIdsOfVariants = new Set<string>(needs.productIds);
    const variants =
      needs.variantIds.size > 0 && productIdsOfVariants.size > 0
        ? await reads.catalogProductRead.listVariantsByProductIds([...productIdsOfVariants])
        : [];
    const liveProducts = byId.filter((p) => p.deletedAt === null);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const slugPath = (id: string): string => {
      const parts: string[] = [];
      let current = categoryById.get(id);
      let guard = 0;
      while (current && guard < 64) {
        parts.unshift(current.slug.toLowerCase());
        current = current.parentCategoryId ? categoryById.get(current.parentCategoryId) : undefined;
        guard += 1;
      }
      return parts.join('/');
    };
    const live = categories.filter((c) => c.deletedAt === null);
    return {
      productsById: new Map(liveProducts.map((p) => [p.id, { id: p.id, sku: p.sku }])),
      productsBySku: new Map(bySku.filter((p) => p.deletedAt === null).map((p) => [p.sku, { id: p.id, sku: p.sku }])),
      variantsById: new Map(variants.map((v) => [v.id, { id: v.id, parentProductId: v.parentProductId, sku: v.sku }])),
      variantsBySku: new Map(variantsBySku.map((v) => [v.sku, { id: v.id, parentProductId: v.parentProductId, sku: v.sku }])),
      categoriesById: new Map(live.map((c) => [c.id, { id: c.id }])),
      categoriesByPath: new Map(
        needs.categoryPaths.size > 0 ? live.map((c) => [normaliseCategoryPath(slugPath(c.id)), c.id] as const) : [],
      ),
      attributes: new Map([...needs.attributeKeys].map((key) => [key, attributes.find((a) => a.key === key) ?? null])),
    };
  }

  /** Natural keys of rows, from one labelled read. */
  async #naturalKeys(rows: readonly StoredRow[]): Promise<(row: StoredRow) => ReturnType<typeof diffRowOf>['naturalKey']> {
    if (!this.deps.reads || rows.length === 0) return () => ({});
    const labelled = await this.deps.reads.label(rows, null);
    const byId = new Map(labelled.map((r, i) => [rows[i]!.id, r.naturalKey]));
    return (row) => byId.get(row.id) ?? {};
  }

  /** FR-002, A4 — every member exists, is of the set's kind and (for a representative) in scope. */
  async #assertAudience(audience: PriceBookAudience, scope: PriceBookScope): Promise<void> {
    if (audience.kind === 'everyone' || audience.memberIds.length === 0) return;
    const ids = audience.memberIds;
    const orgs = new Set((await this.deps.targetReads.organizationDetails.findByIds(ids)).map((o) => o.id));
    const groups = new Set((await this.deps.targetReads.customerGroupRead.findByIds(ids)).map((g) => g.id));
    const issues: RuleIssue[] = [];
    ids.forEach((id, i) => {
      // An organization outside the caller's scope is an unknown one (FR-034).
      const visibleOrg = orgs.has(id) && organizationInScope(scope, id);
      const ofKind = audience.kind === 'organizations' ? visibleOrg : groups.has(id);
      if (ofKind) return;
      const ofOther = audience.kind === 'organizations' ? groups.has(id) : visibleOrg;
      issues.push({
        path: ['audience', 'memberIds', String(i)],
        message: ofOther
          ? 'An audience set is of one kind: organizations and customer groups cannot be mixed.'
          : `Audience member ${id} does not exist.`,
      });
    });
    if (issues.length > 0) validation(issues, 'The audience set was refused.', ERROR_CODES.PRICE_BOOK_AUDIENCE_KIND);
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
      if (![...channel.currencies, channel.defaultCurrency].map((c) => c.toUpperCase()).includes(currencyCode.toUpperCase())) {
        issues.push({
          path: ['channelIds', String(i)],
          message: `Sales channel ${channel.code} does not offer ${currencyCode.toUpperCase()}.`,
        });
      }
    });
    if (issues.length > 0) validation(issues, 'The channel set was refused.', ERROR_CODES.PRICE_BOOK_CHANNEL_CURRENCY);
  }
}

/** A refused batch: overlaps alone are a conflict (409); anything else is a bad request (400). */
function refuseRows(errors: readonly PriceBookRowError[]): never {
  const overlapOnly = errors.every((e) => e.code === 'PRICE_BOOK_ROW_OVERLAP');
  const code = overlapOnly
    ? ERROR_CODES.PRICE_BOOK_ROW_OVERLAP
    : errors.some((e) => e.code === 'PRICE_BOOK_ROW_LIMIT') && errors.every((e) => e.code === 'PRICE_BOOK_ROW_LIMIT')
      ? ERROR_CODES.PRICE_BOOK_ROW_LIMIT
      : ERROR_CODES.PRICE_BOOK_ROW_SHAPE;
  throw new HttpError(
    overlapOnly ? 409 : 400,
    code,
    `The price rows were refused: ${errors.length} ${errors.length === 1 ? 'row fails' : 'rows fail'}.`,
    { errors: [...errors] },
  );
}

function scopedOf(book: PriceList, members: readonly PriceListAudienceMember[]) {
  return {
    audienceKind: book.audienceKind,
    isSystem: book.isSystem,
    organizationIds: members.map((m) => m.organizationId).filter((id): id is string => id !== null),
  };
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

/** A stored row. `?? null`: the ORM hydrates a SQL null as `undefined` (`forceUndefined`). */
function plannedOfEntity(e: PriceListMatrixEntry): StoredRow {
  return {
    id: e.id,
    variantId: e.variantId ?? null,
    productId: e.productId ?? null,
    categoryId: e.categoryId ?? null,
    attributeKey: e.attributeKey ?? null,
    attributeValue: e.attributeValue ?? null,
    minQuantity: e.minQuantity,
    maxQuantity: e.maxQuantity ?? null,
    priceType: e.priceType,
    amount: e.amount ?? null,
    percent: e.percent ?? null,
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

export { priceBookSelectionKind };

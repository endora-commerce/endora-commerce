import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  isOrderMinimumEligibleType,
  type AudienceRule,
  type OrganizationDetailsPort,
  type PatchProductScopesRequest,
  type ProductChannelLanguageScopeRecord,
  type ProductChannelScopeRecord,
  type ProductScopes,
  type ProductScopeStatus,
  type PublicationWindow,
  type ScopeCompletenessGateMode,
  type ScopeSnapshot,
  toScopeChannel,
  type ScopeWarning,
  type ScopedWriteOp,
  sameLanguage,
  toScopedWriteOp,
} from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Product } from '../entities/product.entity.js';
import { ProductChannelLanguageScope } from '../entities/product-channel-language-scope.entity.js';
import { ProductChannelScope } from '../entities/product-channel-scope.entity.js';
import { globalScopeFields } from './product-availability.service.js';
import type { ScopeCompletenessGate } from './scope-completeness.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/`) — a product's scoped values per
 * sales channel and per channel × language: status, publication window, audience,
 * minimum order quantity and the returnable flag (`contracts/admin-scopes-api.md`
 * §1–§2, research R1–R4, R10, R29).
 *
 * One write, `apply`, runs as the Command `product.scopes.update`: one audit entry per
 * request whose `before` / `after` are the complete projection of every scope row the
 * request touched, in the request's own shape, so re-sending `before` through the
 * route restores the previous state (FR-080, FR-081). There is no single-write undo
 * by owner decision (Q-D → A). `product.updated.v1` follows the commit with the
 * fields that moved (FR-082). A request that changes nothing writes no audit row and
 * announces nothing.
 *
 * The rules of the write live in {@link planProductScopeWrite}, a pure function the
 * Command runs inside its transaction, so a refusal is a refusal of the whole request
 * with nothing written.
 */

/** The values `product.updated.v1` names for a scope write (R10). */
export type ScopeChangedField = 'scopedStatus' | 'publicationWindow' | 'audience' | 'orderRules';

/** Everything {@link planProductScopeWrite} needs to know about the product, read in the transaction. */
export interface ProductScopeWriteState {
  productId: string;
  productType: string;
  globalWindow: PublicationWindow;
  channelRows: readonly ProductChannelScopeRecord[];
  languageRows: readonly ProductChannelLanguageScopeRecord[];
  /** The product's member channels → their current content languages. */
  memberChannels: ReadonlyMap<string, readonly string[]>;
}

interface ChannelAuditEntry {
  channelId: string;
  status?: ProductScopeStatus | null;
  window?: { from: string | null; until: string | null } | null;
  audience?: AudienceRule | null;
  /** 168-shim: the audit still speaks 163's `null` = inherit; T040 moves it to the write encoding. */
  minOrderQuantityOverridden?: boolean;
  minOrderQuantity?: number | null;
  returnable?: boolean | null;
  languageStatuses: Array<{ languageCode: string; status: ProductScopeStatus | null }>;
}

/** The audit projection — the PATCH body's shape with every touched value explicit. */
export interface ScopeAuditState {
  channels: ChannelAuditEntry[];
  global?: { publishFrom: string | null; publishUntil: string | null };
  [key: string]: unknown;
}

export interface ProductScopeWritePlan {
  /** `next: null` deletes the row. */
  channelRows: Array<{ channelId: string; next: ProductChannelScopeRecord | null }>;
  /** `next: null` deletes the row. */
  languageRows: Array<{ channelId: string; languageCode: string; next: ProductScopeStatus | null }>;
  /** Absent = the global window is untouched. */
  globalWindow?: PublicationWindow;
  changedFields: ScopeChangedField[];
  before: ScopeAuditState;
  after: ScopeAuditState;
}

type ChannelPatch = PatchProductScopesRequest['channels'][number];

const CHANNEL_ROW_KEYS = ['status', 'window', 'audience', 'minOrderQuantity', 'returnable'] as const;

/**
 * What a scopes PATCH writes (`admin-scopes-api.md` §2). Pure; throws the request's
 * refusal as an `HttpError`.
 *
 * - An absent key leaves the stored value; `null` removes the override; a channel row
 *   whose every field inherits is deleted (FR-012).
 * - A value for a channel the product is not a member of is `SCOPE_INVALID`
 *   `not_a_member`; a language status for a language the channel does not offer is
 *   `SCOPE_INVALID` `language_not_offered` — but `null` is always accepted, because
 *   removing an orphaned override is always allowed (FR-014, FR-015).
 * - A channel named twice, or a language named twice within one channel (compared in
 *   the channel's spelling, so case-insensitively), is `VALIDATION_FAILED` with
 *   `details.field` `channels` / `languageStatuses`.
 * - A window whose start is not before its end is `VALIDATION_FAILED`,
 *   `details.field = 'window'`; so is a channel minimum on a type that takes none,
 *   with `details.field = 'minOrderQuantity'` (the feature-155 rule).
 * - A global window change touches no override (FR-013).
 */
export function planProductScopeWrite(
  state: ProductScopeWriteState,
  request: PatchProductScopesRequest,
): ProductScopeWritePlan {
  const seen = new Set<string>();
  for (const entry of request.channels) {
    if (seen.has(entry.channelId)) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A sales channel is named more than once.', {
        field: 'channels',
        channelId: entry.channelId,
      });
    }
    seen.add(entry.channelId);
  }

  const changed = new Set<ScopeChangedField>();
  const plan: ProductScopeWritePlan = {
    channelRows: [],
    languageRows: [],
    changedFields: [],
    before: { channels: [] },
    after: { channels: [] },
  };

  for (const entry of request.channels) {
    const languages = state.memberChannels.get(entry.channelId);
    assertScopeValid(entry, languages);
    const beforeEntry: ChannelAuditEntry = { channelId: entry.channelId, languageStatuses: [] };
    const afterEntry: ChannelAuditEntry = { channelId: entry.channelId, languageStatuses: [] };

    if (CHANNEL_ROW_KEYS.some((key) => entry[key] !== undefined)) {
      const current =
        state.channelRows.find((row) => row.channelId === entry.channelId) ?? emptyRow(state.productId, entry.channelId);
      const next = applyChannelPatch(state, current, entry);
      Object.assign(beforeEntry, channelProjection(current));
      Object.assign(afterEntry, channelProjection(next));
      for (const field of channelChanges(current, next)) changed.add(field);
      plan.channelRows.push({ channelId: entry.channelId, next: inheritsEverything(next) ? null : next });
    }

    const seenLanguages = new Set<string>();
    for (const language of entry.languageStatuses ?? []) {
      const languageCode = channelSpelling(languages, language.languageCode, state.languageRows, entry.channelId);
      if (seenLanguages.has(languageCode.toLowerCase())) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A language is named more than once in one sales channel.', {
          field: 'languageStatuses',
          channelId: entry.channelId,
          languageCode,
        });
      }
      seenLanguages.add(languageCode.toLowerCase());
      const current =
        state.languageRows.find((row) => row.channelId === entry.channelId && row.languageCode === languageCode)
          ?.status ?? null;
      const op = toScopedWriteOp(language.status);
      if (op === undefined) continue;
      const nextStatus = refuseEmpty(op, 'status', { level: 'channel_language', channelId: entry.channelId, languageCode });
      beforeEntry.languageStatuses.push({ languageCode, status: current });
      afterEntry.languageStatuses.push({ languageCode, status: nextStatus });
      if (current !== nextStatus) changed.add('scopedStatus');
      plan.languageRows.push({ channelId: entry.channelId, languageCode, next: nextStatus });
    }

    plan.before.channels.push(beforeEntry);
    plan.after.channels.push(afterEntry);
  }

  if (request.global !== undefined) {
    const from =
      request.global.publishFrom === undefined ? state.globalWindow.from : toDate(request.global.publishFrom);
    const until =
      request.global.publishUntil === undefined ? state.globalWindow.until : toDate(request.global.publishUntil);
    assertWindowOrdered({ from, until }, {});
    plan.globalWindow = { from, until };
    plan.before.global = windowProjection(state.globalWindow, 'publish');
    plan.after.global = windowProjection(plan.globalWindow, 'publish');
    if (!sameInstant(from, state.globalWindow.from) || !sameInstant(until, state.globalWindow.until)) {
      changed.add('publicationWindow');
    }
  }

  plan.changedFields = (['scopedStatus', 'publicationWindow', 'audience', 'orderRules'] as const).filter((field) =>
    changed.has(field),
  );
  return plan;
}

/** Whether a decoded write puts a value (or an empty override) at the scope, rather than removing one. */
function writesAt(raw: unknown): boolean {
  const op = toScopedWriteOp(raw);
  return op !== undefined && op.op !== 'inherit';
}

/**
 * Feature 168 (`contracts/write-encoding.md` §5, FR-116) — `inherit` → `null` (the override goes),
 * `set` → the value; `empty` is refused for a field that takes no empty override
 * (`422 SCOPED_VALUE_INVALID`, `not_emptyable`).
 */
function refuseEmpty<T>(op: ScopedWriteOp<T>, field: string, scope: Record<string, unknown>): T | null {
  if (op.op === 'inherit') return null;
  if (op.op === 'empty') {
    throw new HttpError(422, ERROR_CODES.SCOPED_VALUE_INVALID, `"${field}" takes no empty value.`, {
      fields: [{ field, scope, reason: 'not_emptyable' }],
    });
  }
  return op.value;
}

function assertScopeValid(entry: ChannelPatch, languages: readonly string[] | undefined): void {
  const writesValue =
    CHANNEL_ROW_KEYS.some((key) => writesAt(entry[key])) ||
    (entry.languageStatuses ?? []).some((language) => writesAt(language.status));
  if (languages === undefined) {
    if (!writesValue) return;
    throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The product is not a member of this sales channel.', {
      channelId: entry.channelId,
      reason: 'not_a_member',
    });
  }
  for (const language of entry.languageStatuses ?? []) {
    if (!writesAt(language.status)) continue;
    if (!languages.some((code) => sameLanguage(code, language.languageCode))) {
      throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The sales channel does not offer this language.', {
        channelId: entry.channelId,
        languageCode: language.languageCode,
        reason: 'language_not_offered',
      });
    }
  }
}

/** The channel's own spelling of a language, else the spelling of an existing (orphaned) row, else as given. */
function channelSpelling(
  languages: readonly string[] | undefined,
  requested: string,
  rows: readonly ProductChannelLanguageScopeRecord[],
  channelId: string,
): string {
  const offered = languages?.find((code) => sameLanguage(code, requested));
  if (offered !== undefined) return offered;
  const stored = rows.find((row) => row.channelId === channelId && sameLanguage(row.languageCode, requested));
  return stored?.languageCode ?? requested;
}

function applyChannelPatch(
  state: ProductScopeWriteState,
  current: ProductChannelScopeRecord,
  entry: ChannelPatch,
): ProductChannelScopeRecord {
  const next: ProductChannelScopeRecord = { ...current };
  const scope = { level: 'channel', channelId: entry.channelId };
  const status = toScopedWriteOp(entry.status);
  if (status !== undefined) next.status = refuseEmpty(status, 'status', scope);
  const windowOp = toScopedWriteOp(entry.window);
  if (windowOp !== undefined) {
    if (windowOp.op === 'inherit') {
      next.window = null;
    } else if (windowOp.op === 'empty') {
      // An empty window override = no limit on either side in this channel (data-model §9).
      next.window = { from: null, until: null };
    } else {
      const window = { from: toDate(windowOp.value.from), until: toDate(windowOp.value.until) };
      assertWindowOrdered(window, { channelId: entry.channelId });
      next.window = window;
    }
  }
  const audience = toScopedWriteOp(entry.audience);
  if (audience !== undefined) {
    const value = refuseEmpty(audience, 'audience', scope);
    next.audience =
      value === null
        ? null
        : { visibility: value.visibility, allowedOrganizationIds: [...new Set(value.allowedOrganizationIds)] };
  }
  const moq = toScopedWriteOp(entry.minOrderQuantity);
  if (moq !== undefined) {
    if (moq.op === 'set' && !isOrderMinimumEligibleType(state.productType)) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        `A minimum order quantity applies to simple or configurable products only; got "${state.productType}".`,
        { field: 'minOrderQuantity', channelId: entry.channelId },
      );
    }
    // `inherit` → not overridden; `empty` → overridden with no minimum here; `set` → the value.
    next.minOrderQuantityOverridden = moq.op !== 'inherit';
    next.minOrderQuantity = moq.op === 'set' ? moq.value : null;
  }
  const returnable = toScopedWriteOp(entry.returnable);
  if (returnable !== undefined) next.returnable = refuseEmpty(returnable, 'returnable', scope);
  return next;
}

function assertWindowOrdered(window: PublicationWindow, details: Record<string, unknown>): void {
  if (window.from !== null && window.until !== null && window.from.getTime() >= window.until.getTime()) {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The publication window must start before it ends.', {
      field: 'window',
      ...details,
    });
  }
}

function channelChanges(before: ProductChannelScopeRecord, after: ProductChannelScopeRecord): ScopeChangedField[] {
  const fields: ScopeChangedField[] = [];
  if (before.status !== after.status) fields.push('scopedStatus');
  if (!sameWindow(before.window, after.window)) fields.push('publicationWindow');
  if (JSON.stringify(before.audience) !== JSON.stringify(after.audience)) fields.push('audience');
  if (
    before.minOrderQuantity !== after.minOrderQuantity ||
    before.minOrderQuantityOverridden !== after.minOrderQuantityOverridden ||
    before.returnable !== after.returnable
  ) {
    fields.push('orderRules');
  }
  return fields;
}

/** A channel row whose every field inherits holds no override and is deleted (FR-012). */
export function inheritsEverything(row: ProductChannelScopeRecord): boolean {
  return (
    row.status === null &&
    row.window === null &&
    row.audience === null &&
    !row.minOrderQuantityOverridden &&
    row.returnable === null
  );
}

function emptyRow(productId: string, channelId: string): ProductChannelScopeRecord {
  return {
    productId,
    channelId,
    status: null,
    window: null,
    audience: null,
    minOrderQuantityOverridden: false,
    minOrderQuantity: null,
    returnable: null,
  };
}

function channelProjection(row: ProductChannelScopeRecord): Omit<ChannelAuditEntry, 'channelId' | 'languageStatuses'> {
  return {
    status: row.status,
    window: row.window === null ? null : windowProjection(row.window, 'plain'),
    audience: row.audience === null ? null : { ...row.audience, allowedOrganizationIds: [...row.audience.allowedOrganizationIds] },
    minOrderQuantityOverridden: row.minOrderQuantityOverridden,
    minOrderQuantity: row.minOrderQuantity,
    returnable: row.returnable,
  };
}

function windowProjection(window: PublicationWindow, keys: 'plain'): { from: string | null; until: string | null };
function windowProjection(
  window: PublicationWindow,
  keys: 'publish',
): { publishFrom: string | null; publishUntil: string | null };
function windowProjection(
  window: PublicationWindow,
  keys: 'plain' | 'publish',
): { from: string | null; until: string | null } | { publishFrom: string | null; publishUntil: string | null } {
  const from = window.from?.toISOString() ?? null;
  const until = window.until?.toISOString() ?? null;
  return keys === 'plain' ? { from, until } : { publishFrom: from, publishUntil: until };
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function sameWindow(a: PublicationWindow | null, b: PublicationWindow | null): boolean {
  if (a === null || b === null) return a === b;
  return sameInstant(a.from, b.from) && sameInstant(a.until, b.until);
}

/**
 * The organizations of `organizationIds` the channel does not offer — the C4 warning
 * an audience override carries. Read through the kernel's membership accessor
 * (Constitution XII), never the bridge table.
 */
export async function nonMemberOrganizationIds(
  membership: Pick<SalesChannelMembershipPort, 'filterEntityIdsAvailableInChannel'>,
  channelId: string,
  organizationIds: readonly string[],
): Promise<string[]> {
  if (organizationIds.length === 0) return [];
  const offered = new Set(await membership.filterEntityIdsAvailableInChannel(channelId, 'organization', organizationIds));
  return organizationIds.filter((id) => !offered.has(id));
}

// --- Row ↔ record ---------------------------------------------------------------

export function toChannelRecord(row: ProductChannelScope): ProductChannelScopeRecord {
  return {
    productId: row.productId,
    channelId: row.salesChannelId,
    status: row.status ?? null,
    window: row.windowOverridden ? { from: row.publishFrom ?? null, until: row.publishUntil ?? null } : null,
    audience:
      row.visibility === null || row.visibility === undefined
        ? null
        : { visibility: row.visibility, allowedOrganizationIds: [...(row.allowedOrganizationIds ?? [])] },
    minOrderQuantityOverridden: row.minOrderQuantityOverridden,
    minOrderQuantity: row.minOrderQuantity ?? null,
    returnable: row.returnable ?? null,
  };
}

export function toLanguageRecord(row: ProductChannelLanguageScope): ProductChannelLanguageScopeRecord {
  return {
    productId: row.productId,
    channelId: row.salesChannelId,
    languageCode: row.languageCode,
    status: row.status,
  };
}

function writeChannelRow(row: ProductChannelScope, record: ProductChannelScopeRecord): void {
  row.status = record.status;
  row.windowOverridden = record.window !== null;
  row.publishFrom = record.window?.from ?? null;
  row.publishUntil = record.window?.until ?? null;
  row.visibility = record.audience?.visibility ?? null;
  row.allowedOrganizationIds = record.audience ? [...record.audience.allowedOrganizationIds] : null;
  row.minOrderQuantityOverridden = record.minOrderQuantityOverridden;
  row.minOrderQuantity = record.minOrderQuantityOverridden ? record.minOrderQuantity : null;
  row.returnable = record.returnable;
}

// --- One scope's status, for the bulk edit's undo (FR-052) --------------------------

/** The one scope a bulk scoped-status edit writes: a channel row, or one channel × language. */
export interface StatusScope {
  channelId: string;
  /** `null` = the channel row; matched case-insensitively, as the write does. */
  languageCode: string | null;
}

/**
 * The stored status at `scope` per product — `null` where the scope inherits. Read
 * fresh (`refresh`), since the caller's em may already hold these rows from before a
 * write (MikroORM's merge never lets a fresh `null` replace a loaded value).
 */
export async function readScopedStatuses(
  em: EntityManager,
  productIds: readonly string[],
  scope: StatusScope,
): Promise<Map<string, ProductScopeStatus | null>> {
  const out = new Map<string, ProductScopeStatus | null>(productIds.map((id) => [id, null]));
  if (productIds.length === 0) return out;
  if (scope.languageCode === null) {
    const rows = await em.find(
      ProductChannelScope,
      { productId: { $in: [...productIds] }, salesChannelId: scope.channelId },
      { refresh: true },
    );
    for (const row of rows) out.set(row.productId, row.status ?? null);
    return out;
  }
  const rows = await em.find(
    ProductChannelLanguageScope,
    { productId: { $in: [...productIds] }, salesChannelId: scope.channelId },
    { refresh: true },
  );
  for (const row of rows) {
    if (sameLanguage(row.languageCode, scope.languageCode)) out.set(row.productId, row.status);
  }
  return out;
}

/** The rows of the products a write touches, loaded once and kept current by the writers below. */
export interface ScopeRowSet {
  channelRows: ProductChannelScope[];
  languageRows: ProductChannelLanguageScope[];
}

/** Every scope row of `productIds`, for the writers below. */
export async function loadScopeRows(em: EntityManager, productIds: readonly string[]): Promise<ScopeRowSet> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return { channelRows: [], languageRows: [] };
  const [channelRows, languageRows] = await Promise.all([
    em.find(ProductChannelScope, { productId: { $in: ids } }),
    em.find(ProductChannelLanguageScope, { productId: { $in: ids } }),
  ]);
  return { channelRows, languageRows };
}

/**
 * Checkpoint C code review (C-W3) — **the one write of a channel row**: `next` replaces
 * the row, and a row whose every field inherits (or `next: null`) is deleted (FR-012).
 * On the caller's `em`, inside the caller's Command or transaction; `rows` is kept
 * current. Every writer of `product_channel_scopes` goes through here.
 */
export function writeChannelScopeRow(
  em: EntityManager,
  rows: ScopeRowSet,
  productId: string,
  channelId: string,
  next: ProductChannelScopeRecord | null,
): void {
  // command-coverage-ignore: a helper on the caller's `em`, run only inside the caller's
  // audited Command (the scopes write, the bulk undo) or the import's audited transaction.
  const index = rows.channelRows.findIndex((r) => r.productId === productId && r.salesChannelId === channelId);
  const row = index === -1 ? undefined : rows.channelRows[index];
  if (next === null || inheritsEverything(next)) {
    if (row) {
      em.remove(row);
      rows.channelRows.splice(index, 1);
    }
    return;
  }
  const target = row ?? em.create(ProductChannelScope, { productId, salesChannelId: channelId });
  writeChannelRow(target, next);
  em.persist(target);
  if (!row) rows.channelRows.push(target);
}

/**
 * Checkpoint C code review (C-W3) — **the one write of a channel × language row**:
 * `status` replaces it, `null` deletes it. `languageCode` is matched case-insensitively
 * and a new row takes it as given (the caller passes the channel's spelling).
 */
export function writeLanguageScopeRow(
  em: EntityManager,
  rows: ScopeRowSet,
  productId: string,
  channelId: string,
  languageCode: string,
  status: ProductScopeStatus | null,
): void {
  // command-coverage-ignore: a helper on the caller's `em`, run only inside the caller's
  // audited Command (the scopes write, the bulk undo) or the import's audited transaction.
  const index = rows.languageRows.findIndex(
    (r) => r.productId === productId && r.salesChannelId === channelId && sameLanguage(r.languageCode, languageCode),
  );
  const row = index === -1 ? undefined : rows.languageRows[index];
  if (status === null) {
    if (row) {
      em.remove(row);
      rows.languageRows.splice(index, 1);
    }
    return;
  }
  if (row) {
    row.status = status;
    em.persist(row);
    return;
  }
  const created = em.create(ProductChannelLanguageScope, { productId, salesChannelId: channelId, languageCode, status });
  em.persist(created);
  rows.languageRows.push(created);
}

/**
 * The status at one scope set to `status` (`null` = inherit) — the bulk undo's and the
 * CSV import's write, over the two row writers above. Answers whether anything changed.
 */
export function writeScopedStatus(
  em: EntityManager,
  rows: ScopeRowSet,
  productId: string,
  scope: StatusScope,
  status: ProductScopeStatus | null,
): boolean {
  if (scope.languageCode === null) {
    const row = rows.channelRows.find((r) => r.productId === productId && r.salesChannelId === scope.channelId);
    const current = row ? toChannelRecord(row) : emptyRow(productId, scope.channelId);
    if (current.status === status) return false;
    writeChannelScopeRow(em, rows, productId, scope.channelId, { ...current, status });
    return true;
  }
  const row = rows.languageRows.find(
    (r) => r.productId === productId && r.salesChannelId === scope.channelId && sameLanguage(r.languageCode, scope.languageCode),
  );
  if ((row?.status ?? null) === status) return false;
  writeLanguageScopeRow(em, rows, productId, scope.channelId, scope.languageCode, status);
  return true;
}

/**
 * Put the status at `scope` back to `status` (`null` = inherit) on `em` — the undo of
 * a bulk scoped-status edit, inside its audited `product.bulk_update.undo` Command. A
 * new language row takes the channel's own spelling of the language.
 */
export async function restoreScopedStatus(
  em: EntityManager,
  productId: string,
  scope: StatusScope,
  status: ProductScopeStatus | null,
): Promise<void> {
  let languageCode = scope.languageCode;
  if (languageCode !== null && status !== null) {
    const channel = await em.findOne(SalesChannel, { id: scope.channelId });
    const requested = languageCode;
    languageCode = (channel ? toScopeChannel(channel).languages : []).find((code) => sameLanguage(code, requested)) ?? languageCode;
  }
  writeScopedStatus(em, await loadScopeRows(em, [productId]), productId, { channelId: scope.channelId, languageCode }, status);
}

// --- The service ---------------------------------------------------------------------

/** How a scope write is run (feature 163). */
export interface ScopeWriteOptions {
  /**
   * The completeness gate's mode for this write (FR-060), read by the caller once per
   * request. Absent = the gate does not run: imports, connectors and every other
   * integration path (A-6, FR-061).
   */
  completeness?: ScopeCompletenessGateMode;
}

interface ScopeCommandResult {
  changedFields: ScopeChangedField[];
  /** The completeness gate's warnings in `warn` mode (FR-060). */
  warnings: ScopeWarning[];
}

/** The product's scope state as stored, before a write. */
function snapshotBefore(
  product: Product,
  channelRows: readonly ProductChannelScope[],
  languageRows: readonly ProductChannelLanguageScope[],
): ScopeSnapshot {
  return {
    global: globalScopeFields(product),
    channelRows: channelRows.map(toChannelRecord),
    languageRows: languageRows.map(toLanguageRecord),
  };
}

/** The product's scope state as `plan` would leave it. */
function snapshotAfter(
  product: Product,
  channelRows: readonly ProductChannelScope[],
  languageRows: readonly ProductChannelLanguageScope[],
  plan: ProductScopeWritePlan,
): ScopeSnapshot {
  const before = snapshotBefore(product, channelRows, languageRows);
  const channels = new Map(before.channelRows.map((row) => [row.channelId, row]));
  for (const { channelId, next } of plan.channelRows) {
    if (next === null) channels.delete(channelId);
    else channels.set(channelId, next);
  }
  const languages = new Map(before.languageRows.map((row) => [`${row.channelId}|${row.languageCode}`, row]));
  for (const { channelId, languageCode, next } of plan.languageRows) {
    const key = `${channelId}|${languageCode}`;
    if (next === null) languages.delete(key);
    else languages.set(key, { productId: product.id, channelId, languageCode, status: next });
  }
  return {
    global: plan.globalWindow ? { ...before.global, window: plan.globalWindow } : before.global,
    channelRows: [...channels.values()],
    languageRows: [...languages.values()],
  };
}

export interface ProductScopesApplyResult {
  data: ProductScopes;
  warnings: ScopeWarning[];
}

export class ProductScopesService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly membership: SalesChannelMembershipPort,
    private readonly commandBus?: CommandBus,
    /**
     * Owner decision U1 — names for the organizations the audience rules name. Optional
     * and best effort: absent, or refusing (`organizations` off), the answer carries no
     * names and the admin shows ids.
     */
    private readonly organizations?: Pick<OrganizationDetailsPort, 'findByIds'>,
    /**
     * Feature 163 (FR-060) — the completeness gate. Composed into the operator's
     * instance only; the integration port's instance has none, so an import or a
     * connector is never gated (A-6), whatever it passes.
     */
    private readonly gate?: ScopeCompletenessGate,
  ) {}

  /** The gate's mode for an operator's write, read once per request; `undefined` where no gate is composed. */
  async completenessMode(): Promise<ScopeCompletenessGateMode | undefined> {
    return this.gate?.mode();
  }

  /** The names of these organizations, in this order; an unreadable one is left out. */
  async #organizationNames(ids: readonly string[]): Promise<ProductScopes['organizations']> {
    if (!this.organizations || ids.length === 0) return [];
    let records: Array<{ id: string; name: string }>;
    try {
      records = await this.organizations.findByIds(ids);
    } catch {
      return [];
    }
    const byId = new Map(records.map((record) => [record.id, record.name]));
    return ids.flatMap((id) => {
      const name = byId.get(id);
      return name === undefined ? [] : [{ id, name }];
    });
  }

  /** `GET /admin/catalog/products/:id/scopes` — the global values and every channel the product is in or has rows for. */
  async read(productId: string): Promise<ProductScopes> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: productId, deletedAt: null });
    if (!product) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    const [members, channelRows, languageRows] = await Promise.all([
      this.membership.listChannelsForEntity('product', productId),
      em.find(ProductChannelScope, { productId }),
      em.find(ProductChannelLanguageScope, { productId }),
    ]);
    const memberIds = new Set(members.map((channel) => channel.id));
    const orphanIds = [
      ...new Set([...channelRows, ...languageRows].map((row) => row.salesChannelId).filter((id) => !memberIds.has(id))),
    ];
    const orphanChannels = orphanIds.length === 0 ? [] : await em.find(SalesChannel, { id: { $in: orphanIds } });
    const channels = [...members, ...orphanChannels].sort((a, b) => a.code.localeCompare(b.code));

    const data: ProductScopes = {
      global: {
        status: product.status,
        publishFrom: product.publishFrom?.toISOString() ?? null,
        publishUntil: product.publishUntil?.toISOString() ?? null,
        visibility: product.visibility,
        allowedOrganizationIds: [...product.allowedOrganizationIds],
        minOrderQuantity: product.minOrderQuantity ?? null,
        returnable: product.returnable,
      },
      channels: [],
      organizations: [],
    };
    for (const channel of channels) {
      const isMember = memberIds.has(channel.id);
      const row = channelRows.find((r) => r.salesChannelId === channel.id);
      const record = row ? toChannelRecord(row) : emptyRow(productId, channel.id);
      data.channels.push({
        channelId: channel.id,
        isMember,
        languages: [...toScopeChannel(channel).languages],
        status: record.status,
        window: record.window === null ? null : windowProjection(record.window, 'plain'),
        audience:
          record.audience === null
            ? null
            : {
                ...record.audience,
                nonMemberOrganizationIds: await nonMemberOrganizationIds(
                  this.membership,
                  channel.id,
                  record.audience.allowedOrganizationIds,
                ),
              },
        minOrderQuantityOverridden: record.minOrderQuantityOverridden,
        minOrderQuantity: record.minOrderQuantity,
        returnable: record.returnable,
        languageStatuses: languageRows
          .filter((r) => r.salesChannelId === channel.id)
          .sort((a, b) => a.languageCode.localeCompare(b.languageCode))
          .map((r) => ({
            languageCode: r.languageCode,
            status: r.status,
            orphaned: !isMember || !toScopeChannel(channel).languages.includes(r.languageCode),
          })),
        orphaned: !isMember,
      });
    }
    // The channel audience rules only (owner decision U1): each is capped, while the global
    // rule is not, so naming its organizations could fan out without bound.
    const named = new Set<string>();
    for (const channel of data.channels) {
      for (const id of channel.audience?.allowedOrganizationIds ?? []) named.add(id);
    }
    data.organizations = await this.#organizationNames([...named]);
    return data;
  }

  /**
   * The scope write alone — the Command `product.scopes.update`, without reading the
   * product's scopes back. The bulk scoped-status edit runs it per product (FR-050),
   * where a full read per product would be wasted work.
   */
  async writeStatus(
    productId: string,
    request: PatchProductScopesRequest,
    options: ScopeWriteOptions = {},
  ): Promise<{ changedFields: ScopeChangedField[]; warnings: ScopeWarning[] }> {
    const command = this.#command(productId, request, options.completeness);
    let result: ScopeCommandResult;
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
    return result;
  }

  /** `PATCH /admin/catalog/products/:id/scopes`. */
  async apply(
    productId: string,
    request: PatchProductScopesRequest,
    options: ScopeWriteOptions = {},
  ): Promise<ProductScopesApplyResult> {
    const written = await this.writeStatus(productId, request, options);
    const data = await this.read(productId);
    const warnings: ScopeWarning[] = [...written.warnings];
    for (const entry of request.channels) {
      if (!entry.audience) continue;
      const written = data.channels.find((channel) => channel.channelId === entry.channelId);
      const organizationIds = written?.audience?.nonMemberOrganizationIds ?? [];
      if (organizationIds.length > 0) {
        warnings.push({ kind: 'audience_non_members', channelId: entry.channelId, organizationIds });
      }
    }
    return { data, warnings };
  }

  #command(
    productId: string,
    request: PatchProductScopesRequest,
    completeness: ScopeCompletenessGateMode | undefined,
  ): Command<ScopeCommandResult> {
    return {
      action: 'product.scopes.update',
      objectType: 'product',
      objectId: productId,
      run: async ({ em }) => {
        // The write lock serialises concurrent scope writes on one product, so the
        // rows read below — and the audit `before` built from them — are the true
        // predecessor of this write, and two first writes cannot race to one PK.
        const product = await em.findOne(
          Product,
          { id: productId, deletedAt: null },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        if (!product) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
        const [members, channelRows, languageRows] = await Promise.all([
          this.membership.listChannelsForEntity('product', productId),
          em.find(ProductChannelScope, { productId }),
          em.find(ProductChannelLanguageScope, { productId }),
        ]);
        const plan = planProductScopeWrite(
          {
            productId,
            productType: product.type,
            globalWindow: { from: product.publishFrom ?? null, until: product.publishUntil ?? null },
            channelRows: channelRows.map(toChannelRecord),
            languageRows: languageRows.map(toLanguageRecord),
            memberChannels: new Map(members.map((channel) => [channel.id, toScopeChannel(channel).languages])),
          },
          request,
        );
        if (plan.changedFields.length === 0) {
          return { result: { changedFields: [], warnings: [] }, skipAudit: true };
        }

        // FR-060 — the completeness gate, before anything is written: in `refuse` a
        // failing pair refuses the whole request (N3); in `warn` it is saved and warned.
        // Only a status change can turn a pair on (`pairsTurningOn`, M3 → A).
        const warnings =
          completeness && this.gate && plan.changedFields.includes('scopedStatus')
            ? await this.gate.enforce(
                em,
                product,
                snapshotBefore(product, channelRows, languageRows),
                snapshotAfter(product, channelRows, languageRows, plan),
                members.map((channel) => toScopeChannel(channel)),
                completeness,
              )
            : [];

        // C-W3 — the one write path of each row kind, shared with the undo and the import.
        const rows: ScopeRowSet = { channelRows: [...channelRows], languageRows: [...languageRows] };
        for (const { channelId, next } of plan.channelRows) {
          writeChannelScopeRow(em, rows, productId, channelId, next);
        }
        for (const { channelId, languageCode, next } of plan.languageRows) {
          writeLanguageScopeRow(em, rows, productId, channelId, languageCode, next);
        }
        if (plan.globalWindow) {
          product.publishFrom = plan.globalWindow.from;
          product.publishUntil = plan.globalWindow.until;
        }
        try {
          await em.flush();
        } catch (err) {
          if (err instanceof UniqueConstraintViolationException) {
            throw new HttpError(
              409,
              ERROR_CODES.VERSION_CONFLICT,
              'The product\'s scopes were changed by another request; reload and try again.',
            );
          }
          throw err;
        }
        return {
          result: { changedFields: plan.changedFields, warnings },
          before: plan.before,
          after: { ...plan.after, changedFields: plan.changedFields },
        };
      },
      event: ({ changedFields }) =>
        changedFields.length === 0
          ? undefined
          : {
              eventName: 'product.updated.v1',
              payload: {
                eventId: randomUUID(),
                occurredAt: new Date().toISOString(),
                productId,
                changedFields,
              },
            },
    };
  }
}

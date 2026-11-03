import { createHash } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  GALLERY_ROLE_LABELS,
  PRODUCT_FIELD_SCOPE_SETS,
  SCOPED_AUDIT_CELL_MAX_BYTES,
  attributeFieldSpec,
  isOrderMinimumEligibleType,
  levelOf,
  toScopedWriteOp,
  validateScopedWrite,
  type FieldScopeSpec,
  type GalleryRoleLabel,
  type ProductChannelScopeRecord,
  type ScopeRef,
  type ScopedValueChanges,
  type ScopedValueInvalidDetails,
  type ScopedWriteOp,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

import { GalleryItemLabel } from '../entities/gallery-item-label.entity.js';
import { GalleryItemScopeOverride } from '../entities/gallery-item-scope-override.entity.js';
import { GalleryRoleScopeOverride } from '../entities/gallery-role-scope-override.entity.js';
import { ProductAttachmentScopeOverride } from '../entities/product-attachment-scope-override.entity.js';
import { ProductPackagingUnitScopeOverride } from '../entities/product-packaging-unit-scope-override.entity.js';
import { ProductValueOverride } from '../entities/product-value-override.entity.js';
import { toChannelRecord, writeChannelScopeRow, writeLanguageScopeRow, type ScopeRowSet } from './product-scopes.service.js';
import { GALLERY_ROLE_KEYS, scopedViews } from './scoped-values-read.service.js';
import type { ScopedProductState } from './scoped-values-state.js';

/**
 * Feature 170 (T037; `contracts/scoped-values-api.md` §3, research R4–R7, R21) — the save of one
 * scope: every changed cell is planned and validated **before** anything is written (steps 1–3a),
 * then written in the fixed order product row → scope rows → value overrides → family overrides
 * (step 7), all inside the caller's Command (`product.scoped_values.save`), so a refusal at any
 * step writes nothing.
 *
 * The version compare-and-set is {@link bumpScopeVersion}, the Command's first statement (R7);
 * nothing else in this file reads or writes `products.scope_version`.
 */

// --- Version (R7) -----------------------------------------------------------------------------

/**
 * The **one** writer of `products.scope_version`: `+ 1`, conditioned on `expected` when the
 * caller holds a version (the save, the copy). Runs as the first statement of the Command, so
 * the row lock it takes serialises every later read of the transaction. A stale `expected` is
 * `409 VERSION_CONFLICT`; an unknown or deleted product `404 PRODUCT_NOT_FOUND`.
 */
export async function bumpScopeVersion(em: EntityManager, productId: string, expected?: string): Promise<string> {
  const rows = await em.execute<Array<{ v: string }>>(
    expected === undefined
      ? `update products set scope_version = scope_version + 1 where id = ? and deleted_at is null returning scope_version::text as v`
      : `update products set scope_version = scope_version + 1 where id = ? and deleted_at is null and scope_version = ?::bigint returning scope_version::text as v`,
    expected === undefined ? [productId] : [productId, expected],
  );
  if (rows[0]) return rows[0].v;
  const [exists] = await em.execute<Array<{ id: string }>>(`select id from products where id = ? and deleted_at is null`, [productId]);
  if (!exists) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
  throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The product was saved by someone else; reload it and try again.');
}

// --- The plan ---------------------------------------------------------------------------------

type Family = 'product' | 'value' | 'status' | 'channelRow' | 'gallery' | 'galleryRole' | 'attachment' | 'packagingUnit' | 'urlKey';

/** One changed cell: a field path at the save's scope and what it does there. */
export interface PlannedCell {
  /** The field path of `data-model.md` §9, or `product.<field>` for a global-only field. */
  path: string;
  family: Family;
  /** The field within its family store (`alt_text`, `hidden`, an attribute key, `window` …). */
  field: string;
  /** The subject of a family override (gallery item, attachment, packaging unit) or a role label. */
  subjectId?: string;
  op: ScopedWriteOp<unknown>;
  spec: FieldScopeSpec;
  /** The key the request named it by, for the re-applicable audit body. */
  bodyPath: readonly string[];
}

export interface ScopedSavePlan {
  scope: ScopeRef;
  cells: PlannedCell[];
  /** `product.updated.v1`'s `changedFields`. */
  changedFields: string[];
}

const GLOBAL_ONLY_SPEC: FieldScopeSpec = { levels: ['G'], required: false, emptyable: true };

const SCOPE_KEY = (scope: ScopeRef): string =>
  scope.level === 'global' ? 'G' : scope.level === 'channel' ? `C:${scope.channelId}` : `CL:${scope.channelId}/${scope.languageCode}`;

const invalid = (fields: ScopedValueInvalidDetails['fields']): HttpError =>
  new HttpError(422, ERROR_CODES.SCOPED_VALUE_INVALID, 'Some values cannot be saved at this scope.', { fields });

/**
 * Steps 1–3a: the cells of `changes`, each supported at the scope's level (`FIELD_NOT_AT_SCOPE`),
 * valid as an op (`SCOPED_VALUE_INVALID`) and bound to this product (`subject_not_found`,
 * `invalid`). Throws the first failing step's refusal, naming every field it refuses; pure.
 */
export function planScopedSave(state: ScopedProductState, scope: ScopeRef, changes: ScopedValueChanges): ScopedSavePlan {
  const level = levelOf(scope);
  const cells: PlannedCell[] = [];
  const add = (cell: Omit<PlannedCell, 'op'> & { raw: unknown }) => {
    const op = toScopedWriteOp(cell.raw as never);
    if (op === undefined) return;
    const { raw: _raw, ...rest } = cell;
    cells.push({ ...rest, op: op as ScopedWriteOp<unknown> });
  };
  const sets = PRODUCT_FIELD_SCOPE_SETS;

  // Global-only fields (FR-081): accepted at Global only.
  const productFields = Object.entries(changes.product ?? {}).filter(([, value]) => value !== undefined);
  if (productFields.length > 0 && level !== 'G') {
    throw new HttpError(422, ERROR_CODES.GLOBAL_ONLY_FIELD, 'These fields have one value for every scope; edit them at Global.', {
      fields: productFields.map(([key]) => key),
    });
  }
  for (const [key, value] of productFields) {
    cells.push({
      path: `product.${key}`,
      family: 'product',
      field: key,
      op: { op: 'set', value },
      spec: GLOBAL_ONLY_SPEC,
      bodyPath: ['product', key],
    });
  }

  const value = (field: 'name' | 'description') => add({ path: field, family: 'value', field, spec: sets[field], raw: changes[field], bodyPath: [field] });
  value('name');
  value('description');
  add({ path: 'status', family: 'status', field: 'status', spec: sets.status, raw: changes.status, bodyPath: ['status'] });
  for (const field of ['window', 'audience', 'minOrderQuantity', 'returnable'] as const) {
    add({ path: field, family: 'channelRow', field, spec: sets[field], raw: changes[field], bodyPath: [field] });
  }
  if (changes.urlKey !== undefined) {
    add({ path: 'urlKey', family: 'urlKey', field: 'urlKey', spec: sets.urlKey, raw: changes.urlKey, bodyPath: ['urlKey'] });
  }

  const subjectInvalid: ScopedValueInvalidDetails['fields'] = [];
  for (const [key, raw] of Object.entries(changes.attributes ?? {})) {
    const view = state.attributes.get(key);
    if (!view) {
      // Unknown, or not in the product's attribute set: one answer for both (R21).
      if (raw !== undefined) subjectInvalid.push({ field: `attribute:${key}`, scope, reason: 'invalid' });
      continue;
    }
    add({ path: `attribute:${key}`, family: 'value', field: key, spec: attributeFieldSpec(view), raw, bodyPath: ['attributes', key] });
  }

  const itemIds = new Set(state.galleryItems.map((item) => item.id));
  for (const [itemId, entry] of Object.entries(changes.gallery?.items ?? {})) {
    for (const [field, stored] of [['altText', 'alt_text'], ['hidden', 'hidden']] as const) {
      const raw = entry[field];
      if (raw === undefined) continue;
      const path = `gallery:${itemId}:${field}`;
      if (!itemIds.has(itemId)) {
        subjectInvalid.push({ field: path, scope, reason: 'subject_not_found' });
        continue;
      }
      add({ path, family: 'gallery', field: stored, subjectId: itemId, spec: sets[`gallery:${field}`], raw, bodyPath: ['gallery', 'items', itemId, field] });
    }
  }
  for (const label of GALLERY_ROLE_LABELS) {
    const key = GALLERY_ROLE_KEYS[label];
    const raw = changes.gallery?.roles?.[key];
    if (raw === undefined) continue;
    const path = `galleryRole:${label}`;
    if (typeof raw === 'string' && !itemIds.has(raw)) {
      subjectInvalid.push({ field: path, scope, reason: 'subject_not_found' });
      continue;
    }
    add({ path, family: 'galleryRole', field: label, subjectId: label, spec: sets.galleryRole, raw, bodyPath: ['gallery', 'roles', key] });
  }
  const attachmentIds = new Set(state.attachments.map((attachment) => attachment.id));
  for (const [attachmentId, entry] of Object.entries(changes.attachments ?? {})) {
    for (const field of ['name', 'description', 'hidden'] as const) {
      const raw = entry[field];
      if (raw === undefined) continue;
      const path = `attachment:${attachmentId}:${field}`;
      if (!attachmentIds.has(attachmentId)) {
        subjectInvalid.push({ field: path, scope, reason: 'subject_not_found' });
        continue;
      }
      add({ path, family: 'attachment', field, subjectId: attachmentId, spec: sets[`attachment:${field}`], raw, bodyPath: ['attachments', attachmentId, field] });
    }
  }
  const unitIds = new Set(state.packagingUnits.map((unit) => unit.id));
  for (const [unitId, entry] of Object.entries(changes.packagingUnits ?? {})) {
    if (entry.name === undefined) continue;
    const path = `packagingUnit:${unitId}:name`;
    if (!unitIds.has(unitId)) {
      subjectInvalid.push({ field: path, scope, reason: 'subject_not_found' });
      continue;
    }
    add({ path, family: 'packagingUnit', field: 'name', subjectId: unitId, spec: sets['packagingUnit:name'], raw: entry.name, bodyPath: ['packagingUnits', unitId, 'name'] });
  }

  // Step 2 — every changed field supported at the scope's level (FR-012).
  const notHere = cells.filter((cell) => !cell.spec.levels.includes(level));
  if (notHere.length > 0) {
    throw new HttpError(422, ERROR_CODES.FIELD_NOT_AT_SCOPE, 'Some fields cannot be set at this scope.', {
      fields: notHere.map((cell) => ({ field: cell.path, levels: [...cell.spec.levels] })),
    });
  }

  // Step 3 — the op itself (FR-062, FR-113), then the value rules a schema cannot see.
  const refused: ScopedValueInvalidDetails['fields'] = [];
  for (const cell of cells) {
    const refusal = validateScopedWrite(globalColumnSpec(cell, level), cell.op, level);
    if (refusal) {
      refused.push({ field: cell.path, scope, reason: refusal });
      continue;
    }
    if (cell.op.op === 'set' && !valueFits(state, cell, cell.op.value)) refused.push({ field: cell.path, scope, reason: 'invalid' });
  }
  if (refused.length > 0) throw invalid(refused);
  // Step 3a — subject binding (R21): after the op rules, so one refusal names every unbound subject.
  if (subjectInvalid.length > 0) throw invalid(subjectInvalid);

  const changedFields = [...new Set(cells.map((cell) => changedFieldOf(cell)))];
  return { scope, cells, changedFields };
}

/**
 * The Global value of an attachment or packaging-unit name is a `not null` column (data-model
 * §7): an empty override is a scope value; at Global there is nothing to fall back to, so the
 * name takes no empty there.
 */
function globalColumnSpec(cell: PlannedCell, level: 'G' | 'C' | 'CL'): Pick<FieldScopeSpec, 'required' | 'emptyable'> {
  if (level === 'G' && (cell.path.endsWith(':name') && (cell.family === 'attachment' || cell.family === 'packagingUnit'))) {
    return { required: true, emptyable: false };
  }
  return cell.spec;
}

/** Value rules beyond the body schema: the attribute's own type, a window's order, the MOQ's type rule. */
function valueFits(state: ScopedProductState, cell: PlannedCell, value: unknown): boolean {
  if (cell.family === 'value' && cell.path.startsWith('attribute:')) {
    const view = state.attributes.get(cell.field);
    if (!view) return false;
    switch (view.valueType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
      case 'price':
        return typeof value === 'number' && Number.isFinite(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'date':
        return typeof value === 'string' && !Number.isNaN(Date.parse(value));
      case 'multiselect':
        return Array.isArray(value) && value.every((option) => view.options.some((o) => o.value === option));
      case 'enum':
      case 'select':
        return typeof value === 'string' && view.options.some((o) => o.value === value);
      default:
        return true;
    }
  }
  if (cell.field === 'window') {
    const window = value as { from: string | null; until: string | null };
    return window.from === null || window.until === null || Date.parse(window.from) < Date.parse(window.until);
  }
  if (cell.field === 'minOrderQuantity') return isOrderMinimumEligibleType(state.product.type);
  return true;
}

function changedFieldOf(cell: PlannedCell): string {
  switch (cell.family) {
    case 'product':
      return cell.field;
    case 'value':
      return cell.path.startsWith('attribute:') ? 'attributeValues' : cell.field;
    case 'status':
      return 'scopedStatus';
    case 'channelRow':
      return cell.field === 'window' ? 'publicationWindow' : cell.field === 'audience' ? 'audience' : 'orderRules';
    case 'gallery':
    case 'galleryRole':
      return 'gallery';
    case 'attachment':
      return 'attachments';
    case 'packagingUnit':
      return 'packagingUnits';
    case 'urlKey':
      return 'urlKeys';
  }
}

// --- Audit (step 9, FR-072, FR-074) -----------------------------------------------------------

type AuditCell = unknown;

/** A cell over 4 KiB is stored `{ truncated, length, sha256 }` (R21). */
export function boundedAuditCell(value: AuditCell): AuditCell {
  if (typeof value !== 'string') return value;
  const length = Buffer.byteLength(value, 'utf8');
  if (length <= SCOPED_AUDIT_CELL_MAX_BYTES) return value;
  return { truncated: true, length, sha256: createHash('sha256').update(value, 'utf8').digest('hex') };
}

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = target;
  for (const key of path.slice(0, -1)) {
    const next = (node[key] ??= {}) as Record<string, unknown>;
    node = next;
  }
  node[path[path.length - 1]!] = value;
}

/**
 * Each cell's value at the scope **as stored**, in the write encoding: a value, `null` (an empty
 * override, or at Global no value) or `{ inherit: true }`. The before-state is therefore a valid
 * `changes` body for the same scope; re-sending it restores the save (FR-074).
 */
export function ownValues(state: ScopedProductState, plan: ScopedSavePlan): Map<string, unknown> {
  const views = scopedViews(state, plan.scope);
  const out = new Map<string, unknown>();
  const encode = (view: { source: string; ownValue?: unknown }) =>
    view.source === 'set' ? view.ownValue : view.source === 'set_empty' || plan.scope.level === 'global' ? null : { inherit: true };
  for (const cell of plan.cells) {
    if (cell.family === 'product') {
      out.set(cell.path, globalOnlyValue(state, cell.field));
      continue;
    }
    let view: { source: string; ownValue?: unknown } | undefined;
    if (cell.family === 'value') {
      view = cell.path.startsWith('attribute:') ? views.attributes.find((a) => a.key === cell.field)?.view : views.fields[cell.field as 'name'];
    } else if (cell.family === 'status' || cell.family === 'channelRow' || cell.family === 'urlKey') {
      view = views.fields[cell.field as 'status'];
    } else if (cell.family === 'gallery') {
      const item = views.gallery.items.find((i) => i.id === cell.subjectId);
      view = cell.field === 'alt_text' ? item?.altText : item?.hidden;
    } else if (cell.family === 'galleryRole') {
      view = views.gallery.roles[GALLERY_ROLE_KEYS[cell.field as GalleryRoleLabel]];
    } else if (cell.family === 'attachment') {
      view = views.attachments.find((a) => a.id === cell.subjectId)?.[cell.field as 'name'];
    } else if (cell.family === 'packagingUnit') {
      view = views.packagingUnits.find((u) => u.id === cell.subjectId)?.name;
    }
    out.set(cell.path, view ? encode(view) : null);
  }
  return out;
}

function globalOnlyValue(state: ScopedProductState, field: string): unknown {
  if (field === 'categoryIds') return [...state.categoryIds];
  const value = (state.product as unknown as Record<string, unknown>)[field];
  return value === undefined ? null : value;
}

const opValue = (op: ScopedWriteOp<unknown>): unknown => (op.op === 'set' ? op.value : op.op === 'empty' ? null : { inherit: true });

/** The audit `before` / `after` (§3 step 9): `cells` keyed `field@scope`, and the re-applicable `changes` body. */
export function auditStates(
  plan: ScopedSavePlan,
  before: Map<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const scopeKey = SCOPE_KEY(plan.scope);
  const beforeCells: Record<string, unknown> = {};
  const afterCells: Record<string, unknown> = {};
  const beforeChanges: Record<string, unknown> = {};
  const afterChanges: Record<string, unknown> = {};
  const display = (value: unknown) =>
    value === null ? { empty: true } : typeof value === 'object' && value !== null && (value as { inherit?: unknown }).inherit === true ? { inherited: true } : boundedAuditCell(value);
  for (const cell of plan.cells) {
    const was = before.get(cell.path) ?? null;
    const now = opValue(cell.op);
    beforeCells[`${cell.path}@${scopeKey}`] = display(was);
    afterCells[`${cell.path}@${scopeKey}`] = display(now);
    setPath(beforeChanges, cell.bodyPath, boundedAuditCell(was));
    setPath(afterChanges, cell.bodyPath, boundedAuditCell(now));
  }
  const scope = plan.scope.level === 'global' ? {} : plan.scope.level === 'channel' ? { channelId: plan.scope.channelId } : { channelId: plan.scope.channelId, languageCode: plan.scope.languageCode };
  return {
    before: { scope, cells: beforeCells, changes: beforeChanges },
    after: { scope, cells: afterCells, changes: afterChanges, changedFields: plan.changedFields },
  };
}

// --- The writers (step 7) ---------------------------------------------------------------------

/** A failure-injection seam for the atomicity tests (T104): called before each family writer. */
export type WriteProbe = (family: Family) => void;

/**
 * Step 7 — every planned cell written on the Command's `em`, in the fixed order product row →
 * scope rows → value overrides → family overrides. Flushes once; the URL key is the caller's
 * (the URL-key service, under its locks).
 */
export async function writeScopedSave(
  em: EntityManager,
  state: ScopedProductState,
  plan: ScopedSavePlan,
  probe?: WriteProbe,
): Promise<void> {
  // command-coverage-ignore: runs only inside the `product.scoped_values.save` Command's `run`.
  const { scope } = plan;
  const product = state.product;
  const byFamily = (family: Family) => plan.cells.filter((cell) => cell.family === family);

  // 1. The product row (Global values and global-only fields).
  probe?.('product');
  if (scope.level === 'global') {
    for (const cell of plan.cells) {
      if (cell.family === 'urlKey') continue;
      writeGlobal(state, cell);
    }
    const categories = byFamily('product').find((cell) => cell.field === 'categoryIds');
    if (categories && categories.op.op === 'set') await replaceCategories(em, product.id, categories.op.value as string[]);
    em.persist(product);
  }

  // 2. Scope rows: status at C / C×L, window / audience / MOQ / returnable at C.
  probe?.('channelRow');
  if (scope.level !== 'global') {
    const rows: ScopeRowSet = { channelRows: state.channelRows, languageRows: state.languageRows };
    const channelCells = [...byFamily('channelRow'), ...(scope.level === 'channel' ? byFamily('status') : [])];
    if (channelCells.length > 0) {
      const existing = rows.channelRows.find((row) => row.salesChannelId === scope.channelId);
      const next: ProductChannelScopeRecord = existing
        ? toChannelRecord(existing)
        : {
            productId: product.id,
            channelId: scope.channelId,
            status: null,
            window: null,
            audience: null,
            minOrderQuantityOverridden: false,
            minOrderQuantity: null,
            returnable: null,
          };
      for (const cell of channelCells) applyChannelCell(next, cell);
      writeChannelScopeRow(em, rows, product.id, scope.channelId, next);
    }
    if (scope.level === 'channel_language') {
      for (const cell of byFamily('status')) {
        writeLanguageScopeRow(em, rows, product.id, scope.channelId, scope.languageCode, cell.op.op === 'set' ? (cell.op.value as 'active' | 'inactive') : null);
      }
    }
  }

  // 3. Value overrides: name, description, attributes at C / C×L.
  probe?.('value');
  if (scope.level !== 'global') {
    const languageCode = scope.level === 'channel_language' ? scope.languageCode : null;
    for (const cell of byFamily('value')) {
      const key = cell.path.startsWith('attribute:') ? cell.field : cell.field;
      const row = state.valueOverrides.find(
        (r) => r.attributeKey === key && r.channelId === scope.channelId && sameLang(r.languageCode ?? null, languageCode),
      );
      upsertOverride(em, row, cell.op, () =>
        em.create(ProductValueOverride, { productId: product.id, attributeKey: key, channelId: scope.channelId, languageCode, value: { v: null } }),
      );
    }
  }

  // 4. Family overrides: gallery items and roles, attachments, packaging units.
  probe?.('gallery');
  for (const cell of [...byFamily('gallery'), ...byFamily('galleryRole')]) {
    if (scope.level === 'global') {
      if (cell.family === 'galleryRole') await writeGlobalRole(em, state, cell);
      continue;
    }
    const languageCode = scope.level === 'channel_language' ? scope.languageCode : null;
    if (cell.family === 'gallery') {
      const row = state.galleryOverrides.find(
        (r) => r.galleryItemId === cell.subjectId && r.field === cell.field && r.salesChannelId === scope.channelId && sameLang(r.languageCode, languageCode),
      );
      upsertOverride(em, row, cell.op, () =>
        em.create(GalleryItemScopeOverride, {
          galleryItemId: cell.subjectId!,
          productId: product.id,
          salesChannelId: scope.channelId,
          languageCode,
          field: cell.field as 'alt_text' | 'hidden',
          value: { v: null },
        }),
      );
    } else {
      const label = cell.field as GalleryRoleLabel;
      const row = state.roleOverrides.find(
        (r) => r.label === label && r.salesChannelId === scope.channelId && sameLang(r.languageCode, languageCode),
      );
      if (cell.op.op === 'inherit') {
        if (row) em.remove(row);
        continue;
      }
      const target =
        row ?? em.create(GalleryRoleScopeOverride, { productId: product.id, salesChannelId: scope.channelId, languageCode, label, galleryItemId: null });
      target.galleryItemId = cell.op.op === 'set' ? (cell.op.value as string) : null;
      target.updatedAt = new Date();
      em.persist(target);
    }
  }
  probe?.('attachment');
  for (const cell of byFamily('attachment')) {
    if (scope.level === 'global') continue;
    const languageCode = scope.level === 'channel_language' ? scope.languageCode : null;
    const row = state.attachmentOverrides.find(
      (r) => r.attachmentId === cell.subjectId && r.field === cell.field && r.salesChannelId === scope.channelId && sameLang(r.languageCode, languageCode),
    );
    upsertOverride(em, row, cell.op, () =>
      em.create(ProductAttachmentScopeOverride, {
        attachmentId: cell.subjectId!,
        productId: product.id,
        salesChannelId: scope.channelId,
        languageCode,
        field: cell.field as 'name' | 'description' | 'hidden',
        value: { v: null },
      }),
    );
  }
  probe?.('packagingUnit');
  for (const cell of byFamily('packagingUnit')) {
    if (scope.level === 'global') continue;
    const languageCode = scope.level === 'channel_language' ? scope.languageCode : null;
    const row = state.packagingOverrides.find(
      (r) => r.packagingUnitId === cell.subjectId && r.salesChannelId === scope.channelId && sameLang(r.languageCode, languageCode),
    );
    upsertOverride(em, row, cell.op, () =>
      em.create(ProductPackagingUnitScopeOverride, {
        packagingUnitId: cell.subjectId!,
        productId: product.id,
        salesChannelId: scope.channelId,
        languageCode,
        field: 'name',
        value: { v: null },
      }),
    );
  }
  await em.flush();
}

const sameLang = (a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : a.toLowerCase() === b.toLowerCase();

/** A wrapped override row: `set` → `{v: value}`, `empty` → `{v: null}`, `inherit` → deleted. */
function upsertOverride<R extends { value: { v: unknown }; updatedAt: Date }>(
  em: EntityManager,
  row: R | undefined,
  op: ScopedWriteOp<unknown>,
  create: () => R,
): void {
  if (op.op === 'inherit') {
    if (row) em.remove(row);
    return;
  }
  const target = row ?? create();
  target.value = { v: op.op === 'set' ? op.value : null };
  target.updatedAt = new Date();
  em.persist(target);
}

function applyChannelCell(next: ProductChannelScopeRecord, cell: PlannedCell): void {
  const { op } = cell;
  switch (cell.field) {
    case 'status':
      next.status = op.op === 'set' ? (op.value as 'active' | 'inactive') : null;
      break;
    case 'window': {
      if (op.op === 'inherit') next.window = null;
      else {
        const value = op.op === 'set' ? (op.value as { from: string | null; until: string | null }) : { from: null, until: null };
        next.window = { from: value.from ? new Date(value.from) : null, until: value.until ? new Date(value.until) : null };
      }
      break;
    }
    case 'audience':
      next.audience = op.op === 'set' ? (op.value as ProductChannelScopeRecord['audience']) : null;
      break;
    case 'minOrderQuantity':
      next.minOrderQuantityOverridden = op.op !== 'inherit';
      next.minOrderQuantity = op.op === 'set' ? (op.value as number) : null;
      break;
    case 'returnable':
      next.returnable = op.op === 'set' ? (op.value as boolean) : null;
      break;
  }
}

/** A Global write: the product row's own column (or the subject row's). `empty` = no value. */
function writeGlobal(state: ScopedProductState, cell: PlannedCell): void {
  const product = state.product;
  const value = cell.op.op === 'set' ? cell.op.value : null;
  switch (cell.family) {
    case 'product':
      if (cell.field !== 'categoryIds') (product as unknown as Record<string, unknown>)[cell.field] = value;
      return;
    case 'value':
      if (cell.path.startsWith('attribute:')) {
        const values = { ...(product.attributeValues ?? {}) };
        if (value === null) delete values[cell.field];
        else values[cell.field] = value;
        product.attributeValues = values;
      } else if (cell.field === 'name') product.name = value as string;
      else product.description = value as string | null;
      return;
    case 'status':
      product.status = value as 'active' | 'inactive';
      return;
    case 'channelRow':
      if (cell.field === 'window') {
        const window = (value ?? { from: null, until: null }) as { from: string | null; until: string | null };
        product.publishFrom = window.from ? new Date(window.from) : null;
        product.publishUntil = window.until ? new Date(window.until) : null;
      } else if (cell.field === 'audience') {
        const audience = value as { visibility: typeof product.visibility; allowedOrganizationIds: string[] };
        product.visibility = audience.visibility;
        product.allowedOrganizationIds = [...audience.allowedOrganizationIds];
      } else if (cell.field === 'minOrderQuantity') product.minOrderQuantity = value as number | null;
      else if (cell.field === 'returnable') product.returnable = value as boolean;
      return;
    case 'gallery': {
      const item = state.galleryItems.find((i) => i.id === cell.subjectId)!;
      if (cell.field === 'alt_text') item.altText = value as string | null;
      else item.hidden = value as boolean;
      return;
    }
    case 'attachment': {
      const attachment = state.attachments.find((a) => a.id === cell.subjectId)!;
      if (cell.field === 'name') attachment.name = value as string;
      else if (cell.field === 'description') attachment.description = value as string | null;
      else attachment.hidden = value as boolean;
      return;
    }
    case 'packagingUnit': {
      const unit = state.packagingUnits.find((u) => u.id === cell.subjectId)!;
      unit.name = value as string;
      return;
    }
    default:
      return;
  }
}

/** The Global holder of a role (`gallery_item_labels`): `set` moves the label, `empty` removes it. */
async function writeGlobalRole(em: EntityManager, state: ScopedProductState, cell: PlannedCell): Promise<void> {
  const label = cell.field as GalleryRoleLabel;
  const current = state.galleryLabels.find((row) => row.label === label);
  if (current && cell.op.op === 'set' && current.galleryItemId === cell.op.value) return;
  // Deleted now, not at flush: `unique (product_id, label)` must not see the new holder first.
  if (current) await em.nativeDelete(GalleryItemLabel, { productId: state.product.id, label });
  if (cell.op.op === 'set') {
    em.persist(em.create(GalleryItemLabel, { galleryItemId: cell.op.value as string, label, productId: state.product.id }));
  }
}

async function replaceCategories(em: EntityManager, productId: string, categoryIds: readonly string[]): Promise<void> {
  await em.execute(`delete from product_categories where product_id = ?`, [productId]);
  const ids = [...new Set(categoryIds)];
  if (ids.length === 0) return;
  await em.execute(
    `insert into product_categories (product_id, category_id) values ${ids.map(() => '(?, ?)').join(', ')}`,
    ids.flatMap((id) => [productId, id]),
  );
}

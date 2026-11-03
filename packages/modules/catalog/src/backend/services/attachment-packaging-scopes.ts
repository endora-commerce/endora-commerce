import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, resolveScoped, type ScopeLevel, type ScopeRef } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { familyOverrideRows } from './scoped-store-adapters.js';

/**
 * Feature 170 (`data-model.md` §7; FR-011, FR-013) — attachments and packaging units per scope.
 *
 * The Global values are the attachment and packaging-unit rows' own columns; Channel and
 * Channel × language values are rows of `product_attachment_scope_overrides` and
 * `product_packaging_unit_scope_overrides`, written only by the scoped-values save Command
 * (`scoped-values-save.service.ts`). This file reads them.
 */

// --- Reads --------------------------------------------------------------------------

/** The scope an attachment or packaging-unit read resolves at: `channelId` `null` = Global, `languageCode` `null` = Channel. */
export interface FamilyReadScope {
  channelId: string | null;
  languageCode: string | null;
}

/** One attachment as it shows at a scope. */
export interface AttachmentAtScope {
  hidden: boolean;
  /** `''` = an empty override: nothing shown. */
  name: string;
  /** `null` = none (no Global description, or an empty override). */
  description: string | null;
}

const ALL_LEVELS: readonly ScopeLevel[] = ['G', 'C', 'CL'];

function toScopeRef(scope: FamilyReadScope): ScopeRef | null {
  if (scope.channelId === null) return null;
  return scope.languageCode === null
    ? { level: 'channel', channelId: scope.channelId }
    : { level: 'channel_language', channelId: scope.channelId, languageCode: scope.languageCode };
}

type OverrideRow = { subject_id: string; language_code: string | null; field: string; value: unknown };

async function overrideRows(
  em: EntityManager,
  table: 'product_attachment_scope_overrides' | 'product_packaging_unit_scope_overrides',
  subjectColumn: 'attachment_id' | 'packaging_unit_id',
  productId: string,
  scope: FamilyReadScope,
): Promise<Array<{ subjectId: string; salesChannelId: string; languageCode: string | null; field: string; value: unknown }>> {
  if (scope.channelId === null) return [];
  // `em.execute`, so a caller inside a transaction reads its own writes (issue #200).
  const rows = await em.execute<OverrideRow[]>(
    `select ${subjectColumn}::text as subject_id, language_code, field, value
       from ${table}
      where product_id = ? and sales_channel_id = ?
        and (language_code is null or lower(language_code) = lower(?::text))`,
    [productId, scope.channelId, scope.languageCode],
  );
  const channelId = scope.channelId;
  return rows.map((row) => ({ subjectId: row.subject_id, salesChannelId: channelId, languageCode: row.language_code, field: row.field, value: row.value }));
}

/**
 * Feature 170 (`data-model.md` §7; FR-011, FR-013) — a product's attachments at one scope: the
 * name, description and `hidden` flag of each, C×L → C → G, an empty override stopping the
 * chain. One statement (none at Global).
 */
export async function loadAttachmentsAtScope(
  em: EntityManager,
  productId: string,
  attachments: ReadonlyArray<{ id: string; name: string; description: string | null; hidden: boolean }>,
  scope: FamilyReadScope,
): Promise<Map<string, AttachmentAtScope>> {
  const out = new Map<string, AttachmentAtScope>();
  const ref = toScopeRef(scope);
  const rows = attachments.length === 0 ? [] : await overrideRows(em, 'product_attachment_scope_overrides', 'attachment_id', productId, scope);
  for (const attachment of attachments) {
    if (ref === null) {
      out.set(attachment.id, { hidden: attachment.hidden, name: attachment.name, description: attachment.description });
      continue;
    }
    const at = <T>(field: string, global: T | null) =>
      resolveScoped<T>({ global, rows: familyOverrideRows<T>(rows, attachment.id, field), scope: ref, levels: ALL_LEVELS }).value;
    out.set(attachment.id, {
      hidden: at<boolean>('hidden', attachment.hidden) === true,
      name: at<string>('name', attachment.name) ?? '',
      description: at<string>('description', attachment.description),
    });
  }
  return out;
}

/**
 * Feature 170 (`data-model.md` §7) — a product's packaging-unit names at one scope, C×L → C → G;
 * `''` for an empty override (nothing shown on the product page; basket, quote and order
 * snapshots keep the Global name — owner decision after C1). One statement (none at Global).
 */
export async function loadPackagingUnitNamesAtScope(
  em: EntityManager,
  productId: string,
  units: ReadonlyArray<{ id: string; name: string }>,
  scope: FamilyReadScope,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ref = toScopeRef(scope);
  const rows = units.length === 0 || ref === null ? [] : await overrideRows(em, 'product_packaging_unit_scope_overrides', 'packaging_unit_id', productId, scope);
  for (const unit of units) {
    out.set(
      unit.id,
      ref === null
        ? unit.name
        : (resolveScoped<string>({ global: unit.name, rows: familyOverrideRows<string>(rows, unit.id, 'name'), scope: ref, levels: ALL_LEVELS }).value ?? ''),
    );
  }
  return out;
}

/**
 * The scope overview's attachment and packaging-unit fields of `productId` (T139b):
 * `attachments:hidden` per channel any attachment is hidden in; `attachments:name`,
 * `attachments:description` and `packagingUnits:name` per language any row has a
 * non-blank text in. One statement.
 */
export async function loadAttachmentPackagingScopedFields(
  em: EntityManager,
  productId: string,
): Promise<Array<{ field: string; channelId: string | null; languageCode: string | null }>> {
  const rows = await em.execute<Array<{ field: string; channel_id: string | null; language_code: string | null }>>(
    `select distinct 'attachments:' || field as field, sales_channel_id::text as channel_id, language_code
       from product_attachment_scope_overrides where product_id = ?
     union
     select distinct 'packagingUnits:name', sales_channel_id::text, language_code
       from product_packaging_unit_scope_overrides where product_id = ?
     order by 1, 2, 3`,
    [productId, productId],
  );
  return rows.map((row) => ({ field: row.field, channelId: row.channel_id, languageCode: row.language_code }));
}

// --- Shared by the scoped writes -----------------------------------------------------

/**
 * FR-014 — every channel in `channelIds` is one the product is a member of, else
 * `422 SCOPE_INVALID` (`reason: 'not_a_member'`) naming the first outside one. The
 * caller passes only the channels a write **adds**: removing one never asks (FR-015).
 */
export async function assertProductChannelMembers(
  membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'> | undefined,
  productId: string,
  channelIds: readonly string[],
): Promise<void> {
  if (channelIds.length === 0) return;
  if (!membership) {
    throw new Error('The channel membership port is not wired — a channel override cannot be checked.');
  }
  const members = new Set(
    (await membership.listChannelsForEntity('product', productId)).map((channel) => channel.id),
  );
  const outside = channelIds.find((channelId) => !members.has(channelId));
  if (outside !== undefined) {
    throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The product is not a member of this sales channel.', {
      channelId: outside,
      reason: 'not_a_member',
    });
  }
}

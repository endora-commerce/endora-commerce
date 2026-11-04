import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, ogImageUrlSchema } from '@endora-commerce/contracts';
import type {
  ScopeRef,
  ScopedWriteOp,
  SeoProductMetaField,
  SeoProductMetaOwnValue,
  SeoProductMetaWritePort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * `seoProductMetaWritePort` (feature 172, FR-091; `specs/172-product-editor-scope-switcher/contracts/seo-ports.md`
 * §2, research R9, R21) — product metadata written **on the caller's EntityManager**.
 *
 * No fork, no flush, no audit entry, no event: `catalog`'s save Command (and its duplicate) commits or
 * rolls these rows back with its own, so a product save is one audited transaction whatever it
 * changes. Every statement is `em.execute`, which runs on the caller's open transaction
 * (`check:transaction-context`).
 *
 * **Any scope is writable.** Whether the product is sold in the channel and the channel offers the
 * language is the caller's check (catalog validates every scoped write the same way); a product
 * duplicated in the caller's transaction has memberships no other connection can see yet, so a
 * check here would refuse a write the caller has already allowed. The language is stored as the
 * caller spells it.
 *
 * Row mapping: G = (no channel, no locale); C = (channel, no locale); C×L = (channel, locale).
 * `set` → the value; `empty` → `''`; `inherit` → `NULL`; a row left all `NULL` is deleted.
 */

const FIELDS: readonly SeoProductMetaField[] = ['title', 'description', 'ogTitle', 'ogDescription', 'ogImageUrl'];

const COLUMN: Readonly<Record<SeoProductMetaField, string>> = {
  title: 'title',
  description: 'description',
  ogTitle: 'og_title',
  ogDescription: 'og_description',
  ogImageUrl: 'og_image_url',
};

const MAX_LENGTH: Readonly<Record<SeoProductMetaField, number>> = {
  title: 160,
  description: 400,
  ogTitle: 160,
  ogDescription: 400,
  ogImageUrl: 2048,
};

/**
 * An `og:image` URL: `http(s)` with no credentials, or a site-relative path (R21). Checked at write
 * time only — by this port and by the legacy PUT (`ogImageUrlSchema`) — so no unsafe value is ever
 * stored; the render path does not re-check it.
 */
export function isSafeOgImageUrl(value: string): boolean {
  return ogImageUrlSchema.safeParse(value).success && !/^https?:\/\/[^/?#]*@/i.test(value);
}

type Row = Record<string, string | null> & { id: string };

function refuse(field: SeoProductMetaField, reason: string): HttpError {
  return new HttpError(422, ERROR_CODES.SCOPED_VALUE_INVALID, `The SEO value of "${field}" is not valid: ${reason}.`, {
    field: `seo.${field}`,
    reason,
  });
}

function address(scope: ScopeRef): { channelId: string | null; locale: string | null } {
  if (scope.level === 'global') return { channelId: null, locale: null };
  if (scope.level === 'channel') return { channelId: scope.channelId, locale: null };
  return { channelId: scope.channelId, locale: scope.languageCode };
}

async function rowAt(em: EntityManager, productId: string, scope: ScopeRef): Promise<Row | null> {
  const { channelId, locale } = address(scope);
  const rows = await em.execute<Row[]>(
    `select id, title, description, og_title, og_description, og_image_url from seo_meta_overrides
      where entity_type = 'product' and entity_id = ?
        and sales_channel_id is not distinct from ?
        and lower(locale) is not distinct from lower(?)`,
    [productId, channelId, locale],
  );
  return rows[0] ?? null;
}

function ownOf(value: string | null | undefined): SeoProductMetaOwnValue {
  if (value === null || value === undefined) return { inherited: true };
  return value === '' ? { own: { empty: true } } : { own: value };
}

function validate(field: SeoProductMetaField, op: ScopedWriteOp<string>, scope: ScopeRef): void {
  if (op.op === 'inherit') {
    if (scope.level === 'global') throw refuse(field, 'inherit_at_global');
    return;
  }
  if (op.op === 'empty') return;
  if (typeof op.value !== 'string' || op.value === '') throw refuse(field, 'invalid');
  if (op.value.length > MAX_LENGTH[field]) throw refuse(field, 'too_long');
  if (field === 'ogImageUrl' && !isSafeOgImageUrl(op.value)) throw refuse(field, 'unsafe_url');
}

export function createSeoProductMetaWritePort(): SeoProductMetaWritePort<EntityManager> {
  return {
    async readWithin(em, { productId, scope, fields }) {
      const row = await rowAt(em, productId, scope);
      const out: Partial<Record<SeoProductMetaField, SeoProductMetaOwnValue>> = {};
      for (const field of fields) out[field] = ownOf(row?.[COLUMN[field]]);
      return out;
    },

    async applyWithin(em, { productId, scope, changes }) {
      const named = FIELDS.filter((field) => changes[field] !== undefined);
      for (const field of named) validate(field, changes[field]!, scope);
      const row = await rowAt(em, productId, scope);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const next: Record<string, string | null> = {};
      for (const field of FIELDS) next[field] = row?.[COLUMN[field]] ?? null;
      for (const field of named) {
        const op = changes[field]!;
        before[field] = ownOf(next[field]);
        next[field] = op.op === 'set' ? op.value : op.op === 'empty' ? '' : null;
        after[field] = ownOf(next[field]);
      }
      if (named.length === 0) return { before, after };

      const values = FIELDS.map((field) => next[field] ?? null);
      const allInherited = values.every((value) => value === null);
      if (row === null) {
        if (allInherited) return { before, after };
        const { channelId, locale } = address(scope);
        await em.execute(
          `insert into seo_meta_overrides
             (id, entity_type, entity_id, sales_channel_id, locale, title, description, og_title, og_description, og_image_url, created_at, updated_at)
           values (?, 'product', ?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
          [randomUUID(), productId, channelId, locale, ...values],
        );
      } else if (allInherited) {
        await em.execute(`delete from seo_meta_overrides where id = ?`, [row.id]);
      } else {
        await em.execute(
          `update seo_meta_overrides
              set title = ?, description = ?, og_title = ?, og_description = ?, og_image_url = ?, updated_at = now()
            where id = ?`,
          [...values, row.id],
        );
      }
      return { before, after };
    },
  };
}

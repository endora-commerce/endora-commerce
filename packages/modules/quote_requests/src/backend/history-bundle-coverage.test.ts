import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  quoteRequestDeliveryChannelSchema,
  quoteRequestDeliveryStatusSchema,
  quoteRequestHistoryChangeSchema,
  quoteRequestHistoryEntryKindSchema,
} from '@endora-commerce/contracts';

/**
 * Feature 146, T058 (FR-010, FR-030, contract H4) — every history entry kind
 * and every change kind the API can answer has a translated title in both
 * admin languages, so the History tab never falls back to a raw identifier.
 *
 * The keys live in the bundle the host screen reads: `RfqDetail` and its
 * History tab call `useTranslation('core')`, which the admin serves from
 * `_i18n`'s bundle (coordinator ruling, recorded on T060). The component builds
 * the keys as `rfq.detail.history.entry.<kind>` and
 * `rfq.detail.history.change.<kind>`; the admin test
 * `admin/test/modules/quote_requests/RfqDetail.history.test.tsx` holds the
 * other half — that the component renders those keys' text.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_BUNDLE_DIR = join(HERE, '..', '..', '..', '_i18n', 'i18n');

function bundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(readFileSync(join(CORE_BUNDLE_DIR, `${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
}

const EN = bundle('en');
const PL = bundle('pl');

const ENTRY_KINDS = [...quoteRequestHistoryEntryKindSchema.options];
const CHANGE_KINDS = quoteRequestHistoryChangeSchema.options.map((o) => o.shape.kind.value);

/** The recorded role labels the projection can answer, plus the generic one. */
const ROLE_KEYS = [
  'platformAdministrator',
  'salesRepresentative',
  'customer',
  'system',
  'administrator',
];

const OTHER_KEYS = [
  'rfq.detail.history.title',
  'rfq.detail.history.empty',
  'rfq.detail.history.loading',
  'rfq.detail.history.error',
  'rfq.detail.history.retry',
  'rfq.detail.history.truncated',
  'rfq.detail.history.noChanges',
  'rfq.detail.history.none',
  'rfq.detail.history.note',
  // Feature 159 — the name of the ungrouped section in a `line_group` change.
  'rfq.detail.history.ungrouped',
  // Feature 159 (N-32) — a line of a product on several lines, with its group.
  'rfq.detail.history.lineInGroup',
  'rfq.detail.history.reason',
  'rfq.detail.history.revision',
  'rfq.detail.history.order',
  'rfq.detail.history.relatedRequest',
  'rfq.detail.history.lineWithVariant',
  'rfq.detail.history.money',
  'rfq.detail.history.actor.system',
  'rfq.detail.history.actor.unknownUser',
  'rfq.detail.history.actor.withDetail',
  'rfq.detail.history.change.validity_set',
  'rfq.detail.history.change.validity_removed',
];

/**
 * `specs/179-rfq-and-customer-notifications/` WP-06 (FR-070) — every channel
 * and every delivery status the History can answer has a label, so a delivery
 * never reads as its code.
 */
const DELIVERY_CHANNELS = [...quoteRequestDeliveryChannelSchema.options];
const DELIVERY_STATUSES = [...quoteRequestDeliveryStatusSchema.options];
const DELIVERY_KEYS = [
  'rfq.detail.history.delivery.title',
  'rfq.detail.history.delivery.recipient.admin',
  'rfq.detail.history.delivery.recipient.customer',
  'rfq.detail.history.delivery.attempts',
  'rfq.detail.history.delivery.showError',
  'rfq.detail.history.delivery.noError',
];

const REQUIRED = [
  ...DELIVERY_CHANNELS.map((c) => `rfq.detail.history.delivery.channel.${c}`),
  ...DELIVERY_STATUSES.map((s) => `rfq.detail.history.delivery.status.${s}`),
  ...DELIVERY_KEYS,
  ...ENTRY_KINDS.map((k) => `rfq.detail.history.entry.${k}`),
  ...CHANGE_KINDS.map((k) => `rfq.detail.history.change.${k}`),
  ...ROLE_KEYS.map((k) => `rfq.detail.history.role.${k}`),
  ...OTHER_KEYS,
];

describe('quote request history — bundle coverage (T058)', () => {
  it('iterates the full schema enums', () => {
    // Feature 162 added custom_field_carry_skipped.
    expect(ENTRY_KINDS).toHaveLength(14);
    // Feature 159 added the five grouping kinds.
    expect(CHANGE_KINDS).toHaveLength(13);
  });

  it.each(REQUIRED)('%s exists, non-empty, in en and pl', (key) => {
    expect(EN[key], `en: ${key}`).toEqual(expect.any(String));
    expect(PL[key], `pl: ${key}`).toEqual(expect.any(String));
    expect(EN[key]?.trim()).not.toBe('');
    expect(PL[key]?.trim()).not.toBe('');
  });

  it('the Polish entry and change titles are translations, not English copies', () => {
    const titles = [
      ...ENTRY_KINDS.map((k) => `rfq.detail.history.entry.${k}`),
      ...CHANGE_KINDS.map((k) => `rfq.detail.history.change.${k}`),
      ...DELIVERY_STATUSES.map((s) => `rfq.detail.history.delivery.status.${s}`),
    ];
    for (const key of titles) expect(PL[key], key).not.toBe(EN[key]);
  });
});

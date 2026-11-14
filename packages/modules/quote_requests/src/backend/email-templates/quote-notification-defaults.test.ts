import { describe, expect, it } from 'vitest';
import { renderDirectives } from '@endora-commerce/email-components/directives/directive-engine';
import { renderEmailHtml } from '@endora-commerce/email-components/render/render-email-html';
import { renderEmailText } from '@endora-commerce/email-components/render/render-email-text';
import type { PuckDataTree } from '@endora-commerce/email-components/schema/envelope';
import { manifest } from '../../manifest.js';
import { customerEmailCode, operatorEmailCode } from '../services/notifications/channel-adapters.js';
import { NOTIFICATION_CHANGES, NOTIFICATION_MATRIX } from '../services/notifications/notification-matrix.js';
import { QUOTE_NOTIFICATION_EMAIL_DEFAULTS } from './quote-notification-defaults.js';

/**
 * `specs/179-rfq-and-customer-notifications/` FR-020 (T043) — the eleven
 * notification e-mails of `contracts/notification-matrix.md` §3: each is a
 * manifest entry an operator can edit and switch off, each ships an English
 * and a Polish default, and the defaults and the declarations agree about
 * every variable in both directions.
 */

const LANGUAGES = ['en-US', 'pl-PL'] as const;

const EXPECTED_CODES = [
  'quote_request_customer_submitted',
  'quote_request_customer_resubmitted',
  'quote_request_customer_offer_accepted',
  'quote_request_customer_offer_rejected',
  'quote_request_customer_expired',
  'quote_request_customer_prepared',
  'quote_request_customer_revised',
  'quote_request_customer_approved',
  'quote_request_customer_canceled',
  'quote_request_operator_submitted',
  'quote_request_operator_resubmitted',
];

const COMMON_CUSTOMER = ['quote.number', 'quote.url', 'customer.name', 'organization.name', 'channel.name'];
const COMMON_OPERATOR = ['quote.number', 'quote.adminUrl', 'customer.name', 'organization.name', 'channel.name'];
const EXTRA: Record<string, string[]> = {
  quote_request_customer_submitted: ['actor.name'],
  quote_request_customer_resubmitted: ['actor.name', 'quote.previousNumber'],
  quote_request_customer_offer_accepted: ['actor.name'],
  quote_request_customer_offer_rejected: ['actor.name', 'reason'],
  quote_request_customer_expired: [],
  quote_request_customer_prepared: ['quote.validUntil'],
  quote_request_customer_revised: ['quote.validUntil', 'quote.revisionNumber'],
  quote_request_customer_approved: ['quote.validUntil'],
  quote_request_customer_canceled: ['reason'],
  quote_request_operator_submitted: ['actor.name', 'quote.lineCount'],
  quote_request_operator_resubmitted: ['actor.name', 'quote.lineCount', 'quote.previousNumber'],
};

const notificationEntries = (manifest.transactionalEmails ?? []).filter(
  (entry) => entry.code.startsWith('quote_request_customer_') || entry.code.startsWith('quote_request_operator_'),
);

/** Every variable a text names: `{{var key}}` and `{{if key}}`. */
function namedVariables(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*(?:var|if)\s+([a-zA-Z][\w.]*)\s*\}\}/g)) names.add(match[1]!);
  return names;
}

describe('the eleven quote request notification e-mails', () => {
  it('are declared in the manifest, in the quote_requests group, one per matrix e-mail cell', () => {
    expect(notificationEntries.map((entry) => entry.code)).toEqual(EXPECTED_CODES);
    for (const entry of notificationEntries) {
      expect(entry.group).toBe('quote_requests');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description?.length ?? 0).toBeGreaterThan(0);
    }
    const fromMatrix = [
      ...NOTIFICATION_CHANGES.filter((change) => NOTIFICATION_MATRIX[change].channels.customer_email !== null).map(
        customerEmailCode,
      ),
      ...NOTIFICATION_CHANGES.filter((change) => NOTIFICATION_MATRIX[change].channels.admin_email !== null).map(
        operatorEmailCode,
      ),
    ];
    expect([...fromMatrix].sort()).toEqual([...EXPECTED_CODES].sort());
  });

  it('declare the contract’s variables (§3), with a sample for each', () => {
    for (const entry of notificationEntries) {
      const common = entry.code.startsWith('quote_request_customer_') ? COMMON_CUSTOMER : COMMON_OPERATOR;
      expect(entry.variables.map((variable) => variable.key).sort(), entry.code).toEqual(
        [...common, ...EXTRA[entry.code]!].sort(),
      );
      for (const variable of entry.variables) expect(variable.sampleValue, `${entry.code} ${variable.key}`).toBeTruthy();
    }
  });

  it('ship defaults for exactly those codes, none of them locked on', () => {
    expect(Object.keys(QUOTE_NOTIFICATION_EMAIL_DEFAULTS).sort()).toEqual([...EXPECTED_CODES].sort());
    for (const defaults of Object.values(QUOTE_NOTIFICATION_EMAIL_DEFAULTS)) {
      expect(defaults.nonDeactivatable).toBeUndefined();
    }
  });

  it.each(EXPECTED_CODES.flatMap((code) => LANGUAGES.map((language) => [code, language] as const)))(
    '%s (%s): a subject, a body, and every declared variable used — and nothing undeclared',
    (code, language) => {
      const defaults = QUOTE_NOTIFICATION_EMAIL_DEFAULTS[code as keyof typeof QUOTE_NOTIFICATION_EMAIL_DEFAULTS];
      const subject = defaults.defaultSubject[language];
      expect(subject?.trim().length ?? 0).toBeGreaterThan(0);
      const content = (defaults.defaultContent['languages'] as Record<string, unknown>)[language];
      expect(content).toBeTruthy();
      const used = namedVariables(`${subject}\n${JSON.stringify(content)}`);
      const declared = notificationEntries.find((entry) => entry.code === code)!.variables.map((v) => v.key);
      for (const key of declared) expect(used.has(key), `${code} ${language} uses ${key}`).toBe(true);
      for (const key of used) expect(declared, `${code} ${language} names ${key}`).toContain(key);
    },
  );

  it('the approval e-mail says nothing about an attachment (FR-022)', () => {
    const approved = QUOTE_NOTIFICATION_EMAIL_DEFAULTS.quote_request_customer_approved;
    const text = JSON.stringify(approved).toLowerCase();
    expect(text).not.toContain('attach');
    expect(text).not.toContain('pdf');
    expect(text).not.toContain('załącz');
  });
});

/**
 * Issue #1204 (spec 179 OQ-1): each operator default shows a button to the
 * request in the admin panel when `quote.adminUrl` is sent, and nothing in its
 * place — no `href="#"`, no bare label — when it is not.
 */
describe('the operator e-mails’ link into the admin panel (#1204)', () => {
  const ADMIN_URL = 'https://admin.example.com/quote-requests/2f1c0d1e-0000-4000-8000-000000000153';
  const OPERATOR_CODES = ['quote_request_operator_submitted', 'quote_request_operator_resubmitted'] as const;

  it.each(OPERATOR_CODES.flatMap((code) => LANGUAGES.map((language) => [code, language] as const)))(
    '%s (%s): a button to the request with the link, nothing in its place without one',
    (code, language) => {
      const content = (QUOTE_NOTIFICATION_EMAIL_DEFAULTS[code].defaultContent['languages'] as Record<string, unknown>)[
        language
      ] as PuckDataTree;
      const base = {
        quote: { number: 'QR-000153', lineCount: '4', previousNumber: 'QR-000150' },
        customer: { name: 'Olga Operator' },
        actor: { name: 'Anna Buyer' },
        organization: { name: 'Acme' },
        channel: { name: 'B2B store' },
      };
      const linked = { ...base, quote: { ...base.quote, adminUrl: ADMIN_URL } };
      const html = (ctx: Record<string, unknown>) => renderDirectives(renderEmailHtml(content), ctx, { escape: true });
      const text = (ctx: Record<string, unknown>) => renderDirectives(renderEmailText(content), ctx);

      expect(html(linked)).toContain(`href="${ADMIN_URL}"`);
      expect(text(linked)).toContain(ADMIN_URL);
      expect(html(base)).not.toContain('<a href');
      expect(html(base)).not.toContain('href="#"');
      expect(text(base)).not.toContain('http');
    },
  );
});

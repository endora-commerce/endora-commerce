import { describe, expect, it } from 'vitest';
import type { InvoiceDetail } from '@b2b/contracts';
import { ksefSection, type InvoiceDetailWithKsef } from '../../../src/modules/invoices/pdf-components/sections.js';

/**
 * Feature 059 (T028) — the invoices PDF `ksefSection`: number + date as
 * before, plus the verification QR (pdfmake built-in) and offline markings
 * when the ksef module supplies verification data.
 */
const base = {
  ksefReferenceNumber: '1234567890-20260722-ABC123-01',
  ksefProcessedAt: '2026-07-22T10:00:00.000Z',
} as InvoiceDetail;

describe('invoices ksefSection [unit]', () => {
  it('renders nothing without a KSeF number or offline marking (pre-059 behavior)', () => {
    expect(ksefSection({} as InvoiceDetail)).toEqual({ text: '' });
  });

  it('renders number + date without a QR when no verification data is supplied', () => {
    const out = ksefSection(base) as { stack: unknown[] };
    const json = JSON.stringify(out);
    expect(json).toContain('Numer w KSeF: 1234567890-20260722-ABC123-01');
    expect(json).not.toContain('"qr"');
  });

  it('renders the verification QR when the ksef module supplies the URL', () => {
    const detail: InvoiceDetailWithKsef = {
      ...base,
      ksefVerification: {
        verificationUrl: 'https://ksef-test.mf.gov.pl/web/verify/1234567890-20260722-ABC123-01/hashhash',
        offline: false,
      },
    } as InvoiceDetailWithKsef;
    const json = JSON.stringify(ksefSection(detail));
    expect(json).toContain('"qr":"https://ksef-test.mf.gov.pl/web/verify/');
    expect(json).toContain('Zweryfikuj fakturę w KSeF');
    expect(json).not.toContain('trybie offline');
  });

  it('marks offline documents, including before the KSeF number is assigned (FR-017)', () => {
    const pending = ksefSection({
      ksefVerification: { verificationUrl: '', offline: true },
    } as InvoiceDetailWithKsef);
    expect(JSON.stringify(pending)).toContain('trybie offline');

    const accepted = ksefSection({
      ...base,
      ksefVerification: { verificationUrl: 'https://x/verify', offline: true },
    } as InvoiceDetailWithKsef);
    expect(JSON.stringify(accepted)).toContain('Faktura wystawiona w trybie offline.');
  });
});

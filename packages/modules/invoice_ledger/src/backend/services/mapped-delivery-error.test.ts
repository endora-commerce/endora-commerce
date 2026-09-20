// The floor's first test — D-256 (`specs/080-f4-real-scope/rulings.md`).
//
// `mappedDeliveryError` is a **vendor-independent shape floor**, not a
// vocabulary. It cannot name a vendor sentence, so neither can this file: the
// only sanctioned strings here are the four free `INVOICE_LEDGER_*` constants
// and hand-written prose. A vendor's own package asserts that the sentences it
// authors clear this floor; that assertion travels with the vocabulary.
import { describe, expect, it } from 'vitest';
import {
  INVOICE_LEDGER_ASYNC_CREATE_FAILED_MESSAGE,
  INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
  INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE,
  INVOICE_LEDGER_VENDOR_KSEF_SEND_FAILED_MESSAGE,
} from '@endora-commerce/contracts';
import { mappedDeliveryError } from './mapped-delivery-error.js';

describe('mappedDeliveryError', () => {
  describe('the absent input keeps its own shape', () => {
    it('returns null for null', () => {
      expect(mappedDeliveryError(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(mappedDeliveryError(undefined)).toBeNull();
    });

    it('returns the empty string unchanged, so an empty error is not an error', () => {
      expect(mappedDeliveryError('')).toBe('');
    });
  });

  describe('markup is unreadable', () => {
    it('refuses an opening angle bracket', () => {
      expect(mappedDeliveryError('<api><status>ERROR</status></api>')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
    });

    it('refuses a closing angle bracket alone', () => {
      expect(mappedDeliveryError('The vendor said 3 > 2.')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
    });
  });

  describe('control characters are unreadable, which is what a dump is made of', () => {
    it('refuses a newline, the shape of a header dump', () => {
      expect(mappedDeliveryError('HTTP 500\nx-request-id: 9f2a\nretry-after: 30')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
    });

    it('refuses a carriage return', () => {
      expect(mappedDeliveryError('first line\r\nsecond line')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
    });

    it('refuses a tab, the shape of a stack trace', () => {
      expect(mappedDeliveryError('TypeError: x is not a function\tat send (client.js:12)')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
    });

    it('refuses a NUL and other C0 characters inside otherwise plain prose', () => {
      expect(mappedDeliveryError('The vendor refused\u0000 the invoice.')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
      expect(mappedDeliveryError('The vendor refused\u001b[31m the invoice.')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
    });

    it('refuses a DEL and a C1 control character', () => {
      expect(mappedDeliveryError('The vendor refused\u007f the invoice.')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
      expect(mappedDeliveryError('The vendor refused\u009c the invoice.')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
    });

    it('does not refuse a leading or trailing newline alone, because trimming removes it', () => {
      expect(mappedDeliveryError('\n  The vendor refused the invoice.  \n')).toBe(
        'The vendor refused the invoice.',
      );
    });
  });

  describe('a serialised body is unreadable even without a bracket', () => {
    it('refuses a JSON object, which the bracket clause cannot see', () => {
      expect(mappedDeliveryError('{"errors":{"nip":"is invalid"}}')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
    });

    it('refuses a JSON array', () => {
      expect(mappedDeliveryError('[{"field":"nip","message":"is invalid"}]')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
    });

    it('sees the first character of the trimmed input, not of the raw input', () => {
      expect(mappedDeliveryError('   {"code":500}   ')).toBe(
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
      );
    });

    it('accepts a brace that is not the first character, because that is prose', () => {
      expect(mappedDeliveryError('The vendor returned {code: 500} and stopped.')).toBe(
        'The vendor returned {code: 500} and stopped.',
      );
    });
  });

  describe('length is the backstop, and it does not truncate', () => {
    it('accepts a sentence of exactly 500 characters', () => {
      const sentence = `${'a'.repeat(499)}.`;
      expect(sentence).toHaveLength(500);
      expect(mappedDeliveryError(sentence)).toBe(sentence);
    });

    it('refuses a sentence of 501 characters outright rather than cutting it', () => {
      const sentence = `${'a'.repeat(500)}.`;
      expect(sentence).toHaveLength(501);
      expect(mappedDeliveryError(sentence)).toBe(INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR);
    });

    it('measures the trimmed input, so surrounding whitespace does not spend the budget', () => {
      const sentence = `${'a'.repeat(499)}.`;
      expect(mappedDeliveryError(`   ${sentence}   `)).toBe(sentence);
    });
  });

  describe('a plain operator sentence survives, whoever wrote it', () => {
    it('returns the free module\u2019s own four sentences unchanged', () => {
      for (const sentence of [
        INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
        INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE,
        INVOICE_LEDGER_ASYNC_CREATE_FAILED_MESSAGE,
        INVOICE_LEDGER_VENDOR_KSEF_SEND_FAILED_MESSAGE,
      ]) {
        expect(mappedDeliveryError(sentence)).toBe(sentence);
      }
    });

    it('returns a sentence the free module has never seen, which is the change in kind', () => {
      expect(mappedDeliveryError('The ledger vendor rejected the buyer address.')).toBe(
        'The ledger vendor rejected the buyer address.',
      );
    });

    it('returns a composed sentence whose tail is a field name and a message', () => {
      expect(
        mappedDeliveryError('The ledger vendor rejected the invoice. contractor_nip: is invalid'),
      ).toBe('The ledger vendor rejected the invoice. contractor_nip: is invalid');
    });

    it('trims, so a stored sentence is never surrounded by whitespace', () => {
      expect(mappedDeliveryError('  The ledger vendor is unavailable.  ')).toBe(
        'The ledger vendor is unavailable.',
      );
    });

    it('returns the unreadable sentence for whitespace-only input, which trims to empty', () => {
      expect(mappedDeliveryError('   ')).toBe(INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR);
    });

    it('keeps non-ASCII prose, because the floor is about shape and not about charset', () => {
      expect(
        mappedDeliveryError(
          'The vendor rejected the invoice \u2014 the buyer NIP is \u201c0000000000\u201d.',
        ),
      ).toBe('The vendor rejected the invoice \u2014 the buyer NIP is \u201c0000000000\u201d.');
    });
  });
});

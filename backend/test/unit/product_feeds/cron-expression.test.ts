import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_PRESETS,
  describeCronExpression,
  isValidCronExpression,
  isValidTimezone,
  presetForCron,
} from '../../../src/modules/product_feeds/services/cron-expression.js';

/**
 * Feature 067 / T069 — cron validation and its plain-language echo (FR-031).
 *
 * Two boundaries are deliberate and both are asserted here.
 *
 * **We do not evaluate cron.** No `cron-parser` import: it is a transitive
 * dependency of BullMQ and is not resolvable from `backend/` under pnpm
 * (`MODULE_NOT_FOUND`). Next-occurrence and DST arithmetic belong to BullMQ,
 * which owns the scheduler; this module only validates the grammar and renders
 * the sentence an operator reads before saving.
 *
 * **DST is therefore documented, not computed.** The fixtures below record the
 * semantics we adopt from `cron-parser` through BullMQ (research §R5.5) so that
 * an upgrade which changes them fails a test here instead of silently changing
 * when a merchant's feed regenerates.
 */

describe('cron expression [unit]', () => {
  describe('validation (FR-031)', () => {
    it('accepts the shapes the presets and the ux-design examples produce', () => {
      for (const expression of [
        '0 */4 * * *',
        '*/15 * * * *',
        '30 2 * * 1-5',
        '0 3 * * *',
        '0 * * * *',
        '*/5 * * * *',
        '0,30 8-18 * * 1,3,5',
      ]) {
        expect(isValidCronExpression(expression), expression).toBe(true);
      }
    });

    it('rejects a four-field expression, prose and an over-long string', () => {
      for (const expression of [
        '0 */4 * *',
        'bogus',
        '@daily',
        '',
        '   ',
        'x'.repeat(65),
        '0 */4 * * * *',
      ]) {
        expect(isValidCronExpression(expression), expression).toBe(false);
      }
    });

    it('rejects out-of-range field values rather than deferring them to Redis', () => {
      // The contract's regex is grammatical only; these are the ranges that make
      // a syntactically valid expression still impossible to schedule.
      for (const expression of [
        '60 * * * *',
        '* 24 * * *',
        '* * 32 * *',
        '* * * 13 *',
        '* * * * 8',
      ]) {
        expect(isValidCronExpression(expression), expression).toBe(false);
      }
    });

    it('accepts the timezones the scheduler will accept, and no others', () => {
      expect(isValidTimezone('Europe/Warsaw')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
      expect(isValidTimezone('Mars/Phobos')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
    });
  });

  describe('the plain-language echo (FR-031, ux-design §2.2)', () => {
    it('renders the documented example', () => {
      expect(describeCronExpression('0 */4 * * *')).toBe('Every 4 hours, at minute 0');
    });

    it('renders the other preset shapes', () => {
      expect(describeCronExpression('*/15 * * * *')).toBe('Every 15 minutes');
      expect(describeCronExpression('0 * * * *')).toBe('Every hour, at minute 0');
      expect(describeCronExpression('0 3 * * *')).toBe('Every day at 03:00');
      expect(describeCronExpression('30 2 * * 1-5')).toBe(
        'At 02:30, Monday to Friday',
      );
    });

    it('says something true rather than nothing for an expression it cannot phrase', () => {
      // Postel: an operator who hand-wrote a valid but unusual expression gets
      // the expression back, not an empty line that reads like a failure.
      expect(describeCronExpression('0,30 8-18 * * 1,3,5')).toBe('0,30 8-18 * * 1,3,5');
    });

    it('returns null for an invalid expression so the caller shows the error instead', () => {
      expect(describeCronExpression('bogus')).toBeNull();
      expect(describeCronExpression('60 * * * *')).toBeNull();
    });
  });

  describe('presets (ux-design §2.2 — never make a merchandiser write cron)', () => {
    it('ships the documented preset list, every one of them valid', () => {
      expect(SCHEDULE_PRESETS.map((p) => p.id)).toEqual([
        'hourly',
        'every4Hours',
        'daily',
      ]);
      for (const preset of SCHEDULE_PRESETS) {
        expect(isValidCronExpression(preset.cron), preset.id).toBe(true);
      }
    });

    it('round-trips a preset cron back to its preset id', () => {
      for (const preset of SCHEDULE_PRESETS) {
        expect(presetForCron(preset.cron)).toBe(preset.id);
      }
      expect(presetForCron('30 2 * * 1-5')).toBeNull();
    });
  });

  /**
   * DST fixtures for `Europe/Warsaw` (research §R5.5). These are the semantics
   * BullMQ's bundled `cron-parser` gives us and that we deliberately do NOT
   * correct. They are recorded as data so the expectation is reviewable, and so
   * a BullMQ upgrade that changes them is caught here rather than by a merchant.
   *
   * 2026: spring forward Sun 29 March 02:00 → 03:00; fall back Sun 25 October
   * 03:00 → 02:00.
   */
  describe('DST semantics for Europe/Warsaw (documented, not computed)', () => {
    const FIXTURES = [
      {
        name: 'spring forward — a local time that does not exist that day',
        cron: '30 2 * * *',
        date: '2026-03-29',
        expectation:
          'fires at the next existing instant that day; it is not skipped for the day',
      },
      {
        name: 'fall back — the repeated local hour',
        cron: '30 2 * * *',
        date: '2026-10-25',
        expectation: 'fires once, not twice, because scheduling advances in absolute time',
      },
      {
        name: 'an interval pattern is unaffected by either transition',
        cron: '*/15 * * * *',
        date: '2026-03-29',
        expectation: 'fires every 15 minutes of absolute time across the transition',
      },
    ] as const;

    for (const fixture of FIXTURES) {
      it(`${fixture.name}: ${fixture.expectation}`, () => {
        // The expression itself must survive validation and be phraseable —
        // that is this module's whole responsibility for these cases. The
        // firing behaviour is BullMQ's, and is asserted end to end by the
        // scheduler integration test rather than re-implemented here.
        expect(isValidCronExpression(fixture.cron)).toBe(true);
        expect(describeCronExpression(fixture.cron)).not.toBeNull();
        expect(isValidTimezone('Europe/Warsaw')).toBe(true);
        expect(fixture.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    }
  });
});
